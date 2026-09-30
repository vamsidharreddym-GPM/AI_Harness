/**
 * In-memory MiniSearch BM25 index for fast keyword/semantic-style retrieval over chunks.
 */
import MiniSearch from 'minisearch';
import { Chunk, SourceDoc } from '../store/db';

export interface IndexedChunkItem {
  id: string; // Chunk id e.g. "D1-C2"
  chunkId: string;
  docId: string;
  docName: string;
  docType: string;
  heading: string;
  text: string;
}

class SearchService {
  private miniSearch: MiniSearch<IndexedChunkItem>;
  private chunkMap: Map<string, IndexedChunkItem> = new Map();

  constructor() {
    this.miniSearch = new MiniSearch<IndexedChunkItem>({
      fields: ['text', 'heading', 'docName'],
      storeFields: ['id', 'chunkId', 'docId', 'docName', 'docType', 'heading', 'text'],
      searchOptions: {
        fuzzy: 0.2,
        prefix: true,
        boost: { heading: 2, text: 1, docName: 1.5 }
      }
    });
  }

  clear() {
    this.miniSearch.removeAll();
    this.chunkMap.clear();
  }

  rebuild(docs: SourceDoc[], chunks: Chunk[]) {
    this.clear();
    const docMap = new Map(docs.map((d) => [d.id, d]));

    const items: IndexedChunkItem[] = [];
    for (const c of chunks) {
      const doc = docMap.get(c.docId);
      const item: IndexedChunkItem = {
        id: c.id,
        chunkId: c.id,
        docId: c.docId,
        docName: doc?.name || '',
        docType: doc?.type || 'other',
        heading: c.heading || '',
        text: c.text
      };
      items.push(item);
      this.chunkMap.set(c.id, item);
    }

    if (items.length > 0) {
      this.miniSearch.addAll(items);
    }
  }

  addChunks(doc: SourceDoc, chunks: Chunk[]) {
    const items: IndexedChunkItem[] = chunks.map((c) => ({
      id: c.id,
      chunkId: c.id,
      docId: doc.id,
      docName: doc.name,
      docType: doc.type,
      heading: c.heading || '',
      text: c.text
    }));

    for (const it of items) {
      this.chunkMap.set(it.id, it);
    }
    this.miniSearch.addAll(items);
  }

  removeDocChunks(docId: string) {
    const toRemove: IndexedChunkItem[] = [];
    for (const item of this.chunkMap.values()) {
      if (item.docId === docId) {
        toRemove.push(item);
      }
    }

    for (const item of toRemove) {
      this.chunkMap.delete(item.id);
      try {
        this.miniSearch.remove(item);
      } catch {
        // Safe ignore
      }
    }
  }

  search(
    query: string,
    options: {
      allowedDocIds?: string[];
      limit?: number;
    } = {}
  ): IndexedChunkItem[] {
    const { allowedDocIds, limit = 8 } = options;
    const cleanQuery = query.trim();

    if (!cleanQuery) {
      // Empty or whitespace-only query: return initial chunks from allowed docs
      const list = Array.from(this.chunkMap.values());
      const filtered = allowedDocIds ? list.filter((i) => allowedDocIds.includes(i.docId)) : list;
      return filtered.slice(0, limit);
    }

    try {
      const results = this.miniSearch.search(cleanQuery, {
        filter: allowedDocIds ? (item) => allowedDocIds.includes(item.docId) : undefined
      });

      if (results.length > 0) {
        return results.slice(0, limit).map((r) => this.chunkMap.get(r.id)!).filter(Boolean);
      }
    } catch {
      // Ignore query syntax errors and fallback
    }

    // Fallback: simple token substring search
    const terms = cleanQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const scored: Array<{ item: IndexedChunkItem; score: number }> = [];

    for (const item of this.chunkMap.values()) {
      if (allowedDocIds && !allowedDocIds.includes(item.docId)) continue;
      const lower = item.text.toLowerCase();
      let matchCount = 0;
      for (const t of terms) {
        if (lower.includes(t)) matchCount++;
      }
      if (matchCount > 0) {
        scored.push({ item, score: matchCount });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    if (scored.length > 0) {
      return scored.slice(0, limit).map((s) => s.item);
    }

    // Final fallback: return first chunks
    const fallbackList = Array.from(this.chunkMap.values());
    const filtered = allowedDocIds ? fallbackList.filter((i) => allowedDocIds.includes(i.docId)) : fallbackList;
    return filtered.slice(0, limit);
  }

  getChunk(chunkId: string): IndexedChunkItem | undefined {
    return this.chunkMap.get(chunkId);
  }
}

export const searchIndex = new SearchService();
