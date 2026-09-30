/**
 * Sliding side drawer component.
 */
import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '../store/app';

interface DrawerProps {
  children?: React.ReactNode;
}

export const Drawer: React.FC<DrawerProps> = ({ children }) => {
  const { drawer, closeDrawer } = useAppStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drawer.isOpen) {
        closeDrawer();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawer.isOpen, closeDrawer]);

  if (!drawer.isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-neutral-950/40 backdrop-blur-xs transition-opacity"
        onClick={closeDrawer}
        aria-hidden="true"
      />

      {/* Drawer content */}
      <div className="relative w-full max-w-xl h-full bg-white dark:bg-neutral-900 border-l border-neutral-200 dark:border-neutral-800 shadow-2xl flex flex-col z-10 transition-transform">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <h2 className="font-semibold text-neutral-900 dark:text-neutral-100 truncate pr-4 text-base">
            {drawer.title || 'Details'}
          </h2>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Close drawer"
            className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {children}
        </div>
      </div>
    </div>
  );
};
