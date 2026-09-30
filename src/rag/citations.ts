/**
 * Citation extraction, bracket parsing, and verification against known chunks.
 */

export interface ParsedCitation {
  raw: string;
  chunkId: string;
  valid: boolean;
}

export function extractCitations(
  text: string,
  knownChunkIds: Set<string> | string[]
): ParsedCitation[] {
  if (!text) return [];

  const validSet = knownChunkIds instanceof Set ? knownChunkIds : new Set(knownChunkIds);
  const results: ParsedCitation[] = [];
  const seen = new Set<string>();

  // Matches [D1-C2], [D3-C12, D1-C4], or standalone D1-C2
  const bracketRegex = /\[([D0-9\s,-C]+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = bracketRegex.exec(text)) !== null) {
    const inner = match[1];
    const chunkRegex = /D\d+-C\d+/g;
    let chunkMatch: RegExpExecArray | null;
    while ((chunkMatch = chunkRegex.exec(inner)) !== null) {
      const chunkId = chunkMatch[0];
      if (!seen.has(chunkId)) {
        seen.add(chunkId);
        results.push({
          raw: chunkId,
          chunkId,
          valid: validSet.has(chunkId)
        });
      }
    }
  }

  // Also check any unbracketed D\d+-C\d+ tokens
  const standaloneRegex = /\b(D\d+-C\d+)\b/g;
  while ((match = standaloneRegex.exec(text)) !== null) {
    const chunkId = match[1];
    if (!seen.has(chunkId)) {
      seen.add(chunkId);
      results.push({
        raw: chunkId,
        chunkId,
        valid: validSet.has(chunkId)
      });
    }
  }

  return results;
}
