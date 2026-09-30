/**
 * Source Viewer drawer content: displays cited chunk with quote highlight and doc context.
 */
import React, { useEffect, useState } from 'react';
import { AlertCircle, FileText, Tag } from 'lucide-react';
import { Chunk, db, SourceDoc } from '../store/db';
import { Badge } from './Badge';

interface SourceViewerProps {
  chunkId?: string;
  quote?: string;
}

export const SourceViewer: React.FC<SourceViewerProps> = ({ chunkId, quote }) => {
  const [chunk, setChunk] = useState<Chunk | null>(null);
  const [doc, setDoc] = useState<SourceDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      if (!chunkId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const foundChunk = await db.chunks.get(chunkId);
        if (foundChunk && isMounted) {
          setChunk(foundChunk);
          const foundDoc = await db.sourceDocs.get(foundChunk.docId);
          if (foundDoc && isMounted) {
            setDoc(foundDoc);
          }
        }
      } catch (err) {
        console.warn('Error loading chunk in SourceViewer:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadData();
    return () => {
      isMounted = false;
    };
  }, [chunkId]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-6 w-1/2 bg-neutral-200 dark:bg-neutral-800 rounded" />
        <div className="h-32 bg-neutral-100 dark:bg-neutral-800 rounded" />
      </div>
    );
  }

  if (!chunk) {
    return (
      <div className="p-4 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
        <div>
          <h4 className="font-semibold text-sm">Source no longer available</h4>
          <p className="text-xs mt-1 leading-relaxed">
            The source document or chunk ({chunkId || 'unknown'}) cited here has been deleted or cannot be found in your local database.
          </p>
        </div>
      </div>
    );
  }

  // Highlight quote inside chunk text if available
  const chunkText = chunk.text;
  let highlightedContent: React.ReactNode = chunkText;

  if (quote && quote.trim().length > 0) {
    const cleanQuote = quote.trim();
    const idx = chunkText.toLowerCase().indexOf(cleanQuote.toLowerCase());
    if (idx !== -1) {
      const before = chunkText.slice(0, idx);
      const match = chunkText.slice(idx, idx + cleanQuote.length);
      const after = chunkText.slice(idx + cleanQuote.length);
      highlightedContent = (
        <>
          {before}
          <mark className="bg-amber-200 dark:bg-amber-500/30 text-neutral-900 dark:text-amber-200 px-1 py-0.5 rounded font-medium border-b-2 border-amber-500">
            {match}
          </mark>
          {after}
        </>
      );
    }
  }

  return (
    <div className="space-y-5 text-sm">
      {/* Document info header */}
      <div className="p-3.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100 truncate">
            <FileText className="w-4 h-4 text-indigo-500 shrink-0" />
            <span className="truncate">{doc?.name || 'Document'}</span>
          </div>
          <Badge variant="purple" size="sm">
            {chunk.id}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="inline-flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
            <Tag className="w-3 h-3" /> Type:
          </span>
          <Badge variant="default" size="sm">
            {doc?.type || 'other'}
          </Badge>
          {chunk.heading && (
            <span className="text-xs text-neutral-500 truncate max-w-xs">
              Section: <span className="text-neutral-700 dark:text-neutral-300">{chunk.heading}</span>
            </span>
          )}
        </div>
      </div>

      {/* Target Quote Callout if provided */}
      {quote && (
        <div className="p-3 rounded-lg border border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/50 dark:bg-indigo-950/20">
          <div className="text-xs font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-400 mb-1">
            Cited Evidence Quote
          </div>
          <p className="italic text-neutral-800 dark:text-neutral-200 text-sm">
            "{quote}"
          </p>
        </div>
      )}

      {/* Full chunk context */}
      <div>
        <div className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2">
          Chunk Passage Context
        </div>
        <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 font-mono text-xs leading-relaxed whitespace-pre-wrap select-text text-neutral-800 dark:text-neutral-200">
          {highlightedContent}
        </div>
      </div>
    </div>
  );
};
