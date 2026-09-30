/**
 * Sources ingestion view: drag-and-drop, multi-file parsing, paste text, preview, and doc management.
 */
import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  Eye,
  FilePlus,
  FileText,
  Plus,
  Search,
  Tag,
  Trash2,
  UploadCloud
} from 'lucide-react';
import { Badge } from '../components/Badge';
import { parseFile, parsePastedText } from '../ingest/parse';
import { formatTokenCount } from '../lib/cost';
import { formatDocId } from '../lib/id';
import { markDownstreamStale } from '../pipeline/orchestrator';
import { searchIndex } from '../rag';
import { useAppStore } from '../store/app';
import { Chunk, db, SourceDoc, SourceType } from '../store/db';

const SOURCE_TYPES: Array<{ value: SourceType; label: string }> = [
  { value: 'interview', label: 'Customer Interview' },
  { value: 'ticket', label: 'Support Ticket' },
  { value: 'analytics', label: 'Analytics / Metrics' },
  { value: 'competitor', label: 'Competitor Intel' },
  { value: 'feature_request', label: 'Feature Request' },
  { value: 'prd', label: 'Existing PRD / Spec' },
  { value: 'business_goal', label: 'Business Goal / OKR' },
  { value: 'other', label: 'Other Document' }
];

export const SourcesView: React.FC = () => {
  const { activeWorkspaceId, openDrawer, addToast, addLog } = useAppStore();
  const [docs, setDocs] = useState<SourceDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Paste text modal state
  const [isPasting, setIsPasting] = useState(false);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteContent, setPasteContent] = useState('');
  const [pasteType, setPasteType] = useState<SourceType>('interview');

  const loadDocs = async () => {
    if (!activeWorkspaceId) {
      setDocs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await db.sourceDocs.where('workspaceId').equals(activeWorkspaceId).toArray();
      list.sort((a, b) => a.seq - b.seq);
      setDocs(list);

      // Refresh search index
      const chunks = await db.chunks.where('workspaceId').equals(activeWorkspaceId).toArray();
      searchIndex.rebuild(list, chunks);
    } catch (err: any) {
      console.warn('Error loading docs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocs();
  }, [activeWorkspaceId]);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !activeWorkspaceId) return;
    setIsParsing(true);

    try {
      const currentDocs = await db.sourceDocs.where('workspaceId').equals(activeWorkspaceId).toArray();
      let nextSeq = currentDocs.length > 0 ? Math.max(...currentDocs.map((d) => d.seq)) + 1 : 1;
      const existingHashes = new Map(currentDocs.map((d) => [d.hash, d.name]));

      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        addLog('info', `Parsing ${file.name}...`);

        const parsed = await parseFile(file, nextSeq);

        if (parsed.status === 'ok' && existingHashes.has(parsed.hash)) {
          addToast({
            type: 'warn',
            message: `"${file.name}" was already added as "${existingHashes.get(parsed.hash)}".`
          });
          continue;
        }

        const docId = `doc_${Date.now()}_${nextSeq}`;
        const docRecord: SourceDoc = {
          id: docId,
          workspaceId: activeWorkspaceId,
          seq: nextSeq,
          name: parsed.name,
          type: parsed.type,
          mime: parsed.mime,
          text: parsed.text,
          tokenEst: parsed.tokenEst,
          hash: parsed.hash,
          status: parsed.status,
          error: parsed.error,
          uploadedAt: Date.now()
        };

        const chunkRecords: Chunk[] = parsed.chunks.map((c) => ({
          id: c.id,
          workspaceId: activeWorkspaceId,
          docId,
          seq: c.seq,
          heading: c.heading,
          text: c.text,
          start: c.start,
          end: c.end
        }));

        await db.sourceDocs.put(docRecord);
        if (chunkRecords.length > 0) {
          await db.chunks.bulkPut(chunkRecords);
          searchIndex.addChunks(docRecord, chunkRecords);
        }

        if (parsed.status === 'error') {
          addToast({ type: 'error', message: `${file.name}: ${parsed.error}` });
        } else if (parsed.status === 'empty') {
          addToast({ type: 'warn', message: `${file.name}: ${parsed.error}` });
        } else {
          addToast({ type: 'success', message: `Parsed ${file.name} into ${chunkRecords.length} chunks.` });
          nextSeq++;
        }
      }

      await loadDocs();
    } catch (err: any) {
      addToast({ type: 'error', message: `Error processing files: ${err.message}` });
    } finally {
      setIsParsing(false);
    }
  };

  const handlePasteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pasteContent.trim() || !activeWorkspaceId) return;

    try {
      const currentDocs = await db.sourceDocs.where('workspaceId').equals(activeWorkspaceId).toArray();
      const nextSeq = currentDocs.length > 0 ? Math.max(...currentDocs.map((d) => d.seq)) + 1 : 1;

      const parsed = await parsePastedText(pasteTitle, pasteContent, pasteType, nextSeq);
      const docId = `doc_${Date.now()}_${nextSeq}`;

      const docRecord: SourceDoc = {
        id: docId,
        workspaceId: activeWorkspaceId,
        seq: nextSeq,
        name: parsed.name,
        type: parsed.type,
        mime: parsed.mime,
        text: parsed.text,
        tokenEst: parsed.tokenEst,
        hash: parsed.hash,
        status: parsed.status,
        uploadedAt: Date.now()
      };

      const chunkRecords: Chunk[] = parsed.chunks.map((c) => ({
        id: c.id,
        workspaceId: activeWorkspaceId,
        docId,
        seq: c.seq,
        heading: c.heading,
        text: c.text,
        start: c.start,
        end: c.end
      }));

      await db.sourceDocs.put(docRecord);
      await db.chunks.bulkPut(chunkRecords);
      searchIndex.addChunks(docRecord, chunkRecords);

      setPasteTitle('');
      setPasteContent('');
      setIsPasting(false);
      addToast({ type: 'success', message: `Added note "${docRecord.name}".` });
      await loadDocs();
    } catch (err: any) {
      addToast({ type: 'error', message: err.message });
    }
  };

  const handleTypeChange = async (docId: string, newType: SourceType) => {
    try {
      const doc = await db.sourceDocs.get(docId);
      if (doc) {
        await db.sourceDocs.put({ ...doc, type: newType });
        setDocs((prev) => prev.map((d) => (d.id === docId ? { ...d, type: newType } : d)));
        addToast({ type: 'info', message: `Updated document type to ${newType}.` });
      }
    } catch (err: any) {
      addToast({ type: 'error', message: err.message });
    }
  };

  const handleDeleteDoc = async (doc: SourceDoc) => {
    const confirmed = confirm(
      `Delete "${doc.name}"? Downstream pipeline stages will become stale, and evidence citing this document will be marked as orphaned.`
    );
    if (!confirmed || !activeWorkspaceId) return;

    try {
      await db.sourceDocs.delete(doc.id);
      const chunks = await db.chunks.where('docId').equals(doc.id).toArray();
      for (const c of chunks) {
        await db.chunks.delete(c.id);
      }
      searchIndex.removeDocChunks(doc.id);

      // Stale propagation
      await markDownstreamStale(activeWorkspaceId, 'research');

      addToast({
        type: 'warn',
        title: 'Document Deleted',
        message: `Deleted "${doc.name}". Downstream pipeline stages marked stale.`
      });
      await loadDocs();
    } catch (err: any) {
      addToast({ type: 'error', message: err.message });
    }
  };

  const filteredDocs = docs.filter(
    (d) =>
      d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalTokens = docs.reduce((acc, d) => acc + d.tokenEst, 0);
  const totalChars = docs.reduce((acc, d) => acc + d.text.length, 0);

  if (!activeWorkspaceId) {
    return (
      <div className="p-12 text-center border-2 border-dashed border-neutral-300 dark:border-neutral-800 rounded-xl">
        <FileText className="w-8 h-8 text-neutral-400 mx-auto mb-2" />
        <div className="font-semibold text-neutral-800 dark:text-neutral-200">No Active Workspace</div>
        <p className="text-xs text-neutral-500 mt-1">Please create or select a workspace first.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Upload Zone & Actions */}
      <div className="flex flex-col md:flex-row items-stretch gap-4">
        {/* Dropzone */}
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={`flex-1 flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
            isDragging
              ? 'border-indigo-500 bg-indigo-50/30 dark:bg-indigo-950/30'
              : 'border-neutral-300 dark:border-neutral-800 hover:border-neutral-400 bg-white dark:bg-neutral-900'
          }`}
        >
          <UploadCloud className="w-8 h-8 text-indigo-500 mb-2" />
          <div className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
            {isParsing ? 'Processing documents...' : 'Drop files here or click to browse'}
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">
            PDF, DOCX, CSV, JSON, TXT, MD (Max 15MB each)
          </p>
          <input
            type="file"
            multiple
            accept=".pdf,.docx,.csv,.json,.txt,.md"
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
          />
        </label>

        {/* Paste text button */}
        <button
          type="button"
          onClick={() => setIsPasting(true)}
          className="flex flex-col items-center justify-center p-6 border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800/40 rounded-xl cursor-pointer transition-colors min-w-[180px]"
        >
          <FilePlus className="w-8 h-8 text-emerald-500 mb-2" />
          <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
            Paste Notes
          </span>
          <span className="text-xs text-neutral-400 mt-0.5">Raw text or transcript</span>
        </button>
      </div>

      {/* Corpus statistics banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40 text-xs">
        <div className="flex items-center gap-4 text-neutral-600 dark:text-neutral-400 font-mono">
          <span>
            Total Documents: <strong className="text-neutral-900 dark:text-neutral-100">{docs.length}</strong>
          </span>
          <span>
            Corpus Characters: <strong className="text-neutral-900 dark:text-neutral-100">{totalChars.toLocaleString()}</strong>
          </span>
          <span>
            Est. Tokens: <strong className="text-neutral-900 dark:text-neutral-100">~{formatTokenCount(totalTokens)}</strong>
          </span>
        </div>

        {totalChars > 5000000 && (
          <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-4 h-4" />
            <span>Large corpus (&gt;5M chars); retrieval mode will automatically be used.</span>
          </div>
        )}
      </div>

      {/* Search & Filter */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-neutral-400" />
          <input
            type="text"
            placeholder="Search documents by name or type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 pl-8 pr-3 py-1.5 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 text-neutral-900 dark:text-neutral-100"
          />
        </div>
      </div>

      {/* Documents List */}
      {filteredDocs.length === 0 ? (
        <div className="p-8 text-center border border-neutral-200 dark:border-neutral-800 rounded-xl bg-white dark:bg-neutral-900">
          <FileText className="w-6 h-6 text-neutral-400 mx-auto mb-1.5" />
          <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            No source documents uploaded
          </div>
          <p className="text-xs text-neutral-500 mt-0.5">
            Drag files into the dropzone above or click "Load Sample" on the Workspaces page.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredDocs.map((doc) => {
            const docTag = formatDocId(doc.seq);
            const isError = doc.status === 'error';
            const isEmpty = doc.status === 'empty';

            return (
              <div
                key={doc.id}
                className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:border-neutral-300 dark:hover:border-neutral-700 transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-3"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <span className="font-mono text-xs font-bold px-2 py-1 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shrink-0">
                    {docTag}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-neutral-900 dark:text-neutral-100 truncate">
                        {doc.name}
                      </span>
                      {isError && <Badge variant="error" size="sm">Parse Error</Badge>}
                      {isEmpty && <Badge variant="warning" size="sm">Empty/Scanned</Badge>}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500 mt-1 font-mono">
                      <span>~{formatTokenCount(doc.tokenEst)} tokens</span>
                      <span>{(doc.text.length / 1024).toFixed(1)} KB text</span>
                      <span>{new Date(doc.uploadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>

                    {doc.error && (
                      <div className="text-xs text-rose-600 dark:text-rose-400 mt-1.5 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{doc.error}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions & Tagging */}
                <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
                  <div className="relative">
                    <select
                      value={doc.type}
                      onChange={(e) => handleTypeChange(doc.id, e.target.value as SourceType)}
                      className="text-xs rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2.5 py-1 text-neutral-800 dark:text-neutral-200 cursor-pointer"
                    >
                      {SOURCE_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      openDrawer('source', `${docTag}: ${doc.name}`, {
                        chunkId: `${docTag}-C1`,
                        quote: ''
                      })
                    }
                    title="Preview document content"
                    className="p-1.5 rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                  >
                    <Eye className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDeleteDoc(doc)}
                    title="Delete document"
                    className="p-1.5 rounded text-neutral-400 hover:text-rose-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Paste Note Modal */}
      {isPasting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/60 backdrop-blur-xs">
          <form
            onSubmit={handlePasteSubmit}
            className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-2xl max-w-xl w-full flex flex-col max-h-[85vh] p-6 space-y-4"
          >
            <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 text-sm">
              Paste Text / Customer Interview Note
            </h3>

            <div>
              <label className="block text-xs text-neutral-500 mb-1">Title / Source Name</label>
              <input
                type="text"
                placeholder="e.g. Call Notes - Acme Corp VP Ops"
                value={pasteTitle}
                onChange={(e) => setPasteTitle(e.target.value)}
                className="w-full text-xs rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-1.5"
              />
            </div>

            <div>
              <label className="block text-xs text-neutral-500 mb-1">Source Category</label>
              <select
                value={pasteType}
                onChange={(e) => setPasteType(e.target.value as SourceType)}
                className="w-full text-xs rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-1.5"
              >
                {SOURCE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-neutral-500 mb-1">Content Text</label>
              <textarea
                rows={8}
                placeholder="Paste verbatim customer conversation or ticket text here..."
                value={pasteContent}
                onChange={(e) => setPasteContent(e.target.value)}
                className="w-full text-xs font-mono rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3 leading-relaxed"
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsPasting(false)}
                className="px-3.5 py-1.5 text-xs rounded-md text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer"
              >
                Add Document
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
