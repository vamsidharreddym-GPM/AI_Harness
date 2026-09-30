/**
 * Main application Zustand store.
 * Manages active workspace, API keys, pricing, meters, theme, navigation, toasts, and modals.
 */
import { create } from 'zustand';
import { ModelPricing, PriceTable } from '../lib/cost';
import { safeStorage, subscribeStorageStatus } from '../lib/safeStorage';
import { ModelInfo, ProviderId } from '../providers/types';
import { db, RunLog, Workspace } from './db';

export type AppView =
  | 'workspaces'
  | 'sources'
  | 'chat'
  | 'pipeline'
  | 'evidence'
  | 'outputs'
  | 'settings'
  | 'diagnostics';

export interface ToastItem {
  id: string;
  type: 'info' | 'success' | 'warn' | 'error';
  title?: string;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  durationMs?: number;
}

export interface DrawerState {
  isOpen: boolean;
  title: string;
  view: 'source' | 'prompt' | 'raw' | 'detail' | null;
  data: any;
}

interface AppStore {
  // Navigation
  activeView: AppView;
  setActiveView: (view: AppView) => void;

  // Workspaces
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  loadWorkspaces: () => Promise<void>;
  createWorkspace: (name: string) => Promise<Workspace>;
  switchWorkspace: (id: string) => void;
  deleteWorkspace: (id: string) => Promise<void>;
  updateWorkspaceSettings: (settings: Partial<Workspace['settings']>) => Promise<void>;

  // BYOK Keys
  keys: Record<ProviderId, string>;
  rememberKeys: Record<ProviderId, boolean>;
  models: Record<ProviderId, ModelInfo[]>;
  manualModels: Record<ProviderId, string>;
  selectedModels: Record<ProviderId, string>;
  setKey: (provider: ProviderId, key: string, remember: boolean) => void;
  removeKey: (provider: ProviderId) => void;
  setModels: (provider: ProviderId, models: ModelInfo[]) => void;
  setManualModel: (provider: ProviderId, modelId: string) => void;
  setSelectedModel: (provider: ProviderId, modelId: string) => void;

  // Token cap & cost tracking
  sessionTokensIn: number;
  sessionTokensOut: number;
  sessionTokenCap: number;
  addSessionTokens: (tokensIn: number, tokensOut: number) => void;
  setSessionTokenCap: (cap: number) => void;
  priceTable: PriceTable;
  setPriceTable: (prices: PriceTable) => void;

  // UI & Environment
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  storageBlocked: boolean;

  // Drawer
  drawer: DrawerState;
  openDrawer: (view: DrawerState['view'], title: string, data: any) => void;
  closeDrawer: () => void;

  // Toasts
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, 'id'>) => void;
  removeToast: (id: string) => void;

  // Run logs (capped at 500)
  logs: RunLog[];
  addLog: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

// Initial key hydration from safeStorage
function loadInitialKey(provider: ProviderId): { key: string; remember: boolean } {
  const localKey = safeStorage.getItem('local', `key_${provider}`);
  if (localKey) {
    return { key: localKey, remember: true };
  }
  const sessionKey = safeStorage.getItem('session', `key_${provider}`);
  if (sessionKey) {
    return { key: sessionKey, remember: false };
  }
  return { key: '', remember: false };
}

const anthropicInit = loadInitialKey('anthropic');
const openaiInit = loadInitialKey('openai');
const googleInit = loadInitialKey('google');

