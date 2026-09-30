/**
 * Quote verification engine per Section 10.1.
 * Substring search, sibling chunk relinking, and metric value validation.
 */
import { Chunk } from '../store/db';
import { normalizeText } from '../lib/text';

export interface VerificationResult {
  verified: boolean;
  relinkedChunkId?: string;
  reason?: string;
}

export function verifyQuoteAgainstChunks(
  quote: string,
  citedChunkId: string | undefined,
  docChunks: Chunk[],
  metricValue?: string
): VerificationResult {
  if (!quote || quote.trim().length === 0) {
    return { verified: false, reason: 'Empty quote' };
  }

  const normQuote = normalizeText(quote);
  if (normQuote.length === 0) {
    return { verified: false, reason: 'Empty normalized quote' };
  }

  // Find the directly cited chunk first
  const primaryChunk = docChunks.find((c) => c.id === citedChunkId);

  if (primaryChunk) {
    const normChunkText = normalizeText(primaryChunk.text);
    if (normChunkText.includes(normQuote)) {
      // Check metric value if provided
      if (metricValue && metricValue.trim()) {
        const normMetric = normalizeText(metricValue);
        if (!normChunkText.includes(normMetric)) {
          return { verified: false, reason: 'Metric value not found in cited chunk' };
        }
      }
      return { verified: true };
    }
  }

  // If not found in primary chunk, search sibling chunks of the same document
  for (const sibling of docChunks) {
    if (sibling.id === citedChunkId) continue;
    const normSiblingText = normalizeText(sibling.text);
    if (normSiblingText.includes(normQuote)) {
      if (metricValue && metricValue.trim()) {
        const normMetric = normalizeText(metricValue);
        if (!normSiblingText.includes(normMetric)) {
          continue;
        }
      }
      return {
        verified: true,
        relinkedChunkId: sibling.id,
        reason: 'Found and relinked in sibling chunk'
      };
    }
  }

  // Check partial substring match (if quote was slightly truncated or edited by LLM)
  if (normQuote.length > 30) {
    const prefix = normQuote.slice(0, 25);
    const suffix = normQuote.slice(-25);
    for (const chunk of docChunks) {
      const normChunkText = normalizeText(chunk.text);
      if (normChunkText.includes(prefix) || normChunkText.includes(suffix)) {
        return {
          verified: true,
          relinkedChunkId: chunk.id !== citedChunkId ? chunk.id : undefined,
          reason: 'Fuzzy matched chunk boundary'
        };
      }
    }
  }

  return {
    verified: false,
    reason: 'Quote text not found in source document'
  };
}
