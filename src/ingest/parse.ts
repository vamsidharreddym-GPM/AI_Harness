/**
 * Multi-format document parser: PDF, DOCX, CSV, JSON, TXT/MD.
 */
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import { SourceType } from '../store/db';
import { computeHash, normalizeText } from '../lib/text';
import { estimateTokens } from '../lib/tokens';
import { chunkText, GeneratedChunk } from './chunk';
import { parseAndChunkCsv } from './csv';

// Polyfill Promise.withResolvers if needed by pdfjs-dist
if (typeof (Promise as any).withResolvers === 'undefined') {
  (Promise as any).withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: any) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// Configure PDF worker safely for Vite build
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();
} catch {
  // Fallback to unpkg worker if URL constructor fails
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
}

export interface ParsedDocument {
  name: string;
  type: SourceType;
  mime: string;
  text: string;
  tokenEst: number;
  hash: string;
  status: 'ok' | 'error' | 'empty';
  error?: string;
  chunks: GeneratedChunk[];
  warnings: string[];
}

export function suggestSourceType(filename: string, contentSample: string = ''): SourceType {
  const combined = `${filename} ${contentSample.slice(0, 1000)}`.toLowerCase();

  if (combined.includes('interview') || combined.includes('transcript') || combined.includes('user_call') || combined.includes('cust_call')) {
    return 'interview';
  }
  if (combined.includes('ticket') || combined.includes('zendesk') || combined.includes('csat') || combined.includes('support')) {
    return 'ticket';
  }
  if (combined.includes('analytics') || combined.includes('funnel') || combined.includes('retention') || combined.includes('cohort') || combined.includes('dau') || combined.includes('mau')) {
    return 'analytics';
  }
  if (combined.includes('competitor') || combined.includes('competitive') || combined.includes('vs_') || combined.includes('matrix') || combined.includes('benchmark')) {
    return 'competitor';
  }
  if (combined.includes('feature_request') || combined.includes('backlog') || combined.includes('wishlist') || combined.includes('ideas')) {
    return 'feature_request';
  }
  if (combined.includes('prd') || combined.includes('spec') || combined.includes('product_requirement')) {
    return 'prd';
  }
  if (combined.includes('goal') || combined.includes('okr') || combined.includes('kpi') || combined.includes('strategy') || combined.includes('business')) {
    return 'business_goal';
  }
  return 'other';
}

export async function parseFile(
  file: File,
  docSeq: number
): Promise<ParsedDocument> {
  const maxBytes = 15 * 1024 * 1024;
  if (file.size > maxBytes) {
    return {
      name: file.name,
      type: 'other',
      mime: file.type || 'unknown',
      text: '',
      tokenEst: 0,
      hash: '',
      status: 'error',
      error: `File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum allowed size is 15 MB.`,
      chunks: [],
      warnings: []
    };
  }

  if (file.size === 0) {
    return {
      name: file.name,
      type: 'other',
      mime: file.type || 'unknown',
      text: '',
      tokenEst: 0,
      hash: '',
      status: 'empty',
      error: 'File is empty (0 bytes).',
      chunks: [],
      warnings: []
    };
  }

  const name = file.name;
  const ext = name.split('.').pop()?.toLowerCase() || '';

  if (ext === 'doc') {
    return {
      name,
      type: 'other',
      mime: 'application/msword',
      text: '',
      tokenEst: 0,
      hash: '',
      status: 'error',
      error: 'Legacy Word (.doc) is not supported. Please save as modern .docx or plain text.',
      chunks: [],
      warnings: []
    };
  }

  const unsupportedExts = ['png', 'jpg', 'jpeg', 'gif', 'zip', 'tar', 'gz', 'pptx', 'xlsx', 'mp3', 'mp4'];
  if (unsupportedExts.includes(ext)) {
    return {
      name,
      type: 'other',
      mime: file.type || 'unknown',
      text: '',
      tokenEst: 0,
      hash: '',
      status: 'error',
      error: `Unsupported file type .${ext}. Supported types: PDF, DOCX, CSV, JSON, TXT, MD.`,
      chunks: [],
      warnings: []
    };
  }

  try {
    if (ext === 'pdf' || file.type === 'application/pdf') {
      return await parsePdf(file, docSeq);
    }
    if (ext === 'docx' || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return await parseDocx(file, docSeq);
    }
    if (ext === 'csv' || file.type === 'text/csv') {
      return await parseCsvFile(file, docSeq);
    }
    if (ext === 'json' || file.type === 'application/json') {
      return await parseJsonFile(file, docSeq);
    }

    // Default: treat as plain text / markdown
    return await parseTextFile(file, docSeq);
  } catch (err: any) {
    return {
      name,
      type: suggestSourceType(name),
      mime: file.type || 'text/plain',
      text: '',
      tokenEst: 0,
      hash: '',
      status: 'error',
      error: `Failed to parse file: ${err?.message || 'Unknown parsing error'}`,
      chunks: [],
      warnings: []
    };
  }
}

