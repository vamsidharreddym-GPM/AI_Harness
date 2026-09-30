/**
 * Pipeline Orchestrator: manages execution, stale propagation, ID assignment, and review overrides.
 */
import {
  Chunk,
  db,
  Evidence,
  ExecReview,
  Feature,
  Goal,
  Insight,
  PRDDoc,
  Problem,
  Requirement,
  RoadmapItem,
  SourceDoc,
  SourceType,
  StageId,
  StageState,
  Workspace
} from '../store/db';
import {
  formatEvidenceId,
  formatFeatureId,
  formatGoalId,
  formatInsightId,
  formatOpportunityId,
  formatProblemId,
  formatRequirementId
} from '../lib/id';
import { computeHash } from '../lib/text';
import { createBatches } from '../lib/tokens';
import { getProvider } from '../providers';
import { extractJson } from './json';
import {
  getExecReviewPrompt,
  getInsightPrompt,
  getPrioritizationPrompt,
  getProblemPrompt,
  getPRDPrompt,
  getResearchPrompt,
  getRoadmapPrompt
} from './prompts';
import {
  ExecReviewStageOutputSchema,
  FeatureItemSchema,
  InsightStageOutputSchema,
  PrioritizationStageOutputSchema,
  ProblemStageOutputSchema,
  PRDStageOutputSchema,
  ResearchBatchOutputSchema,
  RoadmapStageOutputSchema
} from './schemas';
import { computeScore, rankFeatures } from './scoring';
import { verifyQuoteAgainstChunks } from './verify';

export const STAGE_ORDER: StageId[] = [
  'research',
  'insight',
  'problem',
  'prioritization',
  'prd',
  'roadmap',
  'review'
];

export async function markDownstreamStale(workspaceId: string, fromStage: StageId): Promise<void> {
  const fromIdx = STAGE_ORDER.indexOf(fromStage);
  if (fromIdx === -1) return;

  const states = await db.stageStates.where('workspaceId').equals(workspaceId).toArray();
  const stateMap = new Map(states.map((s) => [s.stage, s]));

  for (let i = fromIdx + 1; i < STAGE_ORDER.length; i++) {
    const stage = STAGE_ORDER[i];
    const s = stateMap.get(stage);
    if (s && s.status !== 'idle' && s.status !== 'stale') {
      await db.stageStates.put({
        ...s,
        status: 'stale'
      });
    }
  }
}

export function computeProblemConfidence(
  evidenceIds: string[],
  allEvidence: Evidence[],
  docsMap: Map<string, SourceDoc>
): { confidence: 'anecdotal' | 'corroborated' | 'triangulated'; sourceTypeCount: number } {
  const types = new Set<SourceType>();
  const evMap = new Map(allEvidence.map((e) => [e.id, e]));

  for (const eid of evidenceIds) {
    const ev = evMap.get(eid);
    if (!ev || ev.origin !== 'document' || !ev.verified || !ev.docId) continue;
    const doc = docsMap.get(ev.docId);
    if (doc) {
      types.add(doc.type);
    }
  }

  const count = types.size;
  let confidence: 'anecdotal' | 'corroborated' | 'triangulated' = 'anecdotal';
  if (count >= 3) {
    confidence = 'triangulated';
  } else if (count === 2) {
    confidence = 'corroborated';
  }
  return { confidence, sourceTypeCount: count };
}

