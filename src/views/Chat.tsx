/**
 * Grounded RAG Chat view with citations, streaming, web search toggle, and thread history.
 */
import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertCircle,
  Copy,
  Download,
  Globe,
  Plus,
  RefreshCw,
  Send,
  Square,
  Trash2
} from 'lucide-react';
import { CitationChip } from '../components/CitationChip';
import { extractCitations } from '../rag/citations';
import { buildChatContext, buildChatSystemPrompt } from '../rag/context';
import { getProvider } from '../providers';
import { ProviderId } from '../providers/types';
import { useAppStore } from '../store/app';
import { Chunk, db, Message, SourceDoc, SourceType, Thread } from '../store/db';
import { formatDocId } from '../lib/id';

const STARTER_PROMPTS = [
  'What are the top 3 recurring customer pain points across all interviews?',
  'Show me every mention of webhook failures or silent bugs.',
  'Compare our pricing feedback between SMB and Enterprise users.',
  'What metrics or funnel steps show the highest drop-off rate?'
];

export const ChatView: React.FC = () => {
  const {
    activeWorkspaceId,
    keys,
    selectedModels,
    openDrawer,
    addToast,
    addLog,
    addSessionTokens,
    setActiveView
  } = useAppStore();

  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeProvider, setActiveProvider] = useState<ProviderId>('google');
  const [useWeb, setUseWeb] = useState(false);
  const [scope, setScope] = useState<'all' | 'selected' | 'type'>('all');
  const [scopeType, setScopeType] = useState<SourceType>('interview');

  // Documents and chunks for context
  const [docs, setDocs] = useState<SourceDoc[]>([]);
  const [chunks, setChunks] = useState<Chunk[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll helper
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming]);

  // Load docs & chunks
  useEffect(() => {
    if (!activeWorkspaceId) return;
    async function loadSources() {
      const d = await db.sourceDocs.where('workspaceId').equals(activeWorkspaceId!).toArray();
      const c = await db.chunks.where('workspaceId').equals(activeWorkspaceId!).toArray();
      setDocs(d.filter((doc) => doc.status === 'ok'));
      setChunks(c);
    }
    loadSources();
  }, [activeWorkspaceId]);

  // Load threads
  useEffect(() => {
    if (!activeWorkspaceId) return;
    async function loadThreads() {
      const list = await db.threads.where('workspaceId').equals(activeWorkspaceId!).toArray();
      list.sort((a, b) => b.createdAt - a.createdAt);
      setThreads(list);
      if (list.length > 0 && !activeThreadId) {
        setActiveThreadId(list[0].id);
      }
    }
    loadThreads();
  }, [activeWorkspaceId]);

  // Load messages when active thread changes
  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }
    async function loadThreadMessages() {
      const list = await db.messages.where('threadId').equals(activeThreadId!).toArray();
      list.sort((a, b) => a.createdAt - b.createdAt);
      setMessages(list);
    }
    loadThreadMessages();
  }, [activeThreadId]);

  const handleNewThread = async () => {
    if (!activeWorkspaceId) return;
    const newThread: Thread = {
      id: `th_${Date.now()}`,
      workspaceId: activeWorkspaceId,
      title: 'New Conversation',
      provider: activeProvider,
      model: selectedModels[activeProvider],
      scope,
      scopeType,
      useWeb,
      mode: 'auto',
      createdAt: Date.now()
    };

    await db.threads.put(newThread);
    setThreads((prev) => [newThread, ...prev]);
    setActiveThreadId(newThread.id);
  };

  const handleSend = async (textToSend?: string) => {
    const promptText = (textToSend ?? input).trim();
    if (!promptText || isStreaming || !activeWorkspaceId) return;

    const currentKey = keys[activeProvider];
    if (!currentKey) {
      addToast({
        type: 'error',
        message: `Please configure an API key for ${activeProvider} in Settings.`,
        action: { label: 'Settings', onClick: () => setActiveView('settings') }
      });
      return;
    }

    let threadId = activeThreadId;
    if (!threadId) {
      const newThread: Thread = {
        id: `th_${Date.now()}`,
        workspaceId: activeWorkspaceId,
        title: promptText.slice(0, 40),
        provider: activeProvider,
        model: selectedModels[activeProvider],
        scope,
        scopeType,
        useWeb,
        mode: 'auto',
        createdAt: Date.now()
      };
      await db.threads.put(newThread);
      setThreads((prev) => [newThread, ...prev]);
      setActiveThreadId(newThread.id);
      threadId = newThread.id;
    }

    // Add user message
    const userMsg: Message = {
      id: `msg_u_${Date.now()}`,
      workspaceId: activeWorkspaceId,
      threadId,
      role: 'user',
      content: promptText,
      citations: [],
      createdAt: Date.now()
    };

    await db.messages.put(userMsg);
    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    // Prepare assistant placeholder
    const assistantMsgId = `msg_a_${Date.now()}`;
    const assistantMsg: Message = {
      id: assistantMsgId,
      workspaceId: activeWorkspaceId,
      threadId,
      role: 'assistant',
      content: '',
      provider: activeProvider,
      model: selectedModels[activeProvider],
      citations: [],
      createdAt: Date.now()
    };
    setMessages((prev) => [...prev, assistantMsg]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Filter scoped documents
    let targetDocs = docs;
    if (scope === 'type') {
      targetDocs = docs.filter((d) => d.type === scopeType);
    }

    const { contextText, modeUsed } = buildChatContext(promptText, targetDocs, chunks, 'auto');
    const systemPrompt = buildChatSystemPrompt(docs.length > 0, useWeb);

    let fullPromptWithContext = promptText;
    if (contextText) {
      fullPromptWithContext = `Here are the reference document sources:\n\n${contextText}\n\nUser Question:\n${promptText}`;
    }

    const provider = getProvider(activeProvider);
    let streamedContent = '';

    try {
      const res = await provider.generate({
        key: currentKey,
        model: selectedModels[activeProvider],
        system: systemPrompt,
        messages: [{ role: 'user', content: fullPromptWithContext }],
        web: useWeb,
        signal: controller.signal,
        onToken: (tok) => {
          streamedContent += tok;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, content: streamedContent } : m))
          );
        }
      });

      const finalContent = res.text || streamedContent;

      // Extract and validate citations
      const allKnownChunkIds = new Set(chunks.map((c) => c.id));
      const parsedCitations = extractCitations(finalContent, allKnownChunkIds);

      const combinedCitations: any[] = parsedCitations.map((c) => ({
        type: 'doc',
        chunkId: c.chunkId,
        valid: c.valid
      }));

      // Add web citations if present
      if (res.citations) {
        for (const wc of res.citations) {
          combinedCitations.push({
            type: 'web',
            url: wc.url,
            title: wc.title
          });
        }
      }

      const updatedAssistant: Message = {
        ...assistantMsg,
        content: finalContent,
        citations: combinedCitations,
        tokens: res.usage
      };

      await db.messages.put(updatedAssistant);
      setMessages((prev) => prev.map((m) => (m.id === assistantMsgId ? updatedAssistant : m)));
      addSessionTokens(res.usage.in, res.usage.out);
    } catch (err: any) {
      if (err?.code === 'ABORT') {
        const abortedMsg: Message = {
          ...assistantMsg,
          content: streamedContent + '\n\n*(Generation stopped by user)*',
          error: 'stopped'
        };
        await db.messages.put(abortedMsg);
        setMessages((prev) => prev.map((m) => (m.id === assistantMsgId ? abortedMsg : m)));
      } else {
        const errorMsg: Message = {
          ...assistantMsg,
          content: `⚠️ ${err?.message || 'Failed to generate answer.'}`,
          error: err?.message
        };
        await db.messages.put(errorMsg);
        setMessages((prev) => prev.map((m) => (m.id === assistantMsgId ? errorMsg : m)));
        addToast({ type: 'error', message: err?.message || 'Chat generation error' });
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleExportMarkdown = () => {
    let md = `# Conversation Export\n\n`;
    for (const m of messages) {
      md += `### ${m.role === 'user' ? 'User' : 'Assistant'} (${m.model || ''})\n\n${m.content}\n\n---\n\n`;
    }
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat_export_${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-[calc(100vh-140px)] gap-4">
      {/* Threads Sidebar */}
      <div className="w-56 shrink-0 flex flex-col border border-neutral-200 dark:border-neutral-800 rounded-xl bg-white dark:bg-neutral-900 overflow-hidden">
        <div className="p-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <span className="font-semibold text-xs text-neutral-800 dark:text-neutral-200 uppercase tracking-wider">
            Threads
          </span>
          <button
            type="button"
            onClick={handleNewThread}
            className="p-1 rounded text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {threads.map((t) => (
            <div
              key={t.id}
              onClick={() => setActiveThreadId(t.id)}
              className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                t.id === activeThreadId
                  ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-medium'
                  : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              <span className="truncate pr-1">{t.title}</span>
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  await db.threads.delete(t.id);
                  const threadMsgs = await db.messages.where('threadId').equals(t.id).toArray();
                  for (const m of threadMsgs) await db.messages.delete(m.id);
                  setThreads((prev) => prev.filter((item) => item.id !== t.id));
                  if (activeThreadId === t.id) setActiveThreadId(null);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-rose-500 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col border border-neutral-200 dark:border-neutral-800 rounded-xl bg-white dark:bg-neutral-900 overflow-hidden">
        {/* Top Controls Bar */}
        <div className="p-3 border-b border-neutral-200 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <select
              value={activeProvider}
              onChange={(e) => setActiveProvider(e.target.value as ProviderId)}
              className="rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2 py-1 font-medium"
            >
              <option value="google">Google Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>

            <span className="text-neutral-500 font-mono">{selectedModels[activeProvider]}</span>

            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as any)}
              className="rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2 py-1"
            >
              <option value="all">All Sources ({docs.length})</option>
              <option value="type">By Source Type</option>
            </select>

            {scope === 'type' && (
              <select
                value={scopeType}
                onChange={(e) => setScopeType(e.target.value as any)}
                className="rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2 py-1"
              >
                <option value="interview">Interviews</option>
                <option value="ticket">Tickets</option>
                <option value="analytics">Analytics</option>
                <option value="competitor">Competitor</option>
              </select>
            )}

            {/* Web Search Toggle */}
            <button
              type="button"
              onClick={() => setUseWeb(!useWeb)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-medium cursor-pointer transition-colors ${
                useWeb
                  ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border-sky-300 dark:border-sky-800'
                  : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 border-neutral-300 dark:border-neutral-700'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Web Search {useWeb ? 'ON' : 'OFF'}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportMarkdown}
            title="Export conversation as Markdown"
            className="p-1.5 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 cursor-pointer"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4">
              <div className="max-w-md space-y-2">
                <h3 className="font-semibold text-neutral-800 dark:text-neutral-200 text-sm">
                  Grounded Customer RAG Chat
                </h3>
                <p className="text-xs text-neutral-500">
                  Ask questions strictly answered and cited from your documents, or enrich with web research.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg w-full text-left">
                {STARTER_PROMPTS.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => handleSend(prompt)}
                    className="p-3 text-xs rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 hover:border-indigo-400 dark:hover:border-indigo-600 transition-colors text-neutral-700 dark:text-neutral-300 cursor-pointer"
                  >
                    "{prompt}"
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => {
              const isUser = m.role === 'user';
              const hasInvalidCitations = m.citations?.some((c) => c.type === 'doc' && c.valid === false);

              return (
                <div
                  key={m.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center gap-2 mb-1 px-1 text-xs text-neutral-400 font-mono">
                    <span>{isUser ? 'You' : `${m.provider || 'AI'} · ${m.model || ''}`}</span>
                    <span>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>

                  <div
                    className={`max-w-3xl rounded-xl p-4 text-sm leading-relaxed ${
                      isUser
                        ? 'bg-indigo-600 text-white rounded-br-xs'
                        : 'bg-neutral-50 dark:bg-neutral-800/80 border border-neutral-200 dark:border-neutral-700/60 text-neutral-900 dark:text-neutral-100 rounded-bl-xs'
                    }`}
                  >
                    {isUser ? (
                      <div className="whitespace-pre-wrap">{m.content}</div>
                    ) : (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ node, ...props }) => (
                              <a {...props} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 underline font-medium" />
                            )
                          }}
                        >
                          {m.content}
                        </ReactMarkdown>

                        {/* Citation Chips */}
                        {m.citations && m.citations.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-neutral-200 dark:border-neutral-700 flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-neutral-400 mr-1 font-sans">Sources:</span>
                            {m.citations.map((c, idx) => (
                              <CitationChip
                                key={idx}
                                chunkId={c.chunkId}
                                url={c.url}
                                title={c.title}
                                valid={c.valid}
                                onClickDoc={(chunkId) =>
                                  openDrawer('source', `Source Chunk ${chunkId}`, { chunkId })
                                }
                              />
                            ))}
                          </div>
                        )}

                        {hasInvalidCitations && (
                          <div className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1 font-sans">
                            <AlertCircle className="w-3 h-3" />
                            <span>1 or more citations couldn't be verified against uploaded sources.</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Composer */}
        <div className="p-3 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-end gap-2"
          >
            <div className="flex-1 relative">
              <textarea
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, 20000))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={docs.length === 0 ? "Ask a general question (or upload sources to ground)..." : "Ask a question about your sources (Enter sends, Shift+Enter for newline)..."}
                className="w-full text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-2.5 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 text-neutral-900 dark:text-neutral-100"
              />
              <span className="absolute right-2 bottom-2 text-[10px] text-neutral-400 font-mono">
                {input.length}/20,000
              </span>
            </div>

            {isStreaming ? (
              <button
                type="button"
                onClick={handleStop}
                className="p-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white cursor-pointer transition-colors"
                title="Stop generation"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="p-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white cursor-pointer transition-colors"
                title="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};
