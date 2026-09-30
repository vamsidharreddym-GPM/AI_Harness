/**
 * Read-only modal for inspecting the exact prompt sent to a stage.
 */
import React from 'react';
import { Copy, Terminal, X } from 'lucide-react';
import { useAppStore } from '../store/app';

interface PromptViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  promptText: string;
}

export const PromptViewerModal: React.FC<PromptViewerModalProps> = ({
  isOpen,
  onClose,
  title,
  promptText
}) => {
  const { addToast } = useAppStore();

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(promptText);
    addToast({ type: 'success', message: 'Prompt copied to clipboard.' });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2 font-semibold text-neutral-900 dark:text-neutral-100 text-sm">
            <Terminal className="w-4 h-4 text-indigo-500" />
            <span>View Prompt: {title}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              title="Copy prompt"
              className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
            >
              <Copy className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto font-mono text-xs leading-relaxed whitespace-pre-wrap select-text text-neutral-800 dark:text-neutral-200 bg-neutral-50 dark:bg-neutral-950 rounded-b-xl">
          {promptText || 'No prompt recorded.'}
        </div>
      </div>
    </div>
  );
};
