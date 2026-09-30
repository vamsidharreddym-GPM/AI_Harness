/**
 * Citation chip component for document chunks and web citations.
 */
import React from 'react';
import { Globe, AlertCircle, FileText } from 'lucide-react';

interface CitationChipProps {
  chunkId?: string;
  url?: string;
  title?: string;
  valid?: boolean;
  onClickDoc?: (chunkId: string) => void;
}

export const CitationChip: React.FC<CitationChipProps> = ({
  chunkId,
  url,
  title,
  valid = true,
  onClickDoc
}) => {
  // Web citation
  if (url) {
    let domain = url;
    try {
      domain = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      // Fallback
    }

    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={title || url}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded text-xs font-mono font-medium bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60 hover:bg-sky-100 dark:hover:bg-sky-900/60 transition-colors"
      >
        <Globe className="w-3 h-3 text-sky-500" />
        <span className="truncate max-w-[140px]">{domain}</span>
      </a>
    );
  }

  // Document Chunk citation
  if (chunkId) {
    if (!valid) {
      return (
        <span
          title="This chunk citation could not be verified against uploaded sources"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded text-xs font-mono line-through text-neutral-400 dark:text-neutral-500 bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 cursor-not-allowed select-none"
        >
          <AlertCircle className="w-3 h-3 text-amber-500" />
          [{chunkId}]
        </span>
      );
    }

    return (
      <button
        type="button"
        onClick={() => onClickDoc?.(chunkId)}
        title="View source document and highlighted quote"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded text-xs font-mono font-medium bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors cursor-pointer"
      >
        <FileText className="w-3 h-3 text-indigo-500" />
        [{chunkId}]
      </button>
    );
  }

  return null;
};
