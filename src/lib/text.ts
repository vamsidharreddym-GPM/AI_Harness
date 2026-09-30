/**
 * Text processing, hashing, sanitization, and key masking.
 */

export async function computeHash(text: string): Promise<string> {
  const normalized = normalizeText(text);
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    try {
      const data = new TextEncoder().encode(normalized);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback below
    }
  }
  // Simple deterministic fallback hash
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `hash-${Math.abs(hash).toString(16)}`;
}

export function normalizeText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .toLowerCase()
    // Curly quotes to straight quotes
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    // Dashes (en-dash, em-dash, figure-dash) to hyphen
    .replace(/[\u2012\u2013\u2014\u2015]/g, '-')
    // Strip markdown formatting characters: *, _, #, `, ~
    .replace(/[*_#`~]/g, ' ')
    // Collapse all whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

export function maskKey(key: string | null | undefined): string {
  if (!key) return '';
  const clean = key.trim();
  if (clean.length <= 4) return '••••';
  return `••••${clean.slice(-4)}`;
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

export function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}
