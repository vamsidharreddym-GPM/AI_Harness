/**
 * Robust ErrorBoundary and global error listener per Section 3.1.
 * Catches render exceptions, provides reload, export workspace JSON, and navigate to settings.
 */
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, Download, RefreshCw, Settings } from 'lucide-react';
import { db } from '../store/db';
import { sanitizeFilename } from '../lib/text';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
  }

  private handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  private handleGoToSettings = () => {
    this.setState({ hasError: false, error: null });
    window.location.hash = '#/settings';
  };

  private handleExportWorkspace = async () => {
    try {
      const workspaces = await db.workspaces.toArray();
      const docs = await db.sourceDocs.toArray();
      const chunks = await db.chunks.toArray();
      const evidence = await db.evidence.toArray();
      const goals = await db.goals.toArray();
      const insights = await db.insights.toArray();
      const problems = await db.problems.toArray();
      const features = await db.features.toArray();
      const requirements = await db.requirements.toArray();
      const prds = await db.prds.toArray();
      const roadmapItems = await db.roadmapItems.toArray();
      const reviews = await db.reviews.toArray();

      const dump = {
        exportedAt: new Date().toISOString(),
        workspaces,
        docs: docs.map((d) => ({ ...d, text: d.text.slice(0, 10000) })), // compact
        chunks: chunks.slice(0, 500),
        evidence,
        goals,
        insights,
        problems,
        features,
        requirements,
        prds,
        roadmapItems,
        reviews
      };

      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = sanitizeFilename(`ai-pm-harness-recovery-${Date.now()}.json`);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`Export failed: ${e?.message}`);
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[300px] flex items-center justify-center p-6">
          <div className="max-w-lg w-full p-6 rounded-xl border border-rose-300 dark:border-rose-900 bg-white dark:bg-neutral-900 shadow-xl space-y-4">
            <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400">
              <AlertCircle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-semibold">
                {this.props.fallbackTitle || 'Something went wrong in this view'}
              </h3>
            </div>

            <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed font-mono p-3 rounded bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 break-words">
              {this.state.error?.message || 'An unexpected runtime error occurred.'}
            </p>

            <div className="pt-2 flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={this.handleReload}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reload view
              </button>

              <button
                type="button"
                onClick={this.handleExportWorkspace}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 border border-neutral-300 dark:border-neutral-700 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Export workspace (JSON)
              </button>

              <button
                type="button"
                onClick={this.handleGoToSettings}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5" />
                Go to Settings
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function setupGlobalErrorHandlers(
  onToast: (msg: string, title?: string) => void
) {
  window.onerror = (message, source, lineno, colno, error) => {
    const errorStr = error?.message || String(message);
    // Ignore benign Vite HMR / ResizeObserver noise
    if (errorStr.includes('ResizeObserver') || errorStr.includes('WebSocket')) return;
    onToast(errorStr, 'Runtime Error');
  };

  window.onunhandledrejection = (event) => {
    const reason = event?.reason?.message || String(event?.reason || 'Promise rejected');
    if (reason.includes('WebSocket') || reason.includes('AbortError')) return;
    onToast(reason, 'Unhandled Promise Rejection');
  };
}
