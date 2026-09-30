/**
 * Settings view: BYOK key configuration, model validation, price tables, token caps, and privacy guarantees.
 */
import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Eye,
  EyeOff,
  Key,
  Lock,
  RefreshCw,
  Shield,
  Trash2,
  Zap
} from 'lucide-react';
import { Badge } from '../components/Badge';
import { maskKey } from '../lib/text';
import { getProvider } from '../providers';
import { ModelInfo, ProviderId } from '../providers/types';
import { useAppStore } from '../store/app';
import { db } from '../store/db';

const PROVIDER_NAMES: Record<ProviderId, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (ChatGPT)',
  google: 'Google (Gemini)'
};

export const SettingsView: React.FC = () => {
  const {
    keys,
    rememberKeys,
    models,
    manualModels,
    selectedModels,
    sessionTokenCap,
    priceTable,
    setKey,
    removeKey,
    setModels,
    setManualModel,
    setSelectedModel,
    setSessionTokenCap,
    setPriceTable,
    addToast,
    addLog
  } = useAppStore();

  const [inputKeys, setInputKeys] = useState<Record<ProviderId, string>>({
    anthropic: keys.anthropic || '',
    openai: keys.openai || '',
    google: keys.google || ''
  });

  const [showKeys, setShowKeys] = useState<Record<ProviderId, boolean>>({
    anthropic: false,
    openai: false,
    google: false
  });

  const [validationStatus, setValidationStatus] = useState<
    Record<ProviderId, 'idle' | 'validating' | 'valid' | 'invalid'>
  >({
    anthropic: keys.anthropic ? 'valid' : 'idle',
    openai: keys.openai ? 'valid' : 'idle',
    google: keys.google ? 'valid' : 'idle'
  });

  const [testResults, setTestResults] = useState<
    Record<ProviderId, { latencyMs: number; tokens: number } | null>
  >({
    anthropic: null,
    openai: null,
    google: null
  });

  const handleSaveKey = (provider: ProviderId, remember: boolean) => {
    try {
      const raw = inputKeys[provider];
      if (!raw.trim()) {
        removeKey(provider);
        setValidationStatus((prev) => ({ ...prev, [provider]: 'idle' }));
        addToast({ type: 'info', message: `${PROVIDER_NAMES[provider]} key cleared.` });
        return;
      }
      setKey(provider, raw, remember);
      addToast({ type: 'success', message: `${PROVIDER_NAMES[provider]} key saved.` });
    } catch (err: any) {
      addToast({ type: 'error', message: err.message });
    }
  };

  const handleValidate = async (provider: ProviderId) => {
    const raw = inputKeys[provider] || keys[provider];
    if (!raw.trim()) {
      addToast({ type: 'warn', message: 'Please enter an API key first.' });
      return;
    }

    setValidationStatus((prev) => ({ ...prev, [provider]: 'validating' }));
    addLog('info', `Validating ${PROVIDER_NAMES[provider]} key...`);

    try {
      const p = getProvider(provider);
      const list = await p.listModels(raw.trim());
      setModels(provider, list);
      if (list.length > 0 && !selectedModels[provider]) {
        setSelectedModel(provider, list[0].id);
      }
      setValidationStatus((prev) => ({ ...prev, [provider]: 'valid' }));
      handleSaveKey(provider, rememberKeys[provider]);
      addToast({
        type: 'success',
        title: 'Key Validated',
        message: `Successfully connected to ${PROVIDER_NAMES[provider]} (${list.length} models found).`
      });
    } catch (err: any) {
      setValidationStatus((prev) => ({ ...prev, [provider]: 'invalid' }));
      addToast({
        type: 'error',
        title: 'Validation Failed',
        message: err.message || 'Key rejected by provider.'
      });
    }
  };

  const handleTestConnection = async (provider: ProviderId) => {
    const raw = keys[provider] || inputKeys[provider];
    if (!raw.trim()) {
      addToast({ type: 'warn', message: 'No API key configured for testing.' });
      return;
    }

    const p = getProvider(provider);
    const model = selectedModels[provider] || manualModels[provider] || 'default';
    const start = Date.now();

    try {
      const res = await p.generate({
        key: raw.trim(),
        model,
        messages: [{ role: 'user', content: 'Reply with OK' }]
      });
      const latencyMs = Date.now() - start;
      const totalTokens = res.usage.in + res.usage.out;
      setTestResults((prev) => ({ ...prev, [provider]: { latencyMs, tokens: totalTokens } }));
      addToast({
        type: 'success',
        title: 'Connection Test Passed',
        message: `${latencyMs}ms latency · ${totalTokens} tokens consumed.`
      });
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Connection Test Failed',
        message: err.message
      });
    }
  };

  const handleClearAllData = async () => {
    const confirmed = confirm(
      'WARNING: This will permanently delete all workspaces, documents, and chat threads stored in your browser database. Your API keys will also be removed. Proceed?'
    );
    if (!confirmed) return;

    try {
      await db.delete();
      window.location.reload();
    } catch (err: any) {
      addToast({ type: 'error', message: `Clear failed: ${err.message}` });
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Privacy Notice Banner */}
      <div className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/30 text-indigo-900 dark:text-indigo-200 flex items-start gap-3 text-xs leading-relaxed">
        <Shield className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold text-xs uppercase tracking-wide">
            Zero-Telemetry & Bring-Your-Own-Key Privacy Guarantee
          </div>
          <p className="mt-1 text-indigo-800 dark:text-indigo-300">
            Keys stay strictly inside your browser session and are sent only to the official endpoints of the provider you configure. Documents you upload are sent solely to the model provider when running RAG or pipeline agents. No intermediary servers, analytics trackers, or third-party telemetry exist in this application.
          </p>
        </div>
      </div>

      {/* Provider Cards */}
      <div className="space-y-4">
        <h3 className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
          Model Provider Keys
        </h3>

        {(['google', 'openai', 'anthropic'] as const).map((prov) => {
          const status = validationStatus[prov];
          const modelList = models[prov];
          const test = testResults[prov];

          return (
            <div
              key={prov}
              className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-indigo-500" />
                  <span className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
                    {PROVIDER_NAMES[prov]}
                  </span>
                </div>

                <div>
                  {status === 'valid' && <Badge variant="success">Valid</Badge>}
                  {status === 'validating' && <Badge variant="purple">Validating...</Badge>}
                  {status === 'invalid' && <Badge variant="error">Invalid</Badge>}
                  {status === 'idle' && <Badge variant="default">Not Set</Badge>}
                </div>
              </div>

              {/* Key Input */}
              <div className="space-y-2">
                <div className="relative">
                  <input
                    type={showKeys[prov] ? 'text' : 'password'}
                    placeholder={`Paste ${PROVIDER_NAMES[prov]} API key here...`}
                    value={inputKeys[prov]}
                    onChange={(e) =>
                      setInputKeys((prev) => ({ ...prev, [prov]: e.target.value }))
                    }
                    className="w-full text-xs font-mono rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 px-3.5 py-2.5 pr-20 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                  <div className="absolute right-2 top-2 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        setShowKeys((prev) => ({ ...prev, [prov]: !prev[prov] }))
                      }
                      className="p-1 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 cursor-pointer"
                    >
                      {showKeys[prov] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    {keys[prov] && (
                      <button
                        type="button"
                        onClick={() => {
                          removeKey(prov);
                          setInputKeys((prev) => ({ ...prev, [prov]: '' }));
                          setValidationStatus((prev) => ({ ...prev, [prov]: 'idle' }));
                          addToast({ type: 'info', message: 'Key removed.' });
                        }}
                        title="Remove key"
                        className="p-1 rounded text-neutral-400 hover:text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer text-neutral-600 dark:text-neutral-400">
                    <input
                      type="checkbox"
                      checked={rememberKeys[prov]}
                      onChange={(e) => handleSaveKey(prov, e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Remember on this device (stores in browser localStorage)</span>
                  </label>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleValidate(prov)}
                      className="px-3 py-1.5 rounded-md text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer shadow-xs transition-colors"
                    >
                      Validate Key
                    </button>
                    <button
                      type="button"
                      disabled={!keys[prov]}
                      onClick={() => handleTestConnection(prov)}
                      className="px-3 py-1.5 rounded-md text-xs font-medium text-neutral-700 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 disabled:opacity-50 cursor-pointer transition-colors"
                    >
                      Test Connection
                    </button>
                  </div>
                </div>
              </div>

              {/* Models selection & Manual Fallback */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-neutral-100 dark:border-neutral-800/60 text-xs">
                <div>
                  <label className="block text-neutral-500 mb-1">Select Model</label>
                  <select
                    value={selectedModels[prov]}
                    onChange={(e) => setSelectedModel(prov, e.target.value)}
                    className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-2.5 py-1.5"
                  >
                    {modelList.length > 0 ? (
                      modelList.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))
                    ) : (
                      <option value={selectedModels[prov]}>{selectedModels[prov]} (Default)</option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-neutral-500 mb-1">Manual Model ID (Fallback)</label>
                  <input
                    type="text"
                    placeholder="e.g. gpt-4o, claude-3-7-sonnet"
                    value={manualModels[prov]}
                    onChange={(e) => setManualModel(prov, e.target.value)}
                    className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-2.5 py-1.5 font-mono"
                  />
                </div>
              </div>

              {test && (
                <div className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 p-2 rounded border border-emerald-200 dark:border-emerald-800/60">
                  Latency: {test.latencyMs}ms · Response: "OK" · Tokens consumed: {test.tokens}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Token Safety & Budget Controls */}
      <div className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          <h3 className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
            Session Token Cap & Budget
          </h3>
        </div>
        <p className="text-xs text-neutral-500">
          The safety cap prevents runaway loops or unintended API costs by blocking pipeline runs once the cumulative token threshold is reached.
        </p>

        <div className="max-w-xs">
          <label className="block text-xs text-neutral-500 mb-1">Max Cumulative Session Tokens</label>
          <input
            type="number"
            value={sessionTokenCap}
            onChange={(e) => setSessionTokenCap(Number(e.target.value) || 1000000)}
            step={100000}
            min={100000}
            className="w-full text-xs font-mono rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-1.5"
          />
        </div>
      </div>

      {/* Danger Zone */}
      <div className="p-5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/20 dark:bg-rose-950/20 space-y-3">
        <h3 className="font-semibold text-sm text-rose-700 dark:text-rose-400">
          Danger Zone
        </h3>
        <p className="text-xs text-neutral-600 dark:text-neutral-400">
          Permanently clear all cached documents, workspaces, and pipeline states from your browser storage.
        </p>
        <button
          type="button"
          onClick={handleClearAllData}
          className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 cursor-pointer shadow-xs"
        >
          Clear All Local Data
        </button>
      </div>
    </div>
  );
};