export async function runResearchStage(
  workspace: Workspace,
  docs: SourceDoc[],
  chunks: Chunk[],
  providerId: 'anthropic' | 'openai' | 'google',
  model: string,
  key: string,
  signal?: AbortSignal,
  feedback?: string,
  onLog?: (msg: string) => void
): Promise<{ evidence: Evidence[]; goals: Goal[]; warnings: string[]; tokensIn: number; tokensOut: number }> {
  const provider = getProvider(providerId);
  const warnings: string[] = [];
  let totalIn = 0;
  let totalOut = 0;

  const activeDocs = docs.filter((d) => d.status === 'ok');
  if (activeDocs.length === 0) {
    throw new Error('Upload at least one source document before running research.');
  }

  const agentDocs: Record<string, SourceDoc[]> = {
    customer: activeDocs.filter((d) => ['interview', 'ticket', 'feature_request', 'other'].includes(d.type)),
    competitor: activeDocs.filter((d) => d.type === 'competitor'),
    analytics: activeDocs.filter((d) => d.type === 'analytics'),
    business: activeDocs.filter((d) => ['business_goal', 'prd'].includes(d.type))
  };

  const rawEvidenceList: any[] = [];
  const rawGoalsList: any[] = [];

  for (const [agentType, typedDocs] of Object.entries(agentDocs) as Array<[any, SourceDoc[]]>) {
    if (typedDocs.length === 0) {
      warnings.push(`Skipped ${agentType} agent: no matching documents.`);
      continue;
    }

    const typedDocIds = new Set(typedDocs.map((d) => d.id));
    const typedChunks = chunks.filter((c) => typedDocIds.has(c.docId));
    const batches = createBatches(typedChunks, 48000);
    const maxBatches = workspace.settings.lite ? Math.min(batches.length, 3) : batches.length;

    onLog?.(`Running ${agentType} research agent (${maxBatches} batch/es)...`);

    for (let b = 0; b < maxBatches; b++) {
      const batch = batches[b];
      let chunkContext = '';
      for (const c of batch.items) {
        chunkContext += `[${c.id}] ${c.text}\n\n`;
      }

      const prompt = getResearchPrompt(agentType, feedback);
      try {
        const res = await provider.generate({
          key,
          model,
          system: prompt,
          messages: [{ role: 'user', content: `Analyze the following document chunks:\n\n${chunkContext}` }],
          json: true,
          signal
        });

        totalIn += res.usage.in;
        totalOut += res.usage.out;

        const extracted = extractJson(res.text);
        const parsed = ResearchBatchOutputSchema.parse(extracted.data);

        if (parsed.evidence) {
          rawEvidenceList.push(...parsed.evidence);
        }
        if (parsed.goals) {
          rawGoalsList.push(...parsed.goals);
        }
      } catch (err: any) {
        warnings.push(`Batch ${b + 1} of ${agentType} failed: ${err.message}`);
      }
    }
  }

  // Deduplicate and verify evidence quotes against actual chunks
  const chunksMap = new Map(chunks.map((c) => [c.id, c]));
  const verifiedEvidence: Evidence[] = [];
  const seenQuotes = new Set<string>();
  let evIndex = 1;

  for (const item of rawEvidenceList) {
    if (!item.quote || item.quote.trim().length === 0) continue;
    const cleanQuote = item.quote.trim();
    if (seenQuotes.has(cleanQuote)) continue;
    seenQuotes.add(cleanQuote);

    const chunk = chunksMap.get(item.chunkId);
    const docChunks = chunk ? chunks.filter((c) => c.docId === chunk.docId) : [];

    const vResult = verifyQuoteAgainstChunks(
      cleanQuote,
      item.chunkId,
      docChunks,
      item.metric?.value
    );

    verifiedEvidence.push({
      id: formatEvidenceId(evIndex++),
      workspaceId: workspace.id,
      kind: item.kind || 'statement',
      origin: 'document',
      chunkId: vResult.relinkedChunkId || item.chunkId,
      docId: chunk?.docId,
      quote: cleanQuote,
      verified: vResult.verified,
      speaker: item.speaker,
      segment: item.segment,
      sentiment: item.sentiment,
      theme: item.theme,
      metric: item.metric
    });

    if (verifiedEvidence.length >= 200) {
      warnings.push('Evidence collection reached 200 items limit; capped for performance.');
      break;
    }
  }

  // Process business goals
  const goals: Goal[] = [];
  let goalIndex = 1;
  for (const g of rawGoalsList) {
    if (!g.statement) continue;
    const goalId = formatGoalId(goalIndex++);
    const evId = formatEvidenceId(evIndex++);

    // Create supporting goal_signal evidence
    verifiedEvidence.push({
      id: evId,
      workspaceId: workspace.id,
      kind: 'goal_signal',
      origin: 'document',
      chunkId: g.chunkId,
      quote: g.quote || g.statement,
      verified: true
    });

    goals.push({
      id: goalId,
      workspaceId: workspace.id,
      statement: g.statement,
      metric: g.metric || 'Goal KPI',
      target: g.target || 'Target value',
      timeframe: g.timeframe || 'TBD',
      priority: (g.priority >= 1 && g.priority <= 3 ? g.priority : 1) as 1 | 2 | 3,
      evidenceIds: [evId]
    });
  }

  return {
    evidence: verifiedEvidence,
    goals,
    warnings,
    tokensIn: totalIn,
    tokensOut: totalOut
  };
}

