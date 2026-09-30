/**
 * Toast notifications container and render system.
 */
import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import { useAppStore } from '../store/app';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useAppStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md w-full pointer-events-none px-4 sm:px-0">
      {toasts.map((toast) => {
        let icon = <Info className="w-5 h-5 text-indigo-500 shrink-0" />;
        let borderClass = 'border-neutral-200 dark:border-neutral-700';

        if (toast.type === 'success') {
          icon = <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />;
          borderClass = 'border-emerald-300 dark:border-emerald-800';
        } else if (toast.type === 'warn') {
          icon = <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />;
          borderClass = 'border-amber-300 dark:border-amber-800';
        } else if (toast.type === 'error') {
          icon = <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />;
          borderClass = 'border-rose-300 dark:border-rose-800';
        }

        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-lg border shadow-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 ${borderClass} transition-all`}
          >
            {icon}
            <div className="flex-1 min-w-0 text-sm">
              {toast.title && <div className="font-semibold text-xs tracking-wide uppercase mb-0.5">{toast.title}</div>}
              <div className="text-neutral-700 dark:text-neutral-300 leading-snug break-words">{toast.message}</div>
              {toast.action && (
                <button
                  type="button"
                  onClick={() => {
                    toast.action?.onClick();
                    removeToast(toast.id);
                  }}
                  className="mt-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                >
                  {toast.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              aria-label="Close notification"
              className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 p-1 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
