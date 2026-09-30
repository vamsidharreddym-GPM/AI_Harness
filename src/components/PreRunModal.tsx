/**
 * Pre-run sheet modal: configuration, token/cost estimation, lite mode, and token cap safety check.
 */
import React, { useState } from 'react';
import { AlertTriangle, Check, Play, Settings, X, Zap } from 'lucide-react';
import { calculateCost, formatCost, formatTokenCount } from '../lib/cost';
import { ProviderId } from '../providers/types';
import { useAppStore } from '../store/app';
import { STAGE_ORDER } from '../pipeline/orchestrator';
import { StageId } from '../store/db';

interface PreRunModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (config: {
    stageModels: Record<StageId, { provider: ProviderId; model: string }>;
    lite: boolean;
  }) => void;
  documentCount: number;
  totalTokensEst: number;
}

export const PreRunModal: React.FC<PreRunModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  documentCount,
  totalTokensEst
}) => {
  const {
    keys,
    models,
    selectedModels,
    sessionTokensIn,
    sessionTokensOut,
    sessionTokenCap,
    priceTable,
    workspaces,
    activeWorkspaceId,
    updateWorkspaceSettings
  } = useAppStore();

  const currentWs = workspaces.find((w) => w.id === activeWorkspaceId);
  const defaultModels = currentWs?.settings.stageModels || {
    research: { provider: 'google', model: selectedModels.google },
    insight: { provider: 'google', model: selectedModels.google },
    problem: { provider: 'google', model: selectedModels.google },
    prioritization: { provider: 'google', model: selectedModels.google },
    prd: { provider: 'google', model: selectedModels.google },
    roadmap: { provider: 'google', model: selectedModels.google },
    review: { provider: 'google', model: selectedModels.google }
  };

  const [stageModels, setStageModels] = useState<Record<StageId, { provider: ProviderId; model: string }>>(defaultModels);
  const [liteMode, setLiteMode] = useState<boolean>(currentWs?.settings.lite ?? true);
  const [globalProvider, setGlobalProvider] = useState<ProviderId>('google');
  const [globalModel, setGlobalModel] = useState<string>(selectedModels.google);
  const [overrideCapConfirm, setOverrideCapConfirm] = useState(false);

  if (!isOpen) return null;

  // Verify that providers have keys
  const missingKeys: ProviderId[] = [];
  const requiredProviders = new Set(Object.values(stageModels).map((m) => m.provider));
  for (const p of requiredProviders) {
    if (!keys[p]) missingKeys.push(p);
  }

  // Token estimate calculations
  const estimatedInputTokens = liteMode
    ? Math.round(totalTokensEst * 1.5 + 8000)
    : Math.round(totalTokensEst * 3 + 18000);
  const estimatedOutputTokens = liteMode ? 8000 : 18000;
  const totalRunEst = estimatedInputTokens + estimatedOutputTokens;

  // Cost estimate using global model pricing if set
  const pricing = priceTable[globalModel];
  const estCost = calculateCost(estimatedInputTokens, estimatedOutputTokens, pricing);

  const projectedTotalSessionTokens = sessionTokensIn + sessionTokensOut + totalRunEst;
  const exceedsCap = projectedTotalSessionTokens > sessionTokenCap;

  const handleApplyGlobal = () => {
    const updated: any = {};
    for (const s of STAGE_ORDER) {
      updated[s] = { provider: globalProvider, model: globalModel };
    }
    setStageModels(updated);
  };

  const handleStart = () => {
    updateWorkspaceSettings({
      lite: liteMode,
      stageModels
    });
    onConfirm({ stageModels, lite: liteMode });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-2xl max-w-xl w-full flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-indigo-500" />
            <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">
              Pipeline Execution Pre-Run Sheet
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 p-1 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-sm">
          {/* Missing Keys Alert */}
          {missingKeys.length > 0 && (
            <div className="p-3.5 rounded-lg border border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300 flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
              <div>
                <div className="font-semibold text-xs uppercase tracking-wide">Missing API Key</div>
                <div className="text-xs mt-0.5">
                  Stages configured for {missingKeys.join(', ')} require an API key in Settings before running.
                </div>
              </div>
            </div>
          )}

          {/* Quick Model Selector */}
          <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/50 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-neutral-800 dark:text-neutral-200 text-xs uppercase tracking-wider">
                Apply Model to All Stages
              </span>
              <button
                type="button"
                onClick={handleApplyGlobal}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-medium cursor-pointer"
              >
                Apply to all stages
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Provider</label>
                <select
                  value={globalProvider}
                  onChange={(e) => {
                    const p = e.target.value as ProviderId;
                    setGlobalProvider(p);
                    setGlobalModel(selectedModels[p] || '');
                  }}
                  className="w-full text-xs rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-2.5 py-1.5"
                >
                  <option value="google">Google Gemini</option>
                  <option value="openai">OpenAI (ChatGPT)</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Model</label>
                <input
                  type="text"
                  value={globalModel}
                  onChange={(e) => setGlobalModel(e.target.value)}
                  placeholder="e.g. gemini-2.5-flash"
                  className="w-full text-xs rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-2.5 py-1.5 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Estimates Card */}
          <div className="grid grid-cols-3 gap-3 p-3.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-center">
            <div>
              <div className="text-xs text-neutral-500">Documents</div>
              <div className="text-base font-semibold font-mono text-neutral-900 dark:text-neutral-100 mt-0.5">
                {documentCount}
              </div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Est. Tokens</div>
              <div className="text-base font-semibold font-mono text-neutral-900 dark:text-neutral-100 mt-0.5">
                ~{formatTokenCount(totalRunEst)}
              </div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Est. Cost</div>
              <div className="text-base font-semibold font-mono text-neutral-900 dark:text-neutral-100 mt-0.5">
                {formatCost(estCost)}
              </div>
            </div>
          </div>

          {/* Lite Mode Toggle */}
          <label className="flex items-start gap-3 p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
            <input
              type="checkbox"
              checked={liteMode}
              onChange={(e) => setLiteMode(e.target.checked)}
              className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <div className="font-medium text-xs text-neutral-900 dark:text-neutral-100">
                Lite Mode (Recommended for testing)
              </div>
              <div className="text-xs text-neutral-500 mt-0.5">
                Caps research extraction to 3 batches per source type to minimize token consumption and speed up runs.
              </div>
            </div>
          </label>

          {/* Token Cap Warning */}
          {exceedsCap && (
            <div className="p-3.5 rounded-lg border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-xs">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                Session Token Cap Exceeded
              </div>
              <div className="text-xs leading-relaxed">
                Projected run ({formatTokenCount(totalRunEst)} tokens) will surpass your session safety cap ({formatTokenCount(sessionTokenCap)} tokens). Current used: {formatTokenCount(sessionTokensIn + sessionTokensOut)}.
              </div>
              <label className="flex items-center gap-2 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overrideCapConfirm}
                  onChange={(e) => setOverrideCapConfirm(e.target.checked)}
                  className="rounded text-amber-600 focus:ring-amber-500"
                />
                <span className="text-xs font-medium">I understand and want to override the cap for this run</span>
              </label>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/40">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-md cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={missingKeys.length > 0 || (exceedsCap && !overrideCapConfirm)}
            onClick={handleStart}
            className="inline-flex items-center gap-2 px-5 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-md shadow-sm cursor-pointer transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            Start Pipeline Run
          </button>
        </div>
      </div>
    </div>
  );
};