export async function runInsightStage(
  workspaceId: string,
  evidence: Evidence[],
  docs: SourceDoc[],
  providerId: 'anthropic' | 'openai' | 'google',
  model: string,
  key: string,
  signal?: AbortSignal,
  feedback?: string
): Promise<{ insights: Insight[]; warnings: string[]; tokensIn: number; tokensOut: number }> {
  if (evidence.length === 0) {
    throw new Error('No evidence items available to synthesize insights.');
  }

  const provider = getProvider(providerId);
  const compactEvidence = evidence.slice(0, 80).map((e) => ({
    id: e.id,
    kind: e.kind,
    quote: e.quote.slice(0, 240),
    theme: e.theme,
    sentiment: e.sentiment
  }));

  const res = await provider.generate({
    key,
    model,
    system: getInsightPrompt(feedback),
    messages: [{ role: 'user', content: `Evidence items:\n${JSON.stringify(compactEvidence, null, 2)}` }],
    json: true,
    signal
  });

  const extracted = extractJson(res.text);
  const parsed = InsightStageOutputSchema.parse(extracted.data);

  const evMap = new Map(evidence.map((e) => [e.id, e]));
  const docMap = new Map(docs.map((d) => [d.id, d]));
  const warnings: string[] = [];
  const insights: Insight[] = [];
  let index = 1;

  for (const item of parsed.insights.slice(0, 12)) {
    // Validate evidence references
    const validEvidenceIds = item.evidenceIds.filter((id) => evMap.has(id));
    if (validEvidenceIds.length === 0) {
      warnings.push(`Dropped insight "${item.title}": no valid evidence IDs referenced.`);
      continue;
    }

    const sourceTypes = Array.from(
      new Set(
        validEvidenceIds
          .map((id) => {
            const ev = evMap.get(id);
            return ev?.docId ? docMap.get(ev.docId)?.type : undefined;
          })
          .filter(Boolean) as SourceType[]
      )
    );

    insights.push({
      id: formatInsightId(index++),
      workspaceId,
      title: item.title,
      description: item.description,
      evidenceIds: validEvidenceIds,
      sourceTypes,
      contradictions: item.contradictions || []
    });
  }

  if (insights.length === 0) {
    throw new Error('The model returned no usable insights. Try a stronger model or check your sources.');
  }

  return {
    insights,
    warnings,
    tokensIn: res.usage.in,
    tokensOut: res.usage.out
  };
}

export async function runProblemStage(
  workspaceId: string,
  insights: Insight[],
  evidence: Evidence[],
  docs: SourceDoc[],
  goals: Goal[],
  providerId: 'anthropic' | 'openai' | 'google',
  model: string,
  key: string,
  signal?: AbortSignal,
  feedback?: string
): Promise<{ problems: Problem[]; warnings: string[]; tokensIn: number; tokensOut: number }> {
  const provider = getProvider(providerId);
  const inputData = {
    insights: insights.map((i) => ({ id: i.id, title: i.title, description: i.description, evidenceIds: i.evidenceIds })),
    goals: goals.map((g) => ({ id: g.id, statement: g.statement, metric: g.metric }))
  };

  const res = await provider.generate({
    key,
    model,
    system: getProblemPrompt(feedback),
    messages: [{ role: 'user', content: JSON.stringify(inputData, null, 2) }],
    json: true,
    signal
  });

  const extracted = extractJson(res.text);
  const parsed = ProblemStageOutputSchema.parse(extracted.data);

  const evMap = new Map(evidence.map((e) => [e.id, e]));
  const insightMap = new Map(insights.map((i) => [i.id, i]));
  const docsMap = new Map(docs.map((d) => [d.id, d]));
  const goalIdsSet = new Set(goals.map((g) => g.id));

  const warnings: string[] = [];
  const problems: Problem[] = [];
  let pIndex = 1;
  let oIndex = 1;

  for (const item of parsed.problems.slice(0, 10)) {
    const validInsightIds = item.insightIds.filter((id) => insightMap.has(id));
    let validEvidenceIds = item.evidenceIds.filter((id) => evMap.has(id));

    // If model omitted direct evidenceIds, inherit from referenced insights
    if (validEvidenceIds.length === 0 && validInsightIds.length > 0) {
      for (const iid of validInsightIds) {
        const ins = insightMap.get(iid);
        if (ins) validEvidenceIds.push(...ins.evidenceIds);
      }
      validEvidenceIds = Array.from(new Set(validEvidenceIds));
    }

    if (validEvidenceIds.length === 0) {
      warnings.push(`Dropped problem "${item.statement}": no valid evidence IDs.`);
      continue;
    }

    const { confidence, sourceTypeCount } = computeProblemConfidence(
      validEvidenceIds,
      evidence,
      docsMap
    );

    const validGoalIds = (item.opportunity?.goalIds || []).filter((gid) => goalIdsSet.has(gid));

    problems.push({
      id: formatProblemId(pIndex++),
      workspaceId,
      statement: item.statement,
      whoAffected: item.whoAffected || 'Target Users',
      severity: Math.max(1, Math.min(5, Number(item.severity) || 3)),
      frequency: item.frequency || 'Frequent',
      insightIds: validInsightIds,
      evidenceIds: validEvidenceIds,
      confidence,
      sourceTypeCount,
      opportunity: {
        id: formatOpportunityId(oIndex++),
        description: item.opportunity?.description || '',
        goalIds: validGoalIds
      }
    });
  }

  if (problems.length === 0) {
    throw new Error('The model returned no usable problems. Try a stronger model or refine insights.');
  }

  return {
    problems,
    warnings,
    tokensIn: res.usage.in,
    tokensOut: res.usage.out
  };
}