export const useAppStore = create<AppStore>((set, get) => {
  // Subscribe to storage status changes
  subscribeStorageStatus((blocked) => {
    set({ storageBlocked: blocked });
  });

  return {
    activeView: 'workspaces',
    setActiveView: (view) => {
      window.location.hash = `#/${view}`;
      set({ activeView: view });
    },

    workspaces: [],
    activeWorkspaceId: null,

    loadWorkspaces: async () => {
      try {
        const list = await db.workspaces.toArray();
        set({ workspaces: list });
        if (list.length > 0 && !get().activeWorkspaceId) {
          set({ activeWorkspaceId: list[0].id });
        }
      } catch (err: any) {
        console.warn('Failed to load workspaces from IndexedDB:', err);
      }
    },

    createWorkspace: async (name: string) => {
      const now = Date.now();
      const newWs: Workspace = {
        id: `ws_${now}_${Math.random().toString(36).slice(2, 7)}`,
        name: name.trim() || 'Untitled Workspace',
        createdAt: now,
        updatedAt: now,
        settings: {
          framework: 'RICE',
          lite: true,
          stageModels: {
            research: { provider: 'google', model: 'gemini-2.5-flash' },
            insight: { provider: 'google', model: 'gemini-2.5-flash' },
            problem: { provider: 'google', model: 'gemini-2.5-flash' },
            prioritization: { provider: 'google', model: 'gemini-2.5-flash' },
            prd: { provider: 'google', model: 'gemini-2.5-flash' },
            roadmap: { provider: 'google', model: 'gemini-2.5-flash' },
            review: { provider: 'google', model: 'gemini-2.5-flash' }
          }
        }
      };

      try {
        await db.workspaces.put(newWs);
      } catch (err) {
        console.warn('Fallback workspace put:', err);
      }

      set((state) => ({
        workspaces: [newWs, ...state.workspaces],
        activeWorkspaceId: newWs.id
      }));

      return newWs;
    },

    switchWorkspace: (id: string) => {
      set({ activeWorkspaceId: id });
    },

    deleteWorkspace: async (id: string) => {
      try {
        await db.workspaces.delete(id);
        // Clear cascade
        const docList = await db.sourceDocs.where('workspaceId').equals(id).toArray();
        for (const d of docList) await db.sourceDocs.delete(d.id);
        const chunkList = await db.chunks.where('workspaceId').equals(id).toArray();
        for (const c of chunkList) await db.chunks.delete(c.id);
      } catch (err) {
        console.warn('Delete workspace error:', err);
      }

      set((state) => {
        const remaining = state.workspaces.filter((w) => w.id !== id);
        return {
          workspaces: remaining,
          activeWorkspaceId: remaining[0]?.id || null
        };
      });
    },

    updateWorkspaceSettings: async (newSettings) => {
      const { activeWorkspaceId, workspaces } = get();
      if (!activeWorkspaceId) return;
      const ws = workspaces.find((w) => w.id === activeWorkspaceId);
      if (!ws) return;

      const updated = {
        ...ws,
        updatedAt: Date.now(),
        settings: {
          ...ws.settings,
          ...newSettings
        }
      };

      try {
        await db.workspaces.put(updated);
      } catch (err) {
        console.warn('Workspace update error:', err);
      }

      set((state) => ({
        workspaces: state.workspaces.map((w) => (w.id === activeWorkspaceId ? updated : w))
      }));
    },

    keys: {
      anthropic: anthropicInit.key,
      openai: openaiInit.key,
      google: googleInit.key
    },
    rememberKeys: {
      anthropic: anthropicInit.remember,
      openai: openaiInit.remember,
      google: googleInit.remember
    },
    models: {
      anthropic: [],
      openai: [],
      google: []
    },
    manualModels: {
      anthropic: '',
      openai: '',
      google: ''
    },
    selectedModels: {
      anthropic: 'claude-3-7-sonnet-20250219',
      openai: 'gpt-4o',
      google: 'gemini-2.5-flash'
    },

    setKey: (provider, rawKey, remember) => {
      const clean = rawKey.trim().replace(/^["']|["']$/g, '');
      if (clean.includes(' ') || clean.includes('\n')) {
        throw new Error('API key must not contain spaces or line breaks.');
      }

      if (remember) {
        safeStorage.setItem('local', `key_${provider}`, clean);
        safeStorage.removeItem('session', `key_${provider}`);
      } else {
        safeStorage.setItem('session', `key_${provider}`, clean);
        safeStorage.removeItem('local', `key_${provider}`);
      }

      set((state) => ({
        keys: { ...state.keys, [provider]: clean },
        rememberKeys: { ...state.rememberKeys, [provider]: remember }
      }));
    },

    removeKey: (provider) => {
      safeStorage.removeItem('local', `key_${provider}`);
      safeStorage.removeItem('session', `key_${provider}`);
      set((state) => ({
        keys: { ...state.keys, [provider]: '' },
        rememberKeys: { ...state.rememberKeys, [provider]: false }
      }));
    },

    setModels: (provider, models) => {
      set((state) => ({
        models: { ...state.models, [provider]: models }
      }));
    },

    setManualModel: (provider, modelId) => {
      set((state) => ({
        manualModels: { ...state.manualModels, [provider]: modelId.trim() },
        selectedModels: { ...state.selectedModels, [provider]: modelId.trim() }
      }));
    },

    setSelectedModel: (provider, modelId) => {
      set((state) => ({
        selectedModels: { ...state.selectedModels, [provider]: modelId }
      }));
    },

    sessionTokensIn: 0,
    sessionTokensOut: 0,
    sessionTokenCap: 1000000,

    addSessionTokens: (inTokens, outTokens) => {
      set((state) => ({
        sessionTokensIn: state.sessionTokensIn + inTokens,
        sessionTokensOut: state.sessionTokensOut + outTokens
      }));
    },

    setSessionTokenCap: (cap) => {
      set({ sessionTokenCap: cap });
    },

    priceTable: {},
    setPriceTable: (prices) => {
      set({ priceTable: prices });
    },

    theme: (safeStorage.getItem('local', 'theme') as 'light' | 'dark') || 'light',
    toggleTheme: () => {
      set((state) => {
        const next = state.theme === 'light' ? 'dark' : 'light';
        safeStorage.setItem('local', 'theme', next);
        if (next === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
        return { theme: next };
      });
    },

    storageBlocked: safeStorage.isBlocked(),

    drawer: {
      isOpen: false,
      title: '',
      view: null,
      data: null
    },

    openDrawer: (view, title, data) => {
      set({
        drawer: { isOpen: true, view, title, data }
      });
    },

    closeDrawer: () => {
      set({
        drawer: { isOpen: false, view: null, title: '', data: null }
      });
    },

    toasts: [],
    addToast: (toast) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const duration = toast.durationMs ?? 4500;

      set((state) => ({
        toasts: [...state.toasts, { ...toast, id }]
      }));

      if (duration > 0) {
        setTimeout(() => {
          get().removeToast(id);
        }, duration);
      }
    },

    removeToast: (id) => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id)
      }));
    },

    logs: [],
    addLog: (level, msg) => {
      const item: RunLog = {
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ts: Date.now(),
        level,
        msg
      };
      set((state) => ({
        logs: [item, ...state.logs].slice(0, 500)
      }));
    }
  };
});
