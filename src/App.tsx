/**
 * Root App component: hash-based routing, layout rail, top status bar, drawers, and error boundaries.
 */
import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Award,
  ChevronDown,
  Database,
  FileText,
  GitBranch,
  Layers,
  MessageSquare,
  Moon,
  Search,
  Settings,
  Sun,
  Wrench,
  Zap
} from 'lucide-react';
import { Drawer } from './components/Drawer';
import { ErrorBoundary, setupGlobalErrorHandlers } from './components/ErrorBoundary';
import { SourceViewer } from './components/SourceViewer';
import { ToastContainer } from './components/ToastContainer';
import { formatTokenCount } from './lib/cost';
import { AppView, useAppStore } from './store/app';
import { ChatView } from './views/Chat';
import { DiagnosticsView } from './views/Diagnostics';
import { EvidenceView } from './views/Evidence';
import { OutputsView } from './views/Outputs';
import { PipelineView } from './views/Pipeline';
import { SettingsView } from './views/Settings';
import { SourcesView } from './views/Sources';
import { WorkspacesView } from './views/Workspaces';

const NAV_ITEMS: Array<{ id: AppView; label: string; icon: any }> = [
  { id: 'workspaces', label: 'Workspaces', icon: Layers },
  { id: 'sources', label: 'Sources', icon: FileText },
  { id: 'chat', label: 'RAG Chat', icon: MessageSquare },
  { id: 'pipeline', label: 'PM Pipeline', icon: GitBranch },
  { id: 'evidence', label: 'Evidence', icon: Search },
  { id: 'outputs', label: 'PRD Outputs', icon: Award },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'diagnostics', label: 'Diagnostics', icon: Wrench }
];

export default function App() {
  const {
    activeView,
    setActiveView,
    workspaces,
    activeWorkspaceId,
    loadWorkspaces,
    switchWorkspace,
    sessionTokensIn,
    sessionTokensOut,
    selectedModels,
    theme,
    toggleTheme,
    storageBlocked,
    drawer,
    addToast
  } = useAppStore();

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');

  // Initialize workspaces and global error listeners
  useEffect(() => {
    loadWorkspaces();
    setupGlobalErrorHandlers((msg, title) => {
      addToast({ type: 'error', title, message: msg });
    });

    // Hash sync
    const handleHash = () => {
      const hash = window.location.hash.replace(/^#\/?/, '') as AppView;
      if (NAV_ITEMS.some((it) => it.id === hash)) {
        useAppStore.setState({ activeView: hash });
      }
    };

    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const currentWs = workspaces.find((w) => w.id === activeWorkspaceId);

  const renderActiveView = () => {
    switch (activeView) {
      case 'workspaces':
        return <WorkspacesView />;
      case 'sources':
        return <SourcesView />;
      case 'chat':
        return <ChatView />;
      case 'pipeline':
        return <PipelineView />;
      case 'evidence':
        return <EvidenceView />;
      case 'outputs':
        return <OutputsView />;
      case 'settings':
        return <SettingsView />;
      case 'diagnostics':
        return <DiagnosticsView />;
      default:
        return <WorkspacesView />;
    }
  };

  return (
    <ErrorBoundary fallbackTitle="Application Root Crash">
      <div className={`min-h-screen flex flex-col md:flex-row bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 ${theme === 'dark' ? 'dark' : ''}`}>
        {/* Storage Blocked Warning Banner */}
        {storageBlocked && (
          <div className="fixed top-0 inset-x-0 z-50 bg-amber-500 text-neutral-950 font-medium text-xs py-1.5 px-4 text-center shadow-md flex items-center justify-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              Storage is blocked in this environment (preview iframe or private mode). Your work will not survive a refresh. Export your workspace regularly via Workspaces.
            </span>
          </div>
        )}

        {/* Left Navigation Rail */}
        <aside
          className={`w-full md:w-60 shrink-0 border-b md:border-b-0 md:border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex md:flex-col justify-between ${
            storageBlocked ? 'pt-7' : ''
          }`}
        >
          {/* Logo & Product Title */}
          <div className="p-4 border-b border-neutral-100 dark:border-neutral-800/60 hidden md:block">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-xs">
                PM
              </div>
              <div>
                <h1 className="font-semibold text-xs tracking-tight text-neutral-900 dark:text-neutral-100 uppercase">
                  AI PM Harness
                </h1>
                <span className="text-[10px] text-neutral-400 block font-mono">
                  Grounded Spec Engine
                </span>
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 p-2 md:p-3 flex md:flex-col overflow-x-auto md:overflow-visible gap-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveView(item.id)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all whitespace-nowrap ${
                    isActive
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-semibold'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-neutral-400'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Bottom Settings & Status */}
          <div className="p-3 border-t border-neutral-100 dark:border-neutral-800/60 hidden md:flex items-center justify-between text-xs text-neutral-400">
            <button
              type="button"
              onClick={toggleTheme}
              title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
              className="p-1.5 rounded-md hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
            <span className="font-mono text-[11px]">BYOK v1.0</span>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {/* Top Header Bar */}
          <header className={`h-14 border-b border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xs px-5 flex items-center justify-between gap-4 sticky top-0 z-20 ${storageBlocked ? 'mt-7 md:mt-0' : ''}`}>
            {/* Workspace Title & Selector */}
            <div className="flex items-center gap-3 min-w-0">
              {currentWs ? (
                <div className="flex items-center gap-2 truncate">
                  <span className="font-semibold text-sm text-neutral-900 dark:text-neutral-100 truncate">
                    {currentWs.name}
                  </span>
                  <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/60">
                    Saved locally ✓
                  </span>
                </div>
              ) : (
                <span className="text-xs text-neutral-500 font-mono">No Active Workspace</span>
              )}
            </div>

            {/* Token Meter, Active Model, Theme Toggle */}
            <div className="flex items-center gap-3 shrink-0 text-xs">
              <div
                title="Cumulative session tokens used across all provider calls"
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 font-mono text-[11px]"
              >
                <Zap className="w-3.5 h-3.5 text-amber-500" />
                <span>{formatTokenCount(sessionTokensIn + sessionTokensOut)} tokens</span>
              </div>

              <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 font-mono text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="truncate max-w-[120px]">{selectedModels.google || 'gemini-2.5-flash'}</span>
              </div>
            </div>
          </header>

          {/* View Body with View-level ErrorBoundary */}
          <main className="flex-1 p-4 md:p-6">
            <ErrorBoundary fallbackTitle={`Error in ${activeView} view`}>
              {renderActiveView()}
            </ErrorBoundary>
          </main>
        </div>

        {/* Global Slide-in Drawer */}
        <Drawer>
          {drawer.view === 'source' && (
            <SourceViewer
              chunkId={drawer.data?.chunkId}
              quote={drawer.data?.quote}
            />
          )}
        </Drawer>

        {/* Toast Notifications */}
        <ToastContainer />
      </div>
    </ErrorBoundary>
  );
}
