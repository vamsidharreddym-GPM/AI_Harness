/**
 * Dexie database for AI PM Harness with automatic in-memory fallback.
 */
import Dexie, { type Table } from 'dexie';

export type SourceType =
  | 'interview'
  | 'ticket'
  | 'analytics'
  | 'competitor'
  | 'feature_request'
  | 'prd'
  | 'business_goal'
  | 'other';

export type StageId =
  | 'research'
  | 'insight'
  | 'problem'
  | 'prioritization'
  | 'prd'
  | 'roadmap'
  | 'review';

export interface Workspace {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: {
    framework: 'RICE' | 'ICE' | 'WSJF';
    lite: boolean;
    stageModels: Record<StageId, { provider: 'anthropic' | 'openai' | 'google'; model: string }>;
  };
}

export interface SourceDoc {
  id: string;
  workspaceId: string;
  seq: number;
  name: string;
  type: SourceType;
  mime: string;
  text: string;
  tokenEst: number;
  hash: string;
  status: 'ok' | 'error' | 'empty';
  error?: string;
  uploadedAt: number;
}

export interface Chunk {
  id: string; // e.g. "D3-C12"
  workspaceId: string;
  docId: string;
  seq: number;
  heading?: string;
  text: string;
  start: number;
  end: number;
}

export interface Evidence {
  id: string; // E001
  workspaceId: string;
  kind: 'statement' | 'request' | 'metric' | 'competitor_fact' | 'goal_signal' | 'web_fact';
  origin: 'document' | 'web' | 'human';
  chunkId?: string;
  docId?: string;
  url?: string;
  retrievedAt?: number;
  quote: string;
  verified: boolean | null;
  speaker?: string;
  segment?: string;
  sentiment?: 'positive' | 'neutral' | 'negative' | 'frustrated';
  theme?: string;
  metric?: {
    name: string;
    value: string;
    period?: string;
    trend?: 'up' | 'down' | 'flat';
  };
}

export interface Goal {
  id: string; // G01
  workspaceId: string;
  statement: string;
  metric: string;
  target: string;
  timeframe: string;
  priority: 1 | 2 | 3;
  evidenceIds: string[];
}

export interface Insight {
  id: string; // I01
  workspaceId: string;
  title: string;
  description: string;
  evidenceIds: string[];
  sourceTypes: SourceType[];
  contradictions: string[];
}

export interface Problem {
  id: string; // P01
  workspaceId: string;
  statement: string;
  whoAffected: string;
  severity: number;
  frequency: string;
  insightIds: string[];
  evidenceIds: string[];
  confidence: 'anecdotal' | 'corroborated' | 'triangulated';
  sourceTypeCount: number;
  opportunity: {
    id: string; // O01
    description: string;
    goalIds: string[];
  };
}

export interface PriorityInput {
  value: number;
  rationale: string;
  confidence: string;
  overridden?: boolean;
}

export interface Feature {
  id: string; // F01
  workspaceId: string;
  name: string;
  description: string;
  problemIds: string[];
  impact: {
    goalId?: string;
    metric: string;
    direction: 'increase' | 'decrease';
    estimate: string;
    assumptions: string[];
    confidence: string;
  };
  priority: {
    framework: 'RICE' | 'ICE' | 'WSJF';
    inputs: Record<string, PriorityInput>;
    score: number;
    rank: number;
    incomplete: boolean;
  };
}

export interface Requirement {
  id: string; // FR-001
  workspaceId: string;
  featureId: string;
  text: string;
  type: 'functional' | 'non-functional' | 'ui' | 'integration';
  priority: 'must' | 'should' | 'could';
  acceptanceCriteria: Array<{
    given: string;
    when: string;
    then: string;
  }>;
  evidenceIds: string[];
  problemIds: string[];
}

export interface PRDDoc {
  workspaceId: string;
  title: string;
  overview: string;
  problemStatement: string;
  goals: string[];
  nonGoals: string[];
  personas: Array<{ name: string; description: string }>;
  successMetrics: Array<{ metric: string; target: string; goalId?: string }>;
  risks: string[];
  openQuestions: string[];
  dependencies: string[];
}

export interface RoadmapItem {
  id: string;
  workspaceId: string;
  featureId: string;
  horizon: 'now' | 'next' | 'later';
  dependsOn: string[];
  rationale: string;
  risks: string[];
}

