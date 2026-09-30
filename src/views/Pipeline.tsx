/**
 * Pipeline view (hero component): interactive stepper, stage execution, PM approvals/rejections, and feedback injection.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  Play,
  RefreshCw,
  Sliders,
  Square,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  X
} from 'lucide-react';
import { Badge } from '../components/Badge';
import { PreRunModal } from '../components/PreRunModal';
import { PromptViewerModal } from '../components/PromptViewerModal';
import { RawOutputModal } from '../components/RawOutputModal';
import { formatTokenCount } from '../lib/cost';
import {
  markDownstreamStale,
  runInsightStage,
  runPRDStage,
  runPrioritizationStage,
  runProblemStage,
  runResearchStage,
  runReviewStage,
  runRoadmapStage,
  STAGE_ORDER
} from '../pipeline/orchestrator';
import {
  getExecReviewPrompt,
  getInsightPrompt,
  getPrioritizationPrompt,
  getProblemPrompt,
  getPRDPrompt,
  getResearchPrompt,
  getRoadmapPrompt
} from '../pipeline/prompts';
import { useAppStore } from '../store/app';
import { ProviderId } from '../providers/types';
import { Chunk, db, SourceDoc, StageId, StageState } from '../store/db';

const STAGE_LABELS: Record<StageId, { title: string; desc: string }> = {
  research: { title: '1. Research Agents', desc: 'Map pass over interviews, tickets, analytics, competitor info, and business OKRs' },
  insight: { title: '2. Cross-Source Insight', desc: 'Synthesizes patterns, commonalities, and source contradictions' },
  problem: { title: '3. Problem Formulation', desc: 'Identifies affected users, severity, opportunities, and calculates evidence confidence' },
  prioritization: { title: '4. Scoring & Prioritization', desc: 'Formulates features, maps business impact, and computes RICE/ICE/WSJF scores' },
  prd: { title: '5. Product Requirements (PRD)', desc: 'Generates user personas, scope, success metrics, and traceable acceptance criteria' },
  roadmap: { title: '6. Release Roadmap', desc: 'Assigns features to Now / Next / Later horizons with dependency modeling' },
  review: { title: '7. Executive Review', desc: 'Evaluates evidence strength, strategic fit, metric quality, with automatic code override' }
};

export const PipelineView: React.FC = () => {
  const {
    activeWorkspaceId,
    workspaces,
    keys,
    selectedModels,
    addToast,
    addLog,
    addSessionTokens,
    openDrawer
  } = useAppStore();

  const [stageStates, setStageStates] = useState<Record<StageId, StageState>>({} as any);
  const [loading, setLoading] = useState(true);
  const [isRunningPipeline, setIsRunningPipeline] = useState(false);
  const [runningStage, setRunningStage] = useState<StageId | null>(null);

  // Pre-run modal state
  const [isPreRunOpen, setIsPreRunOpen] = useState(false);
  const [preRunTargetStage, setPreRunTargetStage] = useState<StageId | 'all'>('all');

  // Modals for prompt & raw output
  const [promptModal, setPromptModal] = useState<{ isOpen: boolean; title: string; text: string }>({
    isOpen: false,
    title: '',
    text: ''
  });
  const [rawOutputModal, setRawOutputModal] = useState<{ isOpen: boolean; title: string; text: string }>({
    isOpen: false,
    title: '',
    text: ''
  });

  // Rejection modal
  const [rejectingStage, setRejectingStage] = useState<StageId | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Expand state
  const [expandedStages, setExpandedStages] = useState<Record<StageId, boolean>>({
    research: true,
    insight: false,
    problem: false,
    prioritization: false,
    prd: false,
    roadmap: false,
    review: false
  });

  const abortRef = useRef<AbortController | null>(null);
  const currentWs = workspaces.find((w) => w.id === activeWorkspaceId);

  const loadPipelineStates = async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    try {
      const states = await db.stageStates.where('workspaceId').equals(activeWorkspaceId).toArray();
      const map: any = {};
      for (const s of states) {
        map[s.stage] = s;
      }
      // Populate defaults for idle stages
      for (const stage of STAGE_ORDER) {
        if (!map[stage]) {
          map[stage] = {
            id: `${activeWorkspaceId}_${stage}`,
            workspaceId: activeWorkspaceId,
            stage,
            status: 'idle',
            provider: 'google',
            model: selectedModels.google || 'gemini-2.5-flash',
            tokensIn: 0,
            tokensOut: 0,
            warnings: []
          };
        }
      }
      setStageStates(map);
    } catch (err) {
      console.warn('Error loading stage states:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPipelineStates();
  }, [activeWorkspaceId]);

  const toggleExpand = (stage: StageId) => {
    setExpandedStages((prev) => ({ ...prev, [stage]: !prev[stage] }));
  };

  const handleApprove = async (stage: StageId) => {
    if (!activeWorkspaceId) return;
    const current = stageStates[stage];
    if (!current) return;

    const updated: StageState = {
      ...current,
      status: 'approved',
      approvedAt: Date.now()
    };

    await db.stageStates.put(updated);
    setStageStates((prev) => ({ ...prev, [stage]: updated }));
    addToast({ type: 'success', message: `${STAGE_LABELS[stage].title} approved by PM.` });
  };

  const handleOpenReject = (stage: StageId) => {
    setRejectingStage(stage);
    setRejectReason(stageStates[stage]?.rejectReason || '');
  };

  const handleConfirmReject = async () => {
    if (!activeWorkspaceId || !rejectingStage || !rejectReason.trim()) return;

    const current = stageStates[rejectingStage];
    const updated: StageState = {
      ...current,
      status: 'rejected',
      rejectReason: rejectReason.trim()
    };

    await db.stageStates.put(updated);
    await markDownstreamStale(activeWorkspaceId, rejectingStage);

    setStageStates((prev) => ({ ...prev, [rejectingStage]: updated }));
    setRejectingStage(null);
    setRejectReason('');

    addToast({
      type: 'warn',
      message: `${STAGE_LABELS[rejectingStage].title} rejected with feedback. Downstream stages marked stale.`
    });
    await loadPipelineStates();
  };

  const executeStage = async (
    stage: StageId,
    modelsConfig: Record<StageId, { provider: ProviderId; model: string }>,
    signal: AbortSignal
  ) => {
    if (!activeWorkspaceId) return;

    const stageConfig = modelsConfig[stage] || { provider: 'google' as ProviderId, model: selectedModels.google };
    const providerKey = keys[stageConfig.provider];
    if (!providerKey) {
      throw new Error(`Stage "${STAGE_LABELS[stage].title}" needs an API key for ${stageConfig.provider}.`);
    }

    setRunningStage(stage);
    const startTime = Date.now();

    const currentState = stageStates[stage] || {
      id: `${activeWorkspaceId}_${stage}`,
      workspaceId: activeWorkspaceId,
      stage,
      status: 'idle',
      provider: stageConfig.provider,
      model: stageConfig.model,
      tokensIn: 0,
      tokensOut: 0,
      warnings: []
    };

    const runningState: StageState = {
      ...currentState,
      status: 'running',
      provider: stageConfig.provider,
      model: stageConfig.model,
      startedAt: startTime,
      error: undefined
    };

    await db.stageStates.put(runningState);
    setStageStates((prev) => ({ ...prev, [stage]: runningState }));

    try {
      const docs = await db.sourceDocs.where('workspaceId').equals(activeWorkspaceId).toArray();
      const chunks = await db.chunks.where('workspaceId').equals(activeWorkspaceId).toArray();
      const feedback = currentState.rejectReason;

      let resultTokens = { in: 0, out: 0 };
      let warnings: string[] = [];

      if (stage === 'research') {
        const res = await runResearchStage(
          currentWs!,
          docs,
          chunks,
          stageConfig.provider,
          stageConfig.model,
          providerKey,
          signal,
          feedback,
          (msg) => addLog('info', msg)
        );

        // Store evidence & goals in db
        await db.evidence.where('workspaceId').equals(activeWorkspaceId).delete();
        await db.goals.where('workspaceId').equals(activeWorkspaceId).delete();
        await db.evidence.bulkPut(res.evidence);
        await db.goals.bulkPut(res.goals);

        resultTokens = { in: res.tokensIn, out: res.tokensOut };
        warnings = res.warnings;
      } else if (stage === 'insight') {
        const evidence = await db.evidence.where('workspaceId').equals(activeWorkspaceId).toArray();
        const res = await runInsightStage(
          activeWorkspaceId,
          evidence,
          docs,
          stageConfig.provider,
          stageConfig.model,
          providerKey,
          signal,
          feedback
        );

        await db.insights.where('workspaceId').equals(activeWorkspaceId).delete();
        await db.insights.bulkPut(res.insights);

        resultTokens = { in: res.tokensIn, out: res.tokensOut };
        warnings = res.warnings;
      } else if (stage === 'problem') {
        const insights = await db.insights.where('workspaceId').equals(activeWorkspaceId).toArray();
        const evidence = await db.evidence.where('workspaceId').equals(activeWorkspaceId).toArray();
        const goals = await db.goals.where('workspaceId').equals(activeWorkspaceId).toArray();

        const res = await runProblemStage(
          activeWorkspaceId,
          insights,
          evidence,
          docs,
          goals,
          stageConfig.provider,
          stageConfig.model,
          providerKey,
          signal,
          feedback
        );

        await db.problems.where('workspaceId').equals(activeWorkspaceId).delete();
        await db.problems.bulkPut(res.problems);

        resultTokens = { in: res.tokensIn, out: res.tokensOut };
        warnings = res.warnings;
      } else if (stage === 'prioritization') {
        const problems = await db.problems.where('workspaceId').equals(activeWorkspaceId).toArray();
        const goals = await db.goals.where('workspaceId').equals(activeWorkspaceId).toArray();

        const res = await runPrioritizationStage(
          activeWorkspaceId,
          currentWs?.settings.framework || 'RICE',
          problems,
          goals,
          stageConfig.provider,
          stageConfig.model,
          providerKey,
          signal,
          feedback
        );

        await db.features.where('workspaceId').equals(activeWorkspaceId).delete();
        await db.features.bulkPut(res.features);

        resultTokens = { in: res.tokensIn, out: res.tokensOut };
        warnings = res.warnings;
      } else if (stage === 'prd') {
        const features = await db.features.where('workspaceId').equals(activeWorkspaceId).toArray();
        const problems = await db.problems.where('workspaceId').equals(activeWorkspaceId).toArray();
        const evidence = await db.evidence.where('workspaceId').equals(activeWorkspaceId).toArray();
        const goals = await db.goals.where('workspaceId').equals(activeWorkspaceId).toArray();

        const res = await runPRDStage(
          activeWorkspaceId,
          features,
          problems,
          evidence,
          goals,
          stageConfig.provider,
          stageConfig.model,
          providerKey,
          signal,
          feedback
        );

        await db.prds.put(res.prd);
        await db.requirements.where('workspaceId').equals(activeWorkspaceId).delete();
        await db.requirements.bulkPut(res.requirements);

        resultTokens = { in: res.tokensIn, out: res.tokensOut };
        warnings = res.warnings;
      } else if (stage === 'roadmap') {
        const features = await db.features.where('workspaceId').equals(activeWorkspaceId).toArray();

        const res = await runRoadmapStage(
          activeWorkspaceId,
          features,
          undefined,
          stageConfig.provider,
          stageConfig.model,
          providerKey,
          signal,
          feedback
        );

        await db.roadmapItems.where('workspaceId').equals(activeWorkspaceId).delete();
        await db.roadmapItems.bulkPut(res.items);

        resultTokens = { in: res.tokensIn, out: res.tokensOut };
        warnings = res.warnings;
      } else if (stage === 'review') {
        const prd = await db.prds.get(activeWorkspaceId);
        if (!prd) throw new Error('PRD stage must run before Executive Review.');
        const requirements = await db.requirements.where('workspaceId').equals(activeWorkspaceId).toArray();
        const features = await db.features.where('workspaceId').equals(activeWorkspaceId).toArray();
        const evidence = await db.evidence.where('workspaceId').equals(activeWorkspaceId).toArray();
        const goals = await db.goals.where('workspaceId').equals(activeWorkspaceId).toArray();

        const res = await runReviewStage(
          activeWorkspaceId,
          prd,
          requirements,
          features,
          evidence,
          goals,
          stageConfig.provider,
          stageConfig.model,
          providerKey,
          signal,
          feedback
        );

        await db.reviews.put(res.review);
        resultTokens = { in: res.tokensIn, out: res.tokensOut };
        warnings = res.warnings;
      }

      const durationMs = Date.now() - startTime;
      const completedState: StageState = {
        ...runningState,
        status: 'draft',
        tokensIn: resultTokens.in,
        tokensOut: resultTokens.out,
        durationMs,
        warnings
      };

      await db.stageStates.put(completedState);
      setStageStates((prev) => ({ ...prev, [stage]: completedState }));
      addSessionTokens(resultTokens.in, resultTokens.out);
      addLog('info', `Completed ${STAGE_LABELS[stage].title} in ${(durationMs / 1000).toFixed(1)}s.`);
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const failedState: StageState = {
        ...runningState,
        status: 'failed',
        error: err.message,
        durationMs
      };
      await db.stageStates.put(failedState);
      setStageStates((prev) => ({ ...prev, [stage]: failedState }));
      addToast({ type: 'error', message: `${STAGE_LABELS[stage].title} failed: ${err.message}` });
      throw err;
    } finally {
      setRunningStage(null);
    }
  };

  const handleStartPipeline = async (config: {
    stageModels: Record<StageId, { provider: any; model: string }>;
    lite: boolean;
  }) => {
    setIsPreRunOpen(false);
    setIsRunningPipeline(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (preRunTargetStage === 'all') {
        for (const stage of STAGE_ORDER) {
          if (controller.signal.aborted) break;
          await executeStage(stage, config.stageModels, controller.signal);
        }
        addToast({ type: 'success', message: 'All pipeline stages completed successfully!' });
      } else {
        await executeStage(preRunTargetStage, config.stageModels, controller.signal);
      }
    } catch (err: any) {
      console.warn('Pipeline run aborted or stopped with error:', err);
    } finally {
      setIsRunningPipeline(false);
      abortRef.current = null;
    }
  };

  const handleCancelPipeline = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      addToast({ type: 'info', message: 'Pipeline execution cancelled by user.' });
    }
  };

  const getStagePromptText = (stage: StageId): string => {
    switch (stage) {
      case 'research':
        return getResearchPrompt('customer');
      case 'insight':
        return getInsightPrompt();
      case 'problem':
        return getProblemPrompt();
      case 'prioritization':
        return getPrioritizationPrompt(currentWs?.settings.framework || 'RICE');
      case 'prd':
        return getPRDPrompt();
      case 'roadmap':
        return getRoadmapPrompt();
      case 'review':
        return getExecReviewPrompt();
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Top Controls Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xs">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            End-to-End Product Pipeline
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Run specialized agents sequentially with full evidence chain verification and human PM approval gates.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {isRunningPipeline ? (
            <button
              type="button"
              onClick={handleCancelPipeline}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 cursor-pointer shadow-sm transition-colors"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              Cancel Execution
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setPreRunTargetStage('all');
                setIsPreRunOpen(true);
              }}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer shadow-sm transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
              Run All Stages
            </button>
          )}
        </div>
      </div>

      {/* Stage Cards Flow */}
      <div className="space-y-4">
        {STAGE_ORDER.map((stage, idx) => {
          const state = stageStates[stage];
          const info = STAGE_LABELS[stage];
          const isExpanded = expandedStages[stage];
          const isRunning = runningStage === stage;
          const prevStage = idx > 0 ? STAGE_ORDER[idx - 1] : null;
          const prevStatus = prevStage ? stageStates[prevStage]?.status : 'approved';
          const upstreamUnapproved = prevStatus && prevStatus !== 'approved' && prevStatus !== 'idle';

          return (
            <div
              key={stage}
              className={`rounded-xl border transition-all ${
                state?.status === 'approved'
                  ? 'border-emerald-300 dark:border-emerald-900/60 bg-white dark:bg-neutral-900'
                  : state?.status === 'stale'
                  ? 'border-amber-300 dark:border-amber-900/60 bg-white dark:bg-neutral-900'
                  : state?.status === 'failed'
                  ? 'border-rose-300 dark:border-rose-900/60 bg-white dark:bg-neutral-900'
                  : 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900'
              }`}
            >
              {/* Header */}
              <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-neutral-100 dark:border-neutral-800/60">
                <div className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
                        {info.title}
                      </h3>
                      {state?.status === 'approved' && <Badge variant="success" size="sm">Approved</Badge>}
                      {state?.status === 'stale' && <Badge variant="warning" size="sm">Stale (Upstream Changed)</Badge>}
                      {state?.status === 'failed' && <Badge variant="error" size="sm">Failed</Badge>}
                      {state?.status === 'draft' && <Badge variant="info" size="sm">Draft Ready</Badge>}
                      {state?.status === 'rejected' && <Badge variant="error" size="sm">Rejected</Badge>}
                      {isRunning && <Badge variant="purple" size="sm">Running...</Badge>}
                    </div>
                    <p className="text-xs text-neutral-500 mt-0.5">{info.desc}</p>
                  </div>
                </div>

                {/* Right controls */}
                <div className="flex items-center gap-2 self-end md:self-auto">
                  {state?.durationMs && (
                    <span className="text-[11px] text-neutral-400 font-mono">
                      {(state.durationMs / 1000).toFixed(1)}s · {formatTokenCount(state.tokensIn + state.tokensOut)} tok
                    </span>
                  )}

                  <button
                    type="button"
                    disabled={isRunningPipeline}
                    onClick={() => {
                      setPreRunTargetStage(stage);
                      setIsPreRunOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className="w-3 h-3" />
                    {state?.status === 'draft' || state?.status === 'approved' ? 'Re-run' : 'Run Stage'}
                  </button>

                  {state?.status === 'draft' && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleApprove(stage)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 border border-emerald-200 dark:border-emerald-800 cursor-pointer"
                      >
                        <ThumbsUp className="w-3 h-3" />
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenReject(stage)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-100 border border-rose-200 dark:border-rose-800 cursor-pointer"
                      >
                        <ThumbsDown className="w-3 h-3" />
                        Reject
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => toggleExpand(stage)}
                    aria-label="Toggle details"
                    className="p-1.5 rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer"
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Warnings / Notices */}
              {upstreamUnapproved && (
                <div className="px-4 py-2 bg-amber-50/50 dark:bg-amber-950/20 border-b border-amber-100 dark:border-amber-900/40 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>Upstream stage ({prevStage}) is not yet approved by PM. Results may shift.</span>
                </div>
              )}

              {state?.rejectReason && (
                <div className="px-4 py-2 bg-rose-50/50 dark:bg-rose-950/20 border-b border-rose-100 dark:border-rose-900/40 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>PM Feedback to address: "{state.rejectReason}"</span>
                </div>
              )}

              {/* Expanded details */}
              {isExpanded && (
                <div className="p-4 space-y-4 text-xs">
                  <div className="flex flex-wrap items-center gap-3 text-neutral-500 font-mono">
                    <span>Model: {state?.model || 'default'}</span>
                    <span>Tokens In: {formatTokenCount(state?.tokensIn || 0)}</span>
                    <span>Tokens Out: {formatTokenCount(state?.tokensOut || 0)}</span>
                    {state?.warnings && state.warnings.length > 0 && (
                      <span className="text-amber-600 dark:text-amber-400">
                        {state.warnings.length} warning(s)
                      </span>
                    )}
                  </div>

                  {/* Actions to inspect prompt or raw output */}
                  <div className="flex items-center gap-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                    <button
                      type="button"
                      onClick={() =>
                        setPromptModal({
                          isOpen: true,
                          title: info.title,
                          text: getStagePromptText(stage)
                        })
                      }
                      className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                    >
                      <Terminal className="w-3 h-3" />
                      View System Prompt
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Reject Modal */}
      {rejectingStage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4">
            <h3 className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
              Reject Stage: {STAGE_LABELS[rejectingStage].title}
            </h3>
            <p className="text-xs text-neutral-500 leading-relaxed">
              Provide feedback for the next run. This feedback will be directly injected into the agent's instructions, and downstream stages will be marked stale.
            </p>

            <textarea
              rows={4}
              placeholder="e.g. Focus on webhooks and error logging, drop the CRM integrations for now..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full text-xs rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-2.5"
              required
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRejectingStage(null)}
                className="px-3.5 py-1.5 text-xs text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!rejectReason.trim()}
                onClick={handleConfirmReject}
                className="px-4 py-1.5 text-xs font-medium text-white bg-rose-600 hover:bg-rose-500 rounded-md cursor-pointer disabled:opacity-50"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pre-Run Sheet Modal */}
      <PreRunModal
        isOpen={isPreRunOpen}
        onClose={() => setIsPreRunOpen(false)}
        onConfirm={handleStartPipeline}
        documentCount={currentWs ? 8 : 0}
        totalTokensEst={12000}
      />

      {/* Prompt Viewer Modal */}
      <PromptViewerModal
        isOpen={promptModal.isOpen}
        onClose={() => setPromptModal({ isOpen: false, title: '', text: '' })}
        title={promptModal.title}
        promptText={promptModal.text}
      />

      {/* Raw Output Modal */}
      <RawOutputModal
        isOpen={rawOutputModal.isOpen}
        onClose={() => setRawOutputModal({ isOpen: false, title: '', text: '' })}
        title={rawOutputModal.title}
        rawText={rawOutputModal.text}
      />
    </div>
  );
};
