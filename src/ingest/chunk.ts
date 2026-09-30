/**
 * Chunking engine per Section 6.
 * Splits on headings, blank lines, speaker turns. Target ~3,000 chars, overlap ~300.
 * Hard-splits any paragraph > 4,000 chars. Dropping empty chunks.
 * Chunk ID: D{docSeq}-C{n}
 */
import { formatChunkId } from '../lib/id';

export interface GeneratedChunk {
  id: string;
  seq: number;
  heading?: string;
  text: string;
  start: number;
  end: number;
}

export function chunkText(
  text: string,
  docSeq: number,
  targetChars = 3000,
  overlap = 300,
  maxSingleChunk = 4000
): GeneratedChunk[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  // Pre-split long monolithic paragraphs > maxSingleChunk
  const rawParagraphs = text.split(/\n{2,}/);
  const paragraphs: { text: string; heading?: string }[] = [];

  let currentHeading: string | undefined;

  for (const para of rawParagraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Check if this paragraph is a Markdown heading
    const headingMatch = trimmed.match(/^(#{1,6}\s+.+)/m);
    if (headingMatch) {
      currentHeading = headingMatch[1].trim();
    }

    if (trimmed.length > maxSingleChunk) {
      // Hard split large paragraph by sentences or fixed chunks
      let remaining = trimmed;
      while (remaining.length > 0) {
        if (remaining.length <= maxSingleChunk) {
          paragraphs.push({ text: remaining, heading: currentHeading });
          break;
        }
        let splitIdx = remaining.lastIndexOf('. ', maxSingleChunk);
        if (splitIdx < 1000) {
          splitIdx = maxSingleChunk;
        } else {
          splitIdx += 1; // include period
        }
        paragraphs.push({ text: remaining.slice(0, splitIdx).trim(), heading: currentHeading });
        remaining = remaining.slice(splitIdx).trim();
      }
    } else {
      paragraphs.push({ text: trimmed, heading: currentHeading });
    }
  }

  const chunks: GeneratedChunk[] = [];
  let currentChunkText = '';
  let currentHeadingTag: string | undefined;
  let chunkIndex = 1;
  let runningStart = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (!currentHeadingTag && p.heading) {
      currentHeadingTag = p.heading;
    }

    if (currentChunkText.length > 0 && currentChunkText.length + p.text.length > targetChars) {
      // Complete current chunk
      const fullChunkText = currentChunkText.trim();
      if (fullChunkText.length > 0) {
        chunks.push({
          id: formatChunkId(docSeq, chunkIndex),
          seq: chunkIndex,
          heading: currentHeadingTag,
          text: fullChunkText,
          start: runningStart,
          end: runningStart + fullChunkText.length
        });
        chunkIndex++;
        runningStart += fullChunkText.length;
      }

      // Add overlap from end of previous text
      const overlapSlice = currentChunkText.slice(-overlap);
      currentChunkText = overlapSlice ? `${overlapSlice}\n\n${p.text}` : p.text;
      currentHeadingTag = p.heading || currentHeadingTag;
    } else {
      currentChunkText = currentChunkText ? `${currentChunkText}\n\n${p.text}` : p.text;
    }
  }

  if (currentChunkText.trim().length > 0) {
    const fullChunkText = currentChunkText.trim();
    chunks.push({
      id: formatChunkId(docSeq, chunkIndex),
      seq: chunkIndex,
      heading: currentHeadingTag,
      text: fullChunkText,
      start: runningStart,
      end: runningStart + fullChunkText.length
    });
  }

  return chunks;
}