export interface ExecReview {
  workspaceId: string;
  verdict: 'approved' | 'needs_work' | 'rejected';
  rubric: {
    evidenceStrength: { score: number; note: string };
    strategicFit: { score: number; note: string };
    feasibilityClarity: { score: number; note: string };
    metricQuality: { score: number; note: string };
    riskCoverage: { score: number; note: string };
  };
  execQuestions: string[];
  weakestLinks: string[];
  missingEvidence: string[];
  forcedByCode: boolean;
}

export interface StageState {
  id: string; // `${workspaceId}_${stage}`
  workspaceId: string;
  stage: StageId;
  status: 'idle' | 'running' | 'draft' | 'approved' | 'rejected' | 'stale' | 'failed' | 'skipped';
  provider: 'anthropic' | 'openai' | 'google';
  model: string;
  tokensIn: number;
  tokensOut: number;
  startedAt?: number;
  durationMs?: number;
  warnings: string[];
  error?: string;
  rejectReason?: string;
  inputHash?: string;
  output?: any;
  approvedAt?: number;
}

export interface Thread {
  id: string;
  workspaceId: string;
  title: string;
  provider: 'anthropic' | 'openai' | 'google';
  model: string;
  scope: 'all' | 'selected' | 'type';
  scopeDocIds?: string[];
  scopeType?: SourceType;
  useWeb: boolean;
  mode: 'auto' | 'full' | 'retrieval';
  summary?: string;
  createdAt: number;
}

export interface CitationItem {
  type: 'doc' | 'web';
  chunkId?: string;
  url?: string;
  title?: string;
  valid?: boolean;
}

export interface Message {
  id: string;
  workspaceId: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  provider?: 'anthropic' | 'openai' | 'google';
  model?: string;
  citations: CitationItem[];
  tokens?: { in: number; out: number };
  createdAt: number;
  error?: string;
}

export interface RunLog {
  id: string;
  ts: number;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

class AppDexieDb extends Dexie {
  workspaces!: Table<Workspace, string>;
  sourceDocs!: Table<SourceDoc, string>;
  chunks!: Table<Chunk, string>;
  evidence!: Table<Evidence, string>;
  goals!: Table<Goal, string>;
  insights!: Table<Insight, string>;
  problems!: Table<Problem, string>;
  features!: Table<Feature, string>;
  requirements!: Table<Requirement, string>;
  prds!: Table<PRDDoc, string>;
  roadmapItems!: Table<RoadmapItem, string>;
  reviews!: Table<ExecReview, string>;
  stageStates!: Table<StageState, string>;
  threads!: Table<Thread, string>;
  messages!: Table<Message, string>;
  runLogs!: Table<RunLog, string>;

  constructor() {
    super('AIPMHarnessDB');
    this.version(1).stores({
      workspaces: 'id, createdAt',
      sourceDocs: 'id, workspaceId, seq, type, hash',
      chunks: 'id, workspaceId, docId',
      evidence: 'id, workspaceId, kind, verified, chunkId',
      goals: 'id, workspaceId',
      insights: 'id, workspaceId',
      problems: 'id, workspaceId, confidence',
      features: 'id, workspaceId',
      requirements: 'id, workspaceId, featureId',
      prds: 'workspaceId',
      roadmapItems: 'id, workspaceId, featureId',
      reviews: 'workspaceId',
      stageStates: 'id, workspaceId, stage',
      threads: 'id, workspaceId, createdAt',
      messages: 'id, workspaceId, threadId, createdAt',
      runLogs: 'id, ts, level'
    });
  }
}

export const db = new AppDexieDb();

// Memory tables fallback if IndexedDB fails entirely
export class MemoryTable<T extends { id?: string; workspaceId?: string }> {
  private items: Map<string, T> = new Map();

  async toArray(): Promise<T[]> {
    return Array.from(this.items.values());
  }

  async get(key: string): Promise<T | undefined> {
    return this.items.get(key);
  }

  async put(item: T): Promise<string> {
    const id = (item as any).id || (item as any).workspaceId || String(Date.now());
    this.items.set(id, item);
    return id;
  }

  async bulkPut(items: T[]): Promise<void> {
    for (const item of items) {
      await this.put(item);
    }
  }

  async delete(key: string): Promise<void> {
    this.items.delete(key);
  }

  async where(field: string): Promise<{ equals: (val: any) => Promise<T[]> }> {
    return {
      equals: async (val: any) => {
        return Array.from(this.items.values()).filter((item: any) => item[field] === val);
      }
    };
  }

  async clear(): Promise<void> {
    this.items.clear();
  }
}
