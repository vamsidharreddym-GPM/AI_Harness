/**
 * Deterministic code-assigned IDs for AI PM Harness entities.
 * The LLM only receives and references IDs created by the code.
 */

export function formatDocId(seq: number): string {
  return `D${seq}`;
}

export function formatChunkId(docSeq: number, chunkIndex: number): string {
  return `D${docSeq}-C${chunkIndex}`;
}

export function formatEvidenceId(index: number): string {
  return `E${String(index).padStart(3, '0')}`;
}

export function formatGoalId(index: number): string {
  return `G${String(index).padStart(2, '0')}`;
}

export function formatInsightId(index: number): string {
  return `I${String(index).padStart(2, '0')}`;
}

export function formatProblemId(index: number): string {
  return `P${String(index).padStart(2, '0')}`;
}

export function formatOpportunityId(index: number): string {
  return `O${String(index).padStart(2, '0')}`;
}

export function formatFeatureId(index: number): string {
  return `F${String(index).padStart(2, '0')}`;
}

export function formatRequirementId(index: number): string {
  return `FR-${String(index).padStart(3, '0')}`;
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
