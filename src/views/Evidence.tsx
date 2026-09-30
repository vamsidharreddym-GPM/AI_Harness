/**
 * Evidence Explorer view: horizontal evidence flow cards, coverage panel, and reverse traceability.
 */
import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  Clock,
  ExternalLink,
  FileText,
  Filter,
  Layers,
  Search,
  ShieldAlert,
  Sparkles,
  Tag
} from 'lucide-react';
import { Badge } from '../components/Badge';
import { useAppStore } from '../store/app';
import {
  Chunk,
  db,
  Evidence,
  Feature,
  Goal,
  Problem,
  Requirement,
  SourceDoc
} from '../store/db';

export const EvidenceView: React.FC = () => {
  const { activeWorkspaceId, openDrawer } = useAppStore();

  const [activeTab, setActiveTab] = useState<'requirements' | 'features' | 'problems' | 'evidence'>('requirements');
  const [reverseTrace, setReverseTrace] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Loaded database entities
  const [evidenceList, setEvidenceList] = useState<Evidence[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [docs, setDocs] = useState<SourceDoc[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    async function loadData() {
      const ev = await db.evidence.where('workspaceId').equals(activeWorkspaceId!).toArray();
      const p = await db.problems.where('workspaceId').equals(activeWorkspaceId!).toArray();
      const f = await db.features.where('workspaceId').equals(activeWorkspaceId!).toArray();
      const r = await db.requirements.where('workspaceId').equals(activeWorkspaceId!).toArray();
      const g = await db.goals.where('workspaceId').equals(activeWorkspaceId!).toArray();
      const d = await db.sourceDocs.where('workspaceId').equals(activeWorkspaceId!).toArray();

      setEvidenceList(ev);
      setProblems(p);
      setFeatures(f);
      setRequirements(r);
      setGoals(g);
      setDocs(d);

      if (r.length > 0 && !selectedId) {
        setSelectedId(r[0].id);
      } else if (p.length > 0 && !selectedId) {
        setSelectedId(p[0].id);
      }
    }
    loadData();
  }, [activeWorkspaceId]);

  // Maps for fast lookups
  const evMap = new Map(evidenceList.map((e) => [e.id, e]));
  const problemMap = new Map(problems.map((p) => [p.id, p]));
  const featureMap = new Map(features.map((f) => [f.id, f]));
  const goalMap = new Map(goals.map((g) => [g.id, g]));
  const docMap = new Map(docs.map((d) => [d.id, d]));

  // Coverage statistics computed in code
  const totalReqs = requirements.length;
  let triangulatedReqs = 0;
  let corroboratedReqs = 0;
  let anecdotalReqs = 0;

  for (const req of requirements) {
    const pList = req.problemIds.map((pid) => problemMap.get(pid)).filter(Boolean);
    const confidences = pList.map((p) => p?.confidence);
    if (confidences.includes('triangulated')) {
      triangulatedReqs++;
    } else if (confidences.includes('corroborated')) {
      corroboratedReqs++;
    } else {
      anecdotalReqs++;
    }
  }

  const unverifiedEvidenceCount = evidenceList.filter((e) => e.verified === false).length;
  const orphanEvidenceCount = evidenceList.filter((e) => {
    const citedInProblems = problems.some((p) => p.evidenceIds.includes(e.id));
    const citedInReqs = requirements.some((r) => r.evidenceIds.includes(e.id));
    return !citedInProblems && !citedInReqs;
  }).length;

  const unlinkedFeaturesCount = features.filter((f) => !f.impact?.goalId).length;
  const missingAcReqsCount = requirements.filter((r) => !r.acceptanceCriteria || r.acceptanceCriteria.length === 0).length;

  // Render chain for selected requirement or problem
  const renderChain = () => {
    if (!selectedId) {
      return (
        <div className="p-12 text-center text-neutral-400 text-xs">
          Select an item from the left panel to trace its customer evidence chain.
        </div>
      );
    }

    if (activeTab === 'requirements') {
      const req = requirements.find((r) => r.id === selectedId);
      if (!req) return <div className="p-8 text-neutral-400 text-xs">Item not found</div>;

      const feature = featureMap.get(req.featureId);
      const probList = req.problemIds.map((pid) => problemMap.get(pid)).filter(Boolean) as Problem[];
      const evItems = req.evidenceIds.map((eid) => evMap.get(eid)).filter(Boolean) as Evidence[];
      const goal = feature?.impact?.goalId ? goalMap.get(feature.impact.goalId) : undefined;

      return (
        <div className="space-y-6">
          <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="purple">{req.id}</Badge>
              <span className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">{req.text}</span>
            </div>
            <div className="text-xs text-neutral-500 font-mono">
              Priority: <span className="uppercase font-semibold">{req.priority}</span> · Acceptance Criteria: {req.acceptanceCriteria?.length || 0}
            </div>
          </div>

          <div className="overflow-x-auto pb-4">
            <div className="flex items-start gap-4 min-w-[900px]">
              {/* Card 1: Verbatim Customer Evidence */}
              <div className="w-64 shrink-0 p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                  <span>Customer Quotes</span>
                  <Tag className="w-3.5 h-3.5" />
                </div>
                {evItems.length === 0 ? (
                  <div className="text-xs text-neutral-400 italic">No direct quotes attached</div>
                ) : (
                  evItems.slice(0, 3).map((ev) => (
                    <div
                      key={ev.id}
                      onClick={() => openDrawer('source', `${ev.id} Evidence Quote`, { chunkId: ev.chunkId, quote: ev.quote })}
                      className="p-2.5 rounded-lg border border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 hover:border-indigo-400 cursor-pointer space-y-1 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <Badge variant="default" size="sm">{ev.id}</Badge>
                        {ev.verified === true && <Badge variant="success" size="sm">Verified</Badge>}
                        {ev.verified === false && <Badge variant="warning" size="sm">Unverified</Badge>}
                        {ev.origin === 'web' && <Badge variant="info" size="sm">Web</Badge>}
                      </div>
                      <p className="text-xs text-neutral-700 dark:text-neutral-300 italic line-clamp-3">
                        "{ev.quote}"
                      </p>
                      {ev.speaker && <div className="text-[10px] text-neutral-400 font-mono">— {ev.speaker}</div>}
                    </div>
                  ))
                )}
              </div>

              <ArrowRight className="w-5 h-5 text-neutral-400 shrink-0 mt-16" />

              {/* Card 2: Extracted Problem */}
              <div className="w-64 shrink-0 p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                  <span>Problem</span>
                  <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
                </div>
                {probList.length === 0 ? (
                  <div className="text-xs text-neutral-400 italic">No linked problems</div>
                ) : (
                  probList.map((p) => (
                    <div key={p.id} className="p-2.5 rounded-lg border border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 space-y-1">
                      <div className="flex items-center justify-between">
                        <Badge variant="error" size="sm">{p.id}</Badge>
                        <Badge variant={p.confidence} size="sm">{p.confidence}</Badge>
                      </div>
                      <p className="text-xs text-neutral-800 dark:text-neutral-200 font-medium">
                        {p.statement}
                      </p>
                      <div className="text-[10px] text-neutral-400">Severity: {p.severity}/5 · {p.whoAffected}</div>
                    </div>
                  ))
                )}
              </div>

              <ArrowRight className="w-5 h-5 text-neutral-400 shrink-0 mt-16" />

              {/* Card 3: Proposed Feature & Impact */}
              <div className="w-64 shrink-0 p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                  <span>Proposed Feature</span>
                  <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                </div>
                {feature ? (
                  <div className="p-2.5 rounded-lg border border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Badge variant="purple" size="sm">{feature.id}</Badge>
                      <span className="text-xs font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                        Rank #{feature.priority?.rank || 1}
                      </span>
                    </div>
                    <div className="font-semibold text-xs text-neutral-900 dark:text-neutral-100">{feature.name}</div>
                    <p className="text-xs text-neutral-600 dark:text-neutral-300 line-clamp-2">{feature.description}</p>
                    <div className="pt-1 text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                      Impact: {feature.impact?.estimate || '+15%'} {feature.impact?.metric}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-neutral-400 italic">No feature linked</div>
                )}
              </div>

              <ArrowRight className="w-5 h-5 text-neutral-400 shrink-0 mt-16" />

              {/* Card 4: Business Goal Alignment */}
              <div className="w-64 shrink-0 p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                  <span>Business Goal</span>
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                </div>
                {goal ? (
                  <div className="p-2.5 rounded-lg border border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 space-y-1">
                    <Badge variant="success" size="sm">{goal.id}</Badge>
                    <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">{goal.statement}</div>
                    <div className="text-[10px] text-neutral-500 font-mono">
                      Target: {goal.target} · {goal.timeframe}
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 text-xs text-amber-700 dark:text-amber-400">
                    Not linked to any business OKR
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Coverage Statistics Panel */}
      <div className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-500" />
            <h3 className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
              Evidence Traceability & Coverage Audit
            </h3>
          </div>
          <span className="text-xs text-neutral-500 font-mono">
            {totalReqs} Requirements · {evidenceList.length} Quotes
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div className="p-3 rounded-lg border border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950">
            <div className="text-xs text-neutral-500">Triangulated Reqs</div>
            <div className="text-base font-semibold text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
              {totalReqs > 0 ? `${Math.round((triangulatedReqs / totalReqs) * 100)}%` : '0%'}
            </div>
          </div>
          <div className="p-3 rounded-lg border border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950">
            <div className="text-xs text-neutral-500">Unverified Quotes</div>
            <div className={`text-base font-semibold font-mono mt-0.5 ${unverifiedEvidenceCount > 0 ? 'text-amber-600' : 'text-neutral-700 dark:text-neutral-300'}`}>
              {unverifiedEvidenceCount}
            </div>
          </div>
          <div className="p-3 rounded-lg border border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950">
            <div className="text-xs text-neutral-500">Orphan Evidence</div>
            <div className="text-base font-semibold text-neutral-700 dark:text-neutral-300 font-mono mt-0.5">
              {orphanEvidenceCount}
            </div>
          </div>
          <div className="p-3 rounded-lg border border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950">
            <div className="text-xs text-neutral-500">Unlinked Features</div>
            <div className={`text-base font-semibold font-mono mt-0.5 ${unlinkedFeaturesCount > 0 ? 'text-amber-600' : 'text-neutral-700 dark:text-neutral-300'}`}>
              {unlinkedFeaturesCount}
            </div>
          </div>
        </div>
      </div>

      {/* Explorer Workspace */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column: Selector */}
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl bg-white dark:bg-neutral-900 overflow-hidden flex flex-col h-[600px]">
          <div className="p-3 border-b border-neutral-200 dark:border-neutral-800 flex gap-2 text-xs">
            <button
              onClick={() => setActiveTab('requirements')}
              className={`flex-1 py-1.5 rounded font-medium cursor-pointer transition-colors ${
                activeTab === 'requirements'
                  ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                  : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
              }`}
            >
              Requirements ({requirements.length})
            </button>
            <button
              onClick={() => setActiveTab('problems')}
              className={`flex-1 py-1.5 rounded font-medium cursor-pointer transition-colors ${
                activeTab === 'problems'
                  ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                  : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
              }`}
            >
              Problems ({problems.length})
            </button>
          </div>

          <div className="p-2.5 border-b border-neutral-100 dark:border-neutral-800">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-neutral-400" />
              <input
                type="text"
                placeholder="Filter items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 pl-7 pr-2 py-1"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {activeTab === 'requirements' ? (
              requirements.map((r) => (
                <div
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={`p-2.5 rounded-lg text-xs cursor-pointer transition-all border ${
                    r.id === selectedId
                      ? 'border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/40 font-medium'
                      : 'border-transparent hover:bg-neutral-50 dark:hover:bg-neutral-800/60 text-neutral-800 dark:text-neutral-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <Badge variant="purple" size="sm">{r.id}</Badge>
                    <span className="text-[10px] text-neutral-400 uppercase font-mono">{r.priority}</span>
                  </div>
                  <p className="line-clamp-2 leading-relaxed">{r.text}</p>
                </div>
              ))
            ) : (
              problems.map((p) => (
                <div
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`p-2.5 rounded-lg text-xs cursor-pointer transition-all border ${
                    p.id === selectedId
                      ? 'border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/40 font-medium'
                      : 'border-transparent hover:bg-neutral-50 dark:hover:bg-neutral-800/60 text-neutral-800 dark:text-neutral-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <Badge variant="error" size="sm">{p.id}</Badge>
                    <Badge variant={p.confidence} size="sm">{p.confidence}</Badge>
                  </div>
                  <p className="line-clamp-2 leading-relaxed">{p.statement}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Area: Horizontal Chain Flow */}
        <div className="md:col-span-2 border border-neutral-200 dark:border-neutral-800 rounded-xl bg-neutral-50/50 dark:bg-neutral-950/30 p-5 overflow-hidden">
          {renderChain()}
        </div>
      </div>
    </div>
  );
};
