/**
 * Prioritization scoring engine: RICE, ICE, and WSJF.
 * Pure and deterministic with range clamping and tie-breaking.
 */
import { PriorityInput } from '../store/db';

export interface ScoredFeatureItem {
  id: string;
  name: string;
  framework: 'RICE' | 'ICE' | 'WSJF';
  inputs: Record<string, PriorityInput>;
  score: number;
  rank: number;
  incomplete: boolean;
}

export function computeScore(
  framework: 'RICE' | 'ICE' | 'WSJF',
  inputs: Record<string, PriorityInput>
): { score: number; incomplete: boolean } {
  const getVal = (key: string): number | null => {
    const item = inputs[key];
    if (!item || item.value === undefined || item.value === null || item.value === ('') as any) {
      return null;
    }
    const num = Number(item.value);
    return isNaN(num) ? null : num;
  };

  if (framework === 'RICE') {
    const reach = getVal('reach');
    const impact = getVal('impact');
    const confidence = getVal('confidence');
    const effortRaw = getVal('effort');

    if (reach === null || impact === null || confidence === null || effortRaw === null) {
      return { score: 0, incomplete: true };
    }

    const clampedConfidence = Math.max(0, Math.min(1, confidence));
    const effort = effortRaw <= 0 ? 0.5 : effortRaw;
    const score = (reach * impact * clampedConfidence) / effort;
    return {
      score: parseFloat(score.toFixed(2)),
      incomplete: false
    };
  }

  if (framework === 'ICE') {
    const impact = getVal('impact');
    const confidence = getVal('confidence');
    const ease = getVal('ease');

    if (impact === null || confidence === null || ease === null) {
      return { score: 0, incomplete: true };
    }

    const score = impact * confidence * ease;
    return {
      score: parseFloat(score.toFixed(2)),
      incomplete: false
    };
  }

  if (framework === 'WSJF') {
    const bv = getVal('businessValue');
    const tc = getVal('timeCriticality');
    const rr = getVal('riskReduction');
    const jobSizeRaw = getVal('jobSize');

    if (bv === null || tc === null || rr === null || jobSizeRaw === null) {
      return { score: 0, incomplete: true };
    }

    const jobSize = jobSizeRaw <= 0 ? 0.5 : jobSizeRaw;
    const score = (bv + tc + rr) / jobSize;
    return {
      score: parseFloat(score.toFixed(2)),
      incomplete: false
    };
  }

  return { score: 0, incomplete: true };
}

export function rankFeatures<T extends { id: string; name: string; score: number; inputs?: Record<string, PriorityInput> }>(
  items: T[]
): Array<T & { rank: number }> {
  const sorted = [...items].sort((a, b) => {
    // 1. Primary: Score descending
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    // 2. Secondary: Confidence input if available
    const confA = Number(a.inputs?.confidence?.value ?? 0);
    const confB = Number(b.inputs?.confidence?.value ?? 0);
    if (confB !== confA) {
      return confB - confA;
    }
    // 3. Tertiary: Stable deterministic tie breaker on name
    return a.name.localeCompare(b.name);
  });

  return sorted.map((item, index) => ({
    ...item,
    rank: index + 1
  }));
}
