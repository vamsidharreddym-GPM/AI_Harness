/**
 * Provider registry and dispatcher.
 */
import { anthropicProvider } from './anthropic';
import { googleProvider } from './google';
import { openaiProvider } from './openai';
import { LLMProvider, ProviderId } from './types';

export * from './errors';
export * from './http';
export * from './types';

export const providers: Record<ProviderId, LLMProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  google: googleProvider
};

export function getProvider(id: ProviderId): LLMProvider {
  const p = providers[id];
  if (!p) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return p;
}
