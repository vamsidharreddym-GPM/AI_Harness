/**
 * Workspaces view with onboarding checklist, Flowbase sample loader, and JSON import/export.
 */
import React, { useState } from 'react';
import {
  CheckCircle2,
  Circle,
  Download,
  FolderPlus,
  Layers,
  Sparkles,
  Trash2,
  Upload
} from 'lucide-react';
import { parseFile, parsePastedText } from '../ingest/parse';
import { searchIndex } from '../rag';
import { DEMO_FILES } from '../demo/demoData';
import { useAppStore } from '../store/app';
import { db, Workspace } from '../store/db';
import { sanitizeFilename } from '../lib/text';

export const WorkspacesView: React.FC = () => {
  const {
    workspaces,
    activeWorkspaceId,
    createWorkspace,
    switchWorkspace,
    deleteWorkspace,
    keys,
    setActiveView,
    addToast,
    addLog
  } = useAppStore();

  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [loadingDemo, setLoadingDemo] = useState(false);

  const hasKey = !!(keys.google || keys.openai || keys.anthropic);
  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;
    try {
      const created = await createWorkspace(newWorkspaceName.trim());
      setNewWorkspaceName('');
      addToast({ type: 'success', message: `Workspace "${created.name}" created.` });
    } catch (err: any) {
      addToast({ type: 'error', message: err.message });
    }
  };

  const handleLoadDemo = async () => {
    setLoadingDemo(true);
    try {
      const ws = await createWorkspace('Flowbase SaaS (Sample)');
      addLog('info', 'Loading Flowbase sample workspace files...');

      let docSeq = 1;
      const createdDocs = [];
      const createdChunks = [];

      for (const item of DEMO_FILES) {
        const parsed = await parsePastedText(item.name, item.content, item.type as any, docSeq);
        const docId = `doc_${Date.now()}_${docSeq}`;

        const docRecord = {
          id: docId,
          workspaceId: ws.id,
          seq: docSeq,
          name: parsed.name,
          type: parsed.type,
          mime: parsed.mime,
          text: parsed.text,
          tokenEst: parsed.tokenEst,
          hash: parsed.hash,
          status: parsed.status,
          uploadedAt: Date.now()
        };

        const chunkRecords = parsed.chunks.map((c) => ({
          id: c.id,
          workspaceId: ws.id,
          docId,
          seq: c.seq,
          heading: c.heading,
          text: c.text,
          start: c.start,
          end: c.end
        }));

        await db.sourceDocs.put(docRecord as any);
        await db.chunks.bulkPut(chunkRecords as any);

        createdDocs.push(docRecord);
        createdChunks.push(...chunkRecords);
        docSeq++;
      }

      // Rebuild search index
      searchIndex.rebuild(createdDocs as any, createdChunks as any);

      addToast({
        type: 'success',
        title: 'Demo Loaded',
        message: 'Flowbase sample workspace with 8 documents successfully created!'
      });
      setActiveView('sources');
    } catch (err: any) {
      addToast({ type: 'error', message: `Failed to load demo: ${err.message}` });
    } finally {
      setLoadingDemo(false);
    }
  };

  const handleExportWorkspace = async (ws: Workspace) => {
    try {
      const docs = await db.sourceDocs.where('workspaceId').equals(ws.id);
      const chunks = await db.chunks.where('workspaceId').equals(ws.id);
      const evidence = await db.evidence.where('workspaceId').equals(ws.id);
      const goals = await db.goals.where('workspaceId').equals(ws.id);
      const insights = await db.insights.where('workspaceId').equals(ws.id);
      const problems = await db.problems.where('workspaceId').equals(ws.id);
      const features = await db.features.where('workspaceId').equals(ws.id);
      const requirements = await db.requirements.where('workspaceId').equals(ws.id);
      const prd = await db.prds.get(ws.id);
      const roadmapItems = await db.roadmapItems.where('workspaceId').equals(ws.id);
      const review = await db.reviews.get(ws.id);

      const payload = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        workspace: ws,
        docs,
        chunks,
        evidence,
        goals,
        insights,
        problems,
        features,
        requirements,
        prd,
        roadmapItems,
        review
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = sanitizeFilename(`${ws.name.toLowerCase().replace(/\s+/g, '_')}_workspace.json`);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addToast({ type: 'success', message: 'Workspace exported without keys.' });
    } catch (err: any) {
      addToast({ type: 'error', message: `Export failed: ${err.message}` });
    }
  };

  const handleImportWorkspace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (!parsed.workspace || !parsed.workspace.name) {
        throw new Error('Invalid workspace export JSON format.');
      }

      const newId = `ws_imported_${Date.now()}`;
      const newWs: Workspace = {
        ...parsed.workspace,
        id: newId,
        name: `${parsed.workspace.name} (Copy)`,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await db.workspaces.put(newWs);

      if (Array.isArray(parsed.docs)) {
        for (const d of parsed.docs) {
          await db.sourceDocs.put({ ...d, workspaceId: newId });
        }
      }
      if (Array.isArray(parsed.chunks)) {
        for (const c of parsed.chunks) {
          await db.chunks.put({ ...c, workspaceId: newId });
        }
      }
      if (Array.isArray(parsed.evidence)) {
        for (const ev of parsed.evidence) {
          await db.evidence.put({ ...ev, workspaceId: newId });
        }
      }
      if (Array.isArray(parsed.goals)) {
        for (const g of parsed.goals) {
          await db.goals.put({ ...g, workspaceId: newId });
        }
      }
      if (Array.isArray(parsed.insights)) {
        for (const i of parsed.insights) {
          await db.insights.put({ ...i, workspaceId: newId });
        }
      }
      if (Array.isArray(parsed.problems)) {
        for (const p of parsed.problems) {
          await db.problems.put({ ...p, workspaceId: newId });
        }
      }
      if (Array.isArray(parsed.features)) {
        for (const f of parsed.features) {
          await db.features.put({ ...f, workspaceId: newId });
        }
      }
      if (Array.isArray(parsed.requirements)) {
        for (const r of parsed.requirements) {
          await db.requirements.put({ ...r, workspaceId: newId });
        }
      }
      if (parsed.prd) {
        await db.prds.put({ ...parsed.prd, workspaceId: newId });
      }

      await useAppStore.getState().loadWorkspaces();
      switchWorkspace(newId);
      addToast({ type: 'success', message: 'Workspace imported successfully as copy.' });
    } catch (err: any) {
      addToast({ type: 'error', message: `Import error: ${err.message}` });
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Onboarding Checklist Card */}
      <div className="p-6 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
              Welcome to AI PM Harness
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Follow these three quick steps to get from raw customer transcripts to an executive-ready PRD.
            </p>
          </div>
          <button
            type="button"
            disabled={loadingDemo}
            onClick={handleLoadDemo}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 border border-indigo-200 dark:border-indigo-800/60 cursor-pointer transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {loadingDemo ? 'Loading Sample...' : 'Load Flowbase Sample'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
          {/* Step 1 */}
          <div
            onClick={() => setActiveView('settings')}
            className="p-3.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/50 hover:border-indigo-400 cursor-pointer transition-colors flex items-start gap-3"
          >
            {hasKey ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
            ) : (
              <Circle className="w-5 h-5 text-neutral-400 shrink-0 mt-0.5" />
            )}
            <div>
              <div className="font-semibold text-xs text-neutral-900 dark:text-neutral-100">
                1. Configure API Key
              </div>
              <p className="text-xs text-neutral-500 mt-1">
                {hasKey ? 'Provider key active' : 'Add Claude, ChatGPT, or Gemini in Settings'}
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div
            onClick={() => setActiveView('sources')}
            className="p-3.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/50 hover:border-indigo-400 cursor-pointer transition-colors flex items-start gap-3"
          >
            <Circle className="w-5 h-5 text-neutral-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-xs text-neutral-900 dark:text-neutral-100">
                2. Ingest Source Documents
              </div>
              <p className="text-xs text-neutral-500 mt-1">
                Upload interviews, CSVs, tickets, or click Load Sample
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div
            onClick={() => setActiveView('pipeline')}
            className="p-3.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/50 hover:border-indigo-400 cursor-pointer transition-colors flex items-start gap-3"
          >
            <Circle className="w-5 h-5 text-neutral-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-xs text-neutral-900 dark:text-neutral-100">
                3. Run AI PM Pipeline
              </div>
              <p className="text-xs text-neutral-500 mt-1">
                Extract problems, score features, and verify PRD evidence
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Workspace Management */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 text-sm">
            Product Workspaces
          </h3>
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-neutral-700 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              Import JSON
              <input
                type="file"
                accept=".json"
                onChange={handleImportWorkspace}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* Create workspace form */}
        <form onSubmit={handleCreate} className="flex gap-2">
          <input
            type="text"
            placeholder="New workspace title (e.g. Q3 Mobile Redesign)..."
            value={newWorkspaceName}
            onChange={(e) => setNewWorkspaceName(e.target.value)}
            className="flex-1 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3.5 py-2 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            Create
          </button>
        </form>

        {/* Workspace cards list */}
        {workspaces.length === 0 ? (
          <div className="p-12 text-center border-2 border-dashed border-neutral-300 dark:border-neutral-800 rounded-xl">
            <Layers className="w-8 h-8 text-neutral-400 mx-auto mb-2" />
            <div className="font-medium text-sm text-neutral-700 dark:text-neutral-300">
              No workspaces created yet
            </div>
            <p className="text-xs text-neutral-500 mt-1">
              Create a new workspace above or click "Load Flowbase Sample" to get started instantly.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {workspaces.map((ws) => {
              const isActive = ws.id === activeWorkspaceId;
              return (
                <div
                  key={ws.id}
                  onClick={() => switchWorkspace(ws.id)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                    isActive
                      ? 'border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/20 shadow-xs'
                      : 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:border-neutral-400'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
                        {ws.name}
                      </div>
                      <div className="text-xs text-neutral-500 mt-0.5 font-mono">
                        Framework: {ws.settings.framework} · Lite: {ws.settings.lite ? 'Yes' : 'No'}
                      </div>
                    </div>
                    {isActive && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
                        Active
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-4 text-xs text-neutral-400 border-t border-neutral-100 dark:border-neutral-800/60 mt-3">
                    <span>Updated {new Date(ws.updatedAt).toLocaleDateString()}</span>
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => handleExportWorkspace(ws)}
                        title="Export workspace JSON"
                        className="p-1 hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Delete workspace "${ws.name}" and all its documents?`)) {
                            deleteWorkspace(ws.id);
                          }
                        }}
                        title="Delete workspace"
                        className="p-1 hover:text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