export async function runPrioritizationStage(
  workspaceId: string,
  framework: 'RICE' | 'ICE' | 'WSJF',
  problems: Problem[],
  goals: Goal[],
  providerId: 'anthropic' | 'openai' | 'google',
  model: string,
  key: string,
  signal?: AbortSignal,
  feedback?: string
): Promise<{ features: Feature[]; warnings: string[]; tokensIn: number; tokensOut: number }> {
  const provider = getProvider(providerId);
  const inputData = {
    problems: problems.map((p) => ({
      id: p.id,
      statement: p.statement,
      whoAffected: p.whoAffected,
      severity: p.severity,
      opportunity: p.opportunity
    })),
    goals: goals.map((g) => ({ id: g.id, statement: g.statement, metric: g.metric }))
  };

  const res = await provider.generate({
    key,
    model,
    system: getPrioritizationPrompt(framework, feedback),
    messages: [{ role: 'user', content: JSON.stringify(inputData, null, 2) }],
    json: true,
    signal
  });

  const extracted = extractJson(res.text);
  const parsed = PrioritizationStageOutputSchema.parse(extracted.data);

  const problemMap = new Map(problems.map((p) => [p.id, p]));
  const goalMap = new Map(goals.map((g) => [g.id, g]));
  const warnings: string[] = [];
  const rawFeatures: any[] = [];
  let fIndex = 1;

  for (const item of parsed.features.slice(0, 10)) {
    const validProblemIds = item.problemIds.filter((pid) => problemMap.has(pid));
    if (validProblemIds.length === 0) {
      warnings.push(`Dropped feature "${item.name}": no valid problem IDs.`);
      continue;
    }

    let goalId = item.impact?.goalId;
    if (goalId && !goalMap.has(goalId)) {
      warnings.push(`Impact for "${item.name}" referenced unknown goal ID ${goalId}; unlinked.`);
      goalId = undefined;
    }

    const { score, incomplete } = computeScore(framework, item.inputs || {});

    rawFeatures.push({
      id: formatFeatureId(fIndex++),
      workspaceId,
      name: item.name,
      description: item.description,
      problemIds: validProblemIds,
      impact: {
        goalId,
        metric: item.impact?.metric || 'Product Metric',
        direction: item.impact?.direction || 'increase',
        estimate: item.impact?.estimate || '',
        assumptions: item.impact?.assumptions || [],
        confidence: item.impact?.confidence || 'medium'
      },
      priority: {
        framework,
        inputs: item.inputs || {},
        score,
        rank: 0,
        incomplete
      }
    });
  }

  if (rawFeatures.length === 0) {
    throw new Error('The model returned no usable features. Try a stronger model or verify problems.');
  }

  // Rank features deterministically in code
  const rankedFeatures = rankFeatures(
    rawFeatures.map((f) => ({
      ...f,
      score: f.priority.score,
      inputs: f.priority.inputs
    }))
  ).map((rf) => ({
    ...rf,
    priority: {
      ...rf.priority,
      rank: rf.rank
    }
  }));

  return {
    features: rankedFeatures as Feature[],
    warnings,
    tokensIn: res.usage.in,
    tokensOut: res.usage.out
  };
}

