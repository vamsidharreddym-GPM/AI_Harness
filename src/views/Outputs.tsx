/**
 * Outputs view: PRD document viewer, Roadmap kanban, Executive Review, and export suite.
 */
import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle,
  Award,
  CheckCircle,
  Clock,
  Download,
  FileCheck,
  FileSpreadsheet,
  FileText,
  MapPin,
  ShieldCheck,
  Sparkles
} from 'lucide-react';
import { Badge } from '../components/Badge';
import { sanitizeFilename } from '../lib/text';
import { useAppStore } from '../store/app';
import {
  db,
  Evidence,
  ExecReview,
  Feature,
  Goal,
  PRDDoc,
  Problem,
  Requirement,
  RoadmapItem,
  StageState
} from '../store/db';

export const OutputsView: React.FC = () => {
  const { activeWorkspaceId, workspaces, addToast, setActiveView, openDrawer } = useAppStore();

  const [activeTab, setActiveTab] = useState<'prd' | 'roadmap' | 'review' | 'appendix'>('prd');
  const [prd, setPrd] = useState<PRDDoc | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [evidenceList, setEvidenceList] = useState<Evidence[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [roadmapItems, setRoadmapItems] = useState<RoadmapItem[]>([]);
  const [review, setReview] = useState<ExecReview | null>(null);
  const [stageStates, setStageStates] = useState<Record<string, StageState>>({});
  const [signOffDate, setSignOffDate] = useState<string | null>(null);

  const currentWs = workspaces.find((w) => w.id === activeWorkspaceId);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    async function loadData() {
      const p = await db.prds.get(activeWorkspaceId!);
      const r = await db.requirements.where('workspaceId').equals(activeWorkspaceId!).toArray();
      const f = await db.features.where('workspaceId').equals(activeWorkspaceId!).toArray();
      const prob = await db.problems.where('workspaceId').equals(activeWorkspaceId!).toArray();
      const ev = await db.evidence.where('workspaceId').equals(activeWorkspaceId!).toArray();
      const g = await db.goals.where('workspaceId').equals(activeWorkspaceId!).toArray();
      const rm = await db.roadmapItems.where('workspaceId').equals(activeWorkspaceId!).toArray();
      const rev = await db.reviews.get(activeWorkspaceId!);
      const states = await db.stageStates.where('workspaceId').equals(activeWorkspaceId!).toArray();

      const stateMap: any = {};
      for (const s of states) stateMap[s.stage] = s;

      setPrd(p || null);
      setRequirements(r);
      setFeatures(f);
      setProblems(prob);
      setEvidenceList(ev);
      setGoals(g);
      setRoadmapItems(rm);
      setReview(rev || null);
      setStageStates(stateMap);
    }
    loadData();
  }, [activeWorkspaceId]);

  const prdApproved = stageStates['prd']?.status === 'approved';
  const roadmapApproved = stageStates['roadmap']?.status === 'approved';
  const reviewApproved = stageStates['review']?.status === 'approved';
  const canSignOff = prdApproved && roadmapApproved && reviewApproved;

  const handleSignOff = () => {
    const stamp = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
    setSignOffDate(stamp);
    addToast({
      type: 'success',
      title: 'Formal Sign-off Complete',
      message: `Stamped by PM on ${stamp}, v1.0`
    });
  };

  const downloadFile = (content: string, filename: string, mime = 'text/markdown') => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeFilename(filename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addToast({ type: 'success', message: `Exported ${filename}.` });
  };

  const handleExportPrdMd = () => {
    if (!prd) return;
    const draftNotice = signOffDate ? `Approved by PM on ${signOffDate}, v1.0` : 'DRAFT: not approved';
    let md = `# ${prd.title}\n\n*Status: ${draftNotice}*\n\n`;
    md += `## Overview\n${prd.overview}\n\n`;
    md += `## Problem Statement\n${prd.problemStatement}\n\n`;

    md += `## Goals\n`;
    for (const g of prd.goals) md += `- ${g}\n`;
    md += `\n## Non-Goals\n`;
    for (const ng of prd.nonGoals) md += `- ${ng}\n`;

    md += `\n## Target Personas\n`;
    for (const p of prd.personas) md += `- **${p.name}**: ${p.description}\n`;

    md += `\n## Functional Requirements\n`;
    for (const r of requirements) {
      md += `### [${r.id}] (${r.priority.toUpperCase()})\n`;
      md += `${r.text}\n\n`;
      md += `**Acceptance Criteria:**\n`;
      for (const ac of r.acceptanceCriteria) {
        md += `- **Given** ${ac.given}, **When** ${ac.when}, **Then** ${ac.then}\n`;
      }
      md += `\n`;
    }

    downloadFile(md, `${prd.title.toLowerCase().replace(/\s+/g, '_')}_prd.md`);
  };

  const handleExportFeaturesCsv = () => {
    let csv = `id,name,description,framework,score,rank\n`;
    for (const f of features) {
      csv += `"${f.id}","${f.name.replace(/"/g, '""')}","${f.description.replace(/"/g, '""')}","${f.priority.framework}",${f.priority.score},${f.priority.rank}\n`;
    }
    downloadFile(csv, 'prioritized_features.csv', 'text/csv');
  };

  if (!prd && !review && roadmapItems.length === 0) {
    return (
      <div className="p-12 text-center border border-neutral-200 dark:border-neutral-800 rounded-xl bg-white dark:bg-neutral-900 space-y-3">
        <Sparkles className="w-8 h-8 text-neutral-400 mx-auto" />
        <h3 className="font-semibold text-neutral-800 dark:text-neutral-200 text-sm">
          No Outputs Generated Yet
        </h3>
        <p className="text-xs text-neutral-500 max-w-sm mx-auto">
          Run the pipeline stages to generate the Product Requirements Document (PRD), Roadmap, and Executive Review.
        </p>
        <button
          onClick={() => setActiveView('pipeline')}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer"
        >
          Go to Pipeline
        </button>
      </div>
    );
  }

  const featureMap = new Map(features.map((f) => [f.id, f]));

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Top Header & Sign-Off Banner */}
      <div className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
              PRD & Strategy Deliverables
            </h2>
            {signOffDate ? (
              <Badge variant="success">Approved by PM on {signOffDate}</Badge>
            ) : (
              <Badge variant="warning">DRAFT: Not Approved</Badge>
            )}
          </div>
          <p className="text-xs text-neutral-500 mt-0.5">
            Verified requirements, delivery horizons, and executive audit rubric ready for engineering handoff.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canSignOff || !!signOffDate}
            onClick={handleSignOff}
            title={
              !canSignOff
                ? 'PRD, Roadmap, and Executive Review must all be Approved in Pipeline before sign-off.'
                : 'Formally approve and stamp this PRD version'
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs cursor-pointer transition-colors"
          >
            <ShieldCheck className="w-4 h-4" />
            {signOffDate ? 'Signed-off ✓' : 'PM Sign-off'}
          </button>

          <button
            type="button"
            onClick={handleExportPrdMd}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            PRD.md
          </button>

          <button
            type="button"
            onClick={handleExportFeaturesCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Features CSV
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-2 text-xs">
        <button
          onClick={() => setActiveTab('prd')}
          className={`px-3.5 py-1.5 rounded-md font-medium cursor-pointer transition-colors ${
            activeTab === 'prd'
              ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
              : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'
          }`}
        >
          Product Spec (PRD)
        </button>
        <button
          onClick={() => setActiveTab('roadmap')}
          className={`px-3.5 py-1.5 rounded-md font-medium cursor-pointer transition-colors ${
            activeTab === 'roadmap'
              ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
              : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'
          }`}
        >
          Roadmap Horizons
        </button>
        <button
          onClick={() => setActiveTab('review')}
          className={`px-3.5 py-1.5 rounded-md font-medium cursor-pointer transition-colors ${
            activeTab === 'review'
              ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
              : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'
          }`}
        >
          Executive Review
        </button>
        <button
          onClick={() => setActiveTab('appendix')}
          className={`px-3.5 py-1.5 rounded-md font-medium cursor-pointer transition-colors ${
            activeTab === 'appendix'
              ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
              : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'
          }`}
        >
          Evidence Appendix
        </button>
      </div>

      {/* Tab 1: PRD */}
      {activeTab === 'prd' && prd && (
        <div className="space-y-6">
          <div className="p-6 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-6 text-sm">
            <div>
              <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{prd.title}</h1>
              <p className="text-xs text-neutral-500 mt-1">{prd.overview}</p>
            </div>

            <div className="space-y-2">
              <h3 className="font-semibold text-xs uppercase tracking-wider text-neutral-500">Problem Statement</h3>
              <p className="text-neutral-800 dark:text-neutral-200 leading-relaxed bg-neutral-50 dark:bg-neutral-950 p-3.5 rounded-lg border border-neutral-200 dark:border-neutral-800">
                {prd.problemStatement}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <h3 className="font-semibold text-xs uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Goals</h3>
                <ul className="list-disc list-inside space-y-1 text-xs text-neutral-700 dark:text-neutral-300">
                  {prd.goals.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold text-xs uppercase tracking-wider text-neutral-400">Non-Goals</h3>
                <ul className="list-disc list-inside space-y-1 text-xs text-neutral-500">
                  {prd.nonGoals.map((ng, i) => (
                    <li key={i}>{ng}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="space-y-3 pt-4 border-t border-neutral-200 dark:border-neutral-800">
              <h3 className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
                Traceable Requirements
              </h3>

              <div className="space-y-4">
                {requirements.map((req) => (
                  <div
                    key={req.id}
                    className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-950/40 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="purple">{req.id}</Badge>
                        <span className="font-semibold text-xs text-neutral-900 dark:text-neutral-100">{req.text}</span>
                      </div>
                      <Badge variant="default" size="sm">{req.priority.toUpperCase()}</Badge>
                    </div>

                    <div className="space-y-1.5 pl-3 border-l-2 border-indigo-200 dark:border-indigo-800 text-xs">
                      <div className="font-semibold text-[11px] text-neutral-500 uppercase tracking-wider">
                        Acceptance Criteria
                      </div>
                      {req.acceptanceCriteria.map((ac, idx) => (
                        <div key={idx} className="text-neutral-700 dark:text-neutral-300 leading-snug">
                          <span className="font-semibold">Given</span> {ac.given}, <span className="font-semibold">When</span> {ac.when}, <span className="font-semibold">Then</span> {ac.then}
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 pt-1 text-[11px] text-neutral-500 font-mono">
                      <span>Cites Evidence:</span>
                      {req.evidenceIds.map((eid) => (
                        <button
                          key={eid}
                          onClick={() => openDrawer('source', `Evidence ${eid}`, { quote: '' })}
                          className="px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:text-indigo-600 cursor-pointer"
                        >
                          {eid}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Roadmap */}
      {activeTab === 'roadmap' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(['now', 'next', 'later'] as const).map((horizon) => {
            const items = roadmapItems.filter((it) => it.horizon === horizon);
            return (
              <div
                key={horizon}
                className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex flex-col space-y-3 min-h-[400px]"
              >
                <div className="flex items-center justify-between pb-2 border-b border-neutral-100 dark:border-neutral-800">
                  <h3 className="font-semibold text-xs uppercase tracking-wider text-neutral-800 dark:text-neutral-200">
                    {horizon === 'now' ? '🎯 Now (Current Sprint)' : horizon === 'next' ? '⏩ Next (Upcoming)' : '⏳ Later (Backlog)'}
                  </h3>
                  <Badge variant="default" size="sm">{items.length}</Badge>
                </div>

                <div className="space-y-3 flex-1">
                  {items.map((it) => {
                    const feat = featureMap.get(it.featureId);
                    return (
                      <div
                        key={it.id}
                        className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <Badge variant="purple" size="sm">{it.featureId}</Badge>
                          {feat && (
                            <span className="text-xs font-mono font-semibold text-indigo-600">
                              Rank #{feat.priority.rank}
                            </span>
                          )}
                        </div>
                        <div className="font-semibold text-xs text-neutral-900 dark:text-neutral-100">
                          {feat?.name || it.featureId}
                        </div>
                        <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-snug">
                          {it.rationale}
                        </p>
                        {it.dependsOn.length > 0 && (
                          <div className="text-[10px] text-neutral-400 font-mono">
                            Depends on: {it.dependsOn.join(', ')}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tab 3: Executive Review */}
      {activeTab === 'review' && review && (
        <div className="space-y-6">
          <div className="p-6 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-6 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-base text-neutral-900 dark:text-neutral-100">
                  Executive Review & Audit
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Peer review critique of strategic fit, customer evidence strength, and feasibility.
                </p>
              </div>

              <div>
                {review.verdict === 'approved' ? (
                  <Badge variant="success">Verdict: APPROVED</Badge>
                ) : (
                  <Badge variant="warning">Verdict: NEEDS WORK</Badge>
                )}
              </div>
            </div>

            {review.forcedByCode && (
              <div className="p-3.5 rounded-lg border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Code Override Applied: </span>
                  Audit rules detected missing goal linkages or unverified quote citations. Forced verdict to "Needs Work" until addressed.
                </div>
              </div>
            )}

            {/* Rubric Score Bars */}
            <div className="space-y-3 pt-2">
              <h4 className="font-semibold text-xs uppercase tracking-wider text-neutral-500">
                Evaluation Rubric (1 - 5)
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Object.entries(review.rubric).map(([key, item]: any) => (
                  <div key={key} className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="capitalize font-medium text-neutral-800 dark:text-neutral-200">
                        {key.replace(/([A-Z])/g, ' $1')}
                      </span>
                      <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                        {item.score} / 5
                      </span>
                    </div>
                    <div className="w-full bg-neutral-200 dark:bg-neutral-800 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-indigo-600 h-full rounded-full"
                        style={{ width: `${(item.score / 5) * 100}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-neutral-500">{item.note}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Tough Executive Questions */}
            <div className="space-y-2 pt-2 border-t border-neutral-200 dark:border-neutral-800">
              <h4 className="font-semibold text-xs uppercase tracking-wider text-neutral-500">
                Tough Executive / Board Questions
              </h4>
              <ul className="list-disc list-inside space-y-1 text-xs text-neutral-700 dark:text-neutral-300">
                {review.execQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Appendix */}
      {activeTab === 'appendix' && (
        <div className="p-6 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-4 text-xs">
          <h3 className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
            Evidence Appendix & Verbatim Sources
          </h3>
          <div className="space-y-3">
            {evidenceList.map((ev) => (
              <div key={ev.id} className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 space-y-1">
                <div className="flex items-center justify-between">
                  <Badge variant="purple" size="sm">{ev.id}</Badge>
                  {ev.verified ? <Badge variant="success" size="sm">Verified</Badge> : <Badge variant="warning" size="sm">Unverified</Badge>}
                </div>
                <p className="italic text-neutral-800 dark:text-neutral-200 leading-relaxed">
                  "{ev.quote}"
                </p>
                {ev.speaker && <div className="text-[10px] text-neutral-400 font-mono">— {ev.speaker}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
