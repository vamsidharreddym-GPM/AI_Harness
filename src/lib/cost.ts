/**
 * Cost calculation and formatting.
 * Prices are user-configured ($/1M tokens). If unset, returns null so UI shows tokens only.
 */

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export type PriceTable = Record<string, ModelPricing>;

export function calculateCost(
  tokensIn: number,
  tokensOut: number,
  pricing?: ModelPricing | null
): number | null {
  if (!pricing) return null;
  const inCost = (tokensIn / 1_000_000) * pricing.inputPerMillion;
  const outCost = (tokensOut / 1_000_000) * pricing.outputPerMillion;
  return inCost + outCost;
}

export function formatCost(amount: number | null): string {
  if (amount === null || isNaN(amount)) return 'Set prices to see cost';
  if (amount < 0.01 && amount > 0) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return String(tokens);
}