export async function runPRDStage(
  workspaceId: string,
  features: Feature[],
  problems: Problem[],
  evidence: Evidence[],
  goals: Goal[],
  providerId: 'anthropic' | 'openai' | 'google',
  model: string,
  key: string,
  signal?: AbortSignal,
  feedback?: string
): Promise<{ prd: PRDDoc; requirements: Requirement[]; warnings: string[]; tokensIn: number; tokensOut: number }> {
  const provider = getProvider(providerId);
  const topFeatures = features.slice(0, 5);
  const problemMap = new Map(problems.map((p) => [p.id, p]));
  const evMap = new Map(evidence.map((e) => [e.id, e]));

  const inputData = {
    features: topFeatures.map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      problemIds: f.problemIds,
      rank: f.priority.rank
    })),
    problems: problems.map((p) => ({
      id: p.id,
      statement: p.statement,
      evidenceIds: p.evidenceIds
    })),
    goals: goals.map((g) => ({ id: g.id, statement: g.statement, metric: g.metric }))
  };

  const res = await provider.generate({
    key,
    model,
    system: getPRDPrompt(feedback),
    messages: [{ role: 'user', content: JSON.stringify(inputData, null, 2) }],
    json: true,
    signal
  });

  const extracted = extractJson(res.text);
  const parsed = PRDStageOutputSchema.parse(extracted.data);
  const warnings: string[] = [];

  const featureMap = new Map(features.map((f) => [f.id, f]));
  const requirements: Requirement[] = [];
  let reqIndex = 1;

  for (const item of parsed.requirements) {
    let featureId = item.featureId;
    if (!featureMap.has(featureId)) {
      featureId = topFeatures[0]?.id || 'F01';
    }

    const feature = featureMap.get(featureId);
    let validProblemIds = item.problemIds.filter((pid) => problemMap.has(pid));
    if (validProblemIds.length === 0 && feature) {
      validProblemIds = feature.problemIds;
    }

    let validEvidenceIds = item.evidenceIds.filter((eid) => evMap.has(eid));
    if (validEvidenceIds.length === 0) {
      // Inherit from problems
      for (const pid of validProblemIds) {
        const prob = problemMap.get(pid);
        if (prob) validEvidenceIds.push(...prob.evidenceIds);
      }
      validEvidenceIds = Array.from(new Set(validEvidenceIds));
    }

    const acceptanceCriteria = (item.acceptanceCriteria || []).map((ac) => ({
      given: ac.given || 'Precondition is met',
      when: ac.when || 'Action occurs',
      then: ac.then || 'Expected result'
    }));

    if (acceptanceCriteria.length === 0) {
      acceptanceCriteria.push({
        given: 'User is authenticated and on the target view',
        when: 'The user interacts with the feature control',
        then: 'The system responds according to specification'
      });
      warnings.push(`Requirement "${item.text.slice(0, 30)}..." was missing acceptance criteria; added baseline.`);
    }

    requirements.push({
      id: formatRequirementId(reqIndex++),
      workspaceId,
      featureId,
      text: item.text || 'Requirement specification',
      type: item.type || 'functional',
      priority: item.priority || 'must',
      acceptanceCriteria,
      evidenceIds: validEvidenceIds,
      problemIds: validProblemIds
    });
  }

  const prdDoc: PRDDoc = {
    workspaceId,
    title: parsed.title || 'Product Requirements Document',
    overview: parsed.overview || '',
    problemStatement: parsed.problemStatement || '',
    goals: parsed.goals || [],
    nonGoals: parsed.nonGoals || [],
    personas: parsed.personas || [],
    successMetrics: parsed.successMetrics || [],
    risks: parsed.risks || [],
    openQuestions: parsed.openQuestions || [],
    dependencies: parsed.dependencies || []
  };

  return {
    prd: prdDoc,
    requirements,
    warnings,
    tokensIn: res.usage.in,
    tokensOut: res.usage.out
  };
}

