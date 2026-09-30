/**
 * CSV parser and chunk generator.
 * Produces statistical summary chunk + row-group chunks with headers.
 */
import Papa from 'papaparse';
import { formatChunkId } from '../lib/id';
import { GeneratedChunk } from './chunk';

export interface CsvParseResult {
  summaryChunk: GeneratedChunk;
  rowChunks: GeneratedChunk[];
  totalRows: number;
  warnings: string[];
  stats: Record<string, { count: number; min: number; max: number; mean: number; sum: number }>;
}

export function parseAndChunkCsv(
  csvContent: string,
  docSeq: number,
  maxRowChunks = 40
): CsvParseResult {
  const warnings: string[] = [];
  const parsed = Papa.parse<Record<string, any>>(csvContent, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true
  });

  if (parsed.errors && parsed.errors.length > 0) {
    warnings.push(`${parsed.errors.length} CSV row(s) had formatting irregularities.`);
  }

  const rows = parsed.data || [];
  const columns = parsed.meta.fields || (rows[0] ? Object.keys(rows[0]) : []);
  const totalRows = rows.length;

  // Compute numeric & categorical column statistics
  const numericStats: Record<string, { count: number; min: number; max: number; mean: number; sum: number }> = {};
  const categoricalValues: Record<string, Map<string, number>> = {};

  for (const col of columns) {
    let numCount = 0;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    const catMap = new Map<string, number>();

    for (const row of rows) {
      const val = row[col];
      if (typeof val === 'number' && !isNaN(val)) {
        numCount++;
        if (val < min) min = val;
        if (val > max) max = val;
        sum += val;
      } else if (val !== null && val !== undefined && val !== '') {
        const strVal = String(val).trim();
        catMap.set(strVal, (catMap.get(strVal) || 0) + 1);
      }
    }

    if (numCount > 0 && numCount >= totalRows * 0.4) {
      numericStats[col] = {
        count: numCount,
        min: min === Infinity ? 0 : min,
        max: max === -Infinity ? 0 : max,
        mean: numCount > 0 ? parseFloat((sum / numCount).toFixed(2)) : 0,
        sum: parseFloat(sum.toFixed(2))
      };
    } else if (catMap.size > 0) {
      categoricalValues[col] = catMap;
    }
  }

  // Build summary text
  let summaryText = `### CSV Data Summary\n`;
  summaryText += `Total Rows: ${totalRows} | Total Columns: ${columns.length}\n`;
  summaryText += `Columns: ${columns.join(', ')}\n\n`;

  if (Object.keys(numericStats).length > 0) {
    summaryText += `#### Numeric Column Metrics:\n`;
    for (const [col, s] of Object.entries(numericStats)) {
      summaryText += `- ${col}: Count=${s.count}, Min=${s.min}, Max=${s.max}, Mean=${s.mean}, Sum=${s.sum}\n`;
    }
    summaryText += `\n`;
  }

  if (Object.keys(categoricalValues).length > 0) {
    summaryText += `#### Key Categorical Distributions (Top Values):\n`;
    for (const [col, catMap] of Object.entries(categoricalValues)) {
      const top = Array.from(catMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([val, cnt]) => `${val} (${cnt})`)
        .join(', ');
      summaryText += `- ${col}: ${top}\n`;
    }
  }

  const summaryChunk: GeneratedChunk = {
    id: formatChunkId(docSeq, 1),
    seq: 1,
    heading: 'CSV Data Summary',
    text: summaryText.trim(),
    start: 0,
    end: summaryText.length
  };

  // Build row-group chunks (~25 rows per chunk)
  const rowChunks: GeneratedChunk[] = [];
  const GROUP_SIZE = 25;
  const headerLine = columns.join(',');
  let chunkSeq = 2;

  for (let i = 0; i < totalRows && rowChunks.length < maxRowChunks; i += GROUP_SIZE) {
    const slice = rows.slice(i, i + GROUP_SIZE);
    let chunkBody = `${headerLine}\n`;
    for (const r of slice) {
      const line = columns.map((c) => JSON.stringify(r[c] ?? '')).join(',');
      chunkBody += `${line}\n`;
    }

    rowChunks.push({
      id: formatChunkId(docSeq, chunkSeq),
      seq: chunkSeq,
      heading: `Rows ${i + 1} to ${Math.min(i + GROUP_SIZE, totalRows)}`,
      text: chunkBody.trim(),
      start: 0,
      end: chunkBody.length
    });
    chunkSeq++;
  }

  if (totalRows > maxRowChunks * GROUP_SIZE) {
    warnings.push(
      `Only first ${maxRowChunks * GROUP_SIZE} rows indexed for retrieval; summary covers all ${totalRows} rows.`
    );
  }

  return {
    summaryChunk,
    rowChunks,
    totalRows,
    warnings,
    stats: numericStats
  };
}
