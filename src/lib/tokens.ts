/**
 * Token estimation and chunk batching helpers.
 * Token estimate = ceil(chars / 4).
 */

export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export interface ChunkForBatch {
  id: string;
  text: string;
  docId: string;
  heading?: string;
  seq?: number;
}

export interface Batch<T extends { text: string }> {
  batchIndex: number;
  totalChars: number;
  estimatedTokens: number;
  items: T[];
}

const MAX_BATCH_CHARS = 48000;

export function createBatches<T extends { text: string }>(
  items: T[],
  maxChars = MAX_BATCH_CHARS
): Batch<T>[] {
  if (!items || items.length === 0) return [];

  const batches: Batch<T>[] = [];
  let currentItems: T[] = [];
  let currentChars = 0;

  for (const item of items) {
    const itemLength = item.text.length;

    // If single item exceeds maxChars, it goes into its own batch
    if (currentItems.length > 0 && currentChars + itemLength > maxChars) {
      batches.push({
        batchIndex: batches.length,
        totalChars: currentChars,
        estimatedTokens: Math.ceil(currentChars / 4),
        items: currentItems
      });
      currentItems = [item];
      currentChars = itemLength;
    } else {
      currentItems.push(item);
      currentChars += itemLength;
    }
  }

  if (currentItems.length > 0) {
    batches.push({
      batchIndex: batches.length,
      totalChars: currentChars,
      estimatedTokens: Math.ceil(currentChars / 4),
      items: currentItems
    });
  }

  return batches;
}