export async function runRoadmapStage(
  workspaceId: string,
  features: Feature[],
  capacityConstraints?: string,
  providerId: 'anthropic' | 'openai' | 'google' = 'google',
  model: string = 'gemini-2.5-flash',
  key: string = '',
  signal?: AbortSignal,
  feedback?: string
): Promise<{ items: RoadmapItem[]; warnings: string[]; tokensIn: number; tokensOut: number }> {
  const provider = getProvider(providerId);
  const inputData = {
    features: features.map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      rank: f.priority.rank,
      score: f.priority.score
    })),
    capacityConstraints
  };

  const res = await provider.generate({
    key,
    model,
    system: getRoadmapPrompt(capacityConstraints, feedback),
    messages: [{ role: 'user', content: JSON.stringify(inputData, null, 2) }],
    json: true,
    signal
  });

  const extracted = extractJson(res.text);
  const parsed = RoadmapStageOutputSchema.parse(extracted.data);
  const warnings: string[] = [];

  const featureMap = new Map(features.map((f) => [f.id, f]));
  const seenFeatureIds = new Set<string>();
  const roadmapItems: RoadmapItem[] = [];

  for (const item of parsed.items) {
    if (!featureMap.has(item.featureId)) continue;
    if (seenFeatureIds.has(item.featureId)) continue;
    seenFeatureIds.add(item.featureId);

    // Remove self-dependency or invalid dependency
    const cleanDependsOn = (item.dependsOn || []).filter(
      (depId) => depId !== item.featureId && featureMap.has(depId)
    );

    roadmapItems.push({
      id: `${workspaceId}_rm_${item.featureId}`,
      workspaceId,
      featureId: item.featureId,
      horizon: item.horizon || 'later',
      dependsOn: cleanDependsOn,
      rationale: item.rationale || 'Prioritized based on rank and dependencies.',
      risks: item.risks || []
    });
  }

  // Ensure every ranked feature appears in the roadmap
  for (const f of features) {
    if (!seenFeatureIds.has(f.id)) {
      roadmapItems.push({
        id: `${workspaceId}_rm_${f.id}`,
        workspaceId,
        featureId: f.id,
        horizon: 'later',
        dependsOn: [],
        rationale: 'Automatically assigned to later horizon.',
        risks: []
      });
      warnings.push(`Feature ${f.id} (${f.name}) was missing from roadmap; appended to "later".`);
    }
  }

  return {
    items: roadmapItems,
    warnings,
    tokensIn: res.usage.in,
    tokensOut: res.usage.out
  };
}

export async function runReviewStage(
  workspaceId: string,
  prd: PRDDoc,
  requirements: Requirement[],
  features: Feature[],
  evidence: Evidence[],
  goals: Goal[],
  providerId: 'anthropic' | 'openai' | 'google',
  model: string,
  key: string,
  signal?: AbortSignal,
  feedback?: string
): Promise<{ review: ExecReview; warnings: string[]; tokensIn: number; tokensOut: number }> {
  const provider = getProvider(providerId);
  const inputData = {
    prd,
    requirements: requirements.map((r) => ({
      id: r.id,
      text: r.text,
      evidenceIds: r.evidenceIds,
      acceptanceCriteriaCount: r.acceptanceCriteria.length
    })),
    features: features.map((f) => ({
      id: f.id,
      name: f.name,
      impact: f.impact,
      score: f.priority.score
    })),
    goalsCount: goals.length
  };

  const res = await provider.generate({
    key,
    model,
    system: getExecReviewPrompt(feedback),
    messages: [{ role: 'user', content: JSON.stringify(inputData, null, 2) }],
    json: true,
    signal
  });

  const extracted = extractJson(res.text);
  const parsed = ExecReviewStageOutputSchema.parse(extracted.data);
  const warnings: string[] = [];

  // Coverage statistics & code-override check per Section 9.4
  let forcedByCode = false;
  let overrideReason = '';

  const evMap = new Map(evidence.map((e) => [e.id, e]));

  // Check 1: No goals exist
  if (goals.length === 0) {
    forcedByCode = true;
    overrideReason = 'No business goals defined. Product initiatives must tie to organizational OKRs.';
  }

  // Check 2: Unverified quotes cited by requirements
  let unverifiedRequirementCount = 0;
  for (const r of requirements) {
    const hasUnverified = r.evidenceIds.some((eid) => evMap.get(eid)?.verified === false);
    if (hasUnverified) {
      unverifiedRequirementCount++;
    }
  }

  if (unverifiedRequirementCount > 0) {
    forcedByCode = true;
    overrideReason = `${unverifiedRequirementCount} requirement(s) cite unverified quotes that could not be traced in source documents.`;
  }

  let finalVerdict: 'approved' | 'needs_work' | 'rejected' = parsed.verdict;
  if (forcedByCode) {
    finalVerdict = 'needs_work';
    parsed.weakestLinks.unshift(`[AUTOMATIC AUDIT OVERRIDE] ${overrideReason}`);
  }

  const review: ExecReview = {
    workspaceId,
    verdict: finalVerdict,
    rubric: parsed.rubric,
    execQuestions: parsed.execQuestions || [],
    weakestLinks: parsed.weakestLinks || [],
    missingEvidence: parsed.missingEvidence || [],
    forcedByCode
  };

  return {
    review,
    warnings,
    tokensIn: res.usage.in,
    tokensOut: res.usage.out
  };
}
