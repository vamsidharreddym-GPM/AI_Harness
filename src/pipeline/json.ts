/**
 * Tolerant JSON extraction and repair per Section 9.2.
 * String-aware brace matching, markdown fence removal, trailing comma tolerance, truncation repair.
 */

export interface ExtractedJsonResult {
  data: any;
  truncated: boolean;
  rawJson: string;
}

export function extractJson(text: string): ExtractedJsonResult {
  if (!text || !text.trim()) {
    throw new Error('Empty model response; expected JSON.');
  }

  // 1. Strip markdown code fences (```json or ```)
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/gm, '').replace(/```$/gm, '');

  // 2. Normalize smart/curly quotes
  cleaned = cleaned
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'");

  // 3. String-aware balanced brace / bracket finder
  const startBrace = cleaned.indexOf('{');
  const startBracket = cleaned.indexOf('[');

  let startIndex = -1;
  let isObject = true;

  if (startBrace !== -1 && startBracket !== -1) {
    if (startBrace < startBracket) {
      startIndex = startBrace;
      isObject = true;
    } else {
      startIndex = startBracket;
      isObject = false;
    }
  } else if (startBrace !== -1) {
    startIndex = startBrace;
    isObject = true;
  } else if (startBracket !== -1) {
    startIndex = startBracket;
    isObject = false;
  } else {
    throw new Error('No JSON object or array found in model response.');
  }

  const openChar = isObject ? '{' : '[';
  const closeChar = isObject ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let endIndex = -1;
  const stack: string[] = [];

  for (let i = startIndex; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{' || char === '[') {
        depth++;
        stack.push(char === '{' ? '}' : ']');
      } else if (char === '}' || char === ']') {
        depth--;
        stack.pop();
        if (depth === 0) {
          endIndex = i;
          break;
        }
      }
    }
  }

  let candidate = '';
  let truncated = false;

  if (endIndex !== -1) {
    candidate = cleaned.slice(startIndex, endIndex + 1);
  } else {
    // Truncated JSON: attempt to repair and close open structures
    truncated = true;
    candidate = cleaned.slice(startIndex);

    // If currently in an unclosed string, close the quote
    if (inString) {
      candidate += '"';
    }

    // Remove any trailing dangling keys or colons
    candidate = candidate.replace(/,\s*$/g, '').replace(/:\s*$/g, ': null');

    // Close remaining open brackets and braces in reverse order
    while (stack.length > 0) {
      const closer = stack.pop();
      candidate += closer;
    }
  }

  // 4. Remove trailing commas before closing braces/brackets
  candidate = candidate.replace(/,\s*([}\]])/g, '$1');

  try {
    const parsed = JSON.parse(candidate);
    return {
      data: parsed,
      truncated,
      rawJson: candidate
    };
  } catch (err: any) {
    // Second-pass cleanup: remove newlines inside strings if any
    try {
      const sanitized = candidate.replace(/\n(?=(?:[^"]*"[^"]*")*[^"]*$)/g, ' ');
      const parsed2 = JSON.parse(sanitized);
      return {
        data: parsed2,
        truncated,
        rawJson: sanitized
      };
    } catch {
      throw new Error(`Failed to parse extracted JSON: ${err?.message}`);
    }
  }
}