async function parsePdf(file: File, docSeq: number): Promise<ParsedDocument> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;

  let fullText = '';
  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str || '')
      .join(' ')
      .trim();
    if (pageText) {
      fullText += `--- Page ${i} ---\n${pageText}\n\n`;
    }
  }

  const cleanText = fullText.trim();
  if (cleanText.length < 20) {
    return {
      name: file.name,
      type: suggestSourceType(file.name),
      mime: 'application/pdf',
      text: cleanText,
      tokenEst: estimateTokens(cleanText),
      hash: await computeHash(cleanText || file.name),
      status: 'empty',
      error: 'No text found. This looks like a scanned PDF (OCR is not supported).',
      chunks: [],
      warnings: ['Document appears to be scanned or contains non-selectable image text.']
    };
  }

  const hash = await computeHash(cleanText);
  const chunks = chunkText(cleanText, docSeq);
  const type = suggestSourceType(file.name, cleanText);

  return {
    name: file.name,
    type,
    mime: 'application/pdf',
    text: cleanText,
    tokenEst: estimateTokens(cleanText),
    hash,
    status: 'ok',
    chunks,
    warnings: []
  };
}

async function parseDocx(file: File, docSeq: number): Promise<ParsedDocument> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  const rawText = (result.value || '').trim();

  if (!rawText) {
    return {
      name: file.name,
      type: suggestSourceType(file.name),
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      text: '',
      tokenEst: 0,
      hash: await computeHash(file.name),
      status: 'empty',
      error: 'Word document has no text content.',
      chunks: [],
      warnings: []
    };
  }

  const hash = await computeHash(rawText);
  const chunks = chunkText(rawText, docSeq);
  const type = suggestSourceType(file.name, rawText);

  return {
    name: file.name,
    type,
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    text: rawText,
    tokenEst: estimateTokens(rawText),
    hash,
    status: 'ok',
    chunks,
    warnings: result.messages?.map((m) => m.message) || []
  };
}

async function parseCsvFile(file: File, docSeq: number): Promise<ParsedDocument> {
  const rawText = await file.text();
  const clean = rawText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();

  if (!clean) {
    return {
      name: file.name,
      type: 'analytics',
      mime: 'text/csv',
      text: '',
      tokenEst: 0,
      hash: await computeHash(file.name),
      status: 'empty',
      error: 'CSV file is empty.',
      chunks: [],
      warnings: []
    };
  }

  const { summaryChunk, rowChunks, warnings } = parseAndChunkCsv(clean, docSeq);
  const allChunks = [summaryChunk, ...rowChunks];
  const hash = await computeHash(clean);

  return {
    name: file.name,
    type: suggestSourceType(file.name, clean),
    mime: 'text/csv',
    text: clean,
    tokenEst: estimateTokens(clean),
    hash,
    status: 'ok',
    chunks: allChunks,
    warnings
  };
}

async function parseJsonFile(file: File, docSeq: number): Promise<ParsedDocument> {
  const rawText = await file.text();
  let cleanText = rawText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  const warnings: string[] = [];

  try {
    const parsed = JSON.parse(cleanText);
    cleanText = JSON.stringify(parsed, null, 2);
  } catch {
    warnings.push('File contained invalid JSON syntax; parsed as plain text.');
  }

  if (!cleanText) {
    return {
      name: file.name,
      type: 'other',
      mime: 'application/json',
      text: '',
      tokenEst: 0,
      hash: await computeHash(file.name),
      status: 'empty',
      error: 'JSON file is empty.',
      chunks: [],
      warnings: []
    };
  }

  const hash = await computeHash(cleanText);
  const chunks = chunkText(cleanText, docSeq);
  const type = suggestSourceType(file.name, cleanText);

  return {
    name: file.name,
    type,
    mime: 'application/json',
    text: cleanText,
    tokenEst: estimateTokens(cleanText),
    hash,
    status: 'ok',
    chunks,
    warnings
  };
}

async function parseTextFile(file: File, docSeq: number): Promise<ParsedDocument> {
  const raw = await file.text();
  const clean = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();

  if (!clean) {
    return {
      name: file.name,
      type: 'other',
      mime: 'text/plain',
      text: '',
      tokenEst: 0,
      hash: await computeHash(file.name),
      status: 'empty',
      error: 'File is empty.',
      chunks: [],
      warnings: []
    };
  }

  const hash = await computeHash(clean);
  const chunks = chunkText(clean, docSeq);
  const type = suggestSourceType(file.name, clean);

  return {
    name: file.name,
    type,
    mime: file.type || 'text/plain',
    text: clean,
    tokenEst: estimateTokens(clean),
    hash,
    status: 'ok',
    chunks,
    warnings: []
  };
}

export async function parsePastedText(
  title: string,
  text: string,
  type: SourceType,
  docSeq: number
): Promise<ParsedDocument> {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  if (!clean) {
    throw new Error('Pasted content cannot be empty.');
  }

  const hash = await computeHash(clean);
  const chunks = chunkText(clean, docSeq);

  return {
    name: title.trim() || `Pasted Note ${docSeq}`,
    type,
    mime: 'text/plain',
    text: clean,
    tokenEst: estimateTokens(clean),
    hash,
    status: 'ok',
    chunks,
    warnings: []
  };
}
