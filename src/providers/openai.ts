/**
 * OpenAI provider implementation.
 * Model filtering, parameter ladder, SSE streaming, and responses web search.
 */
import { resilientFetch } from './http';
import { Citation, GenerateRequest, GenerateResult, LLMProvider, ModelInfo } from './types';

export function filterOpenAIModels(data: any[]): ModelInfo[] {
  if (!Array.isArray(data)) return [];
  const excluded = [
    'embedding',
    'whisper',
    'tts',
    'dall-e',
    'image',
    'moderation',
    'realtime',
    'audio',
    'transcribe',
    'search-preview',
    'instruct'
  ];

  return data
    .filter((m) => {
      const id = (m?.id || '').toLowerCase();
      const isChat =
        id.startsWith('gpt-') ||
        id.startsWith('o1') ||
        id.startsWith('o3') ||
        id.startsWith('o4') ||
        id.startsWith('chatgpt-');
      if (!isChat) return false;
      return !excluded.some((ex) => id.includes(ex));
    })
    .map((m) => ({
      id: m.id,
      name: m.id,
      provider: 'openai' as const,
      supportsWeb: true
    }))
    .sort((a, b) => b.id.localeCompare(a.id));
}

export const openaiProvider: LLMProvider = {
  id: 'openai',
  name: 'OpenAI (ChatGPT)',

  async listModels(key: string): Promise<ModelInfo[]> {
    const res = await resilientFetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key.trim()}`
      },
      provider: 'openai'
    });

    const data = await res.json();
    const filtered = filterOpenAIModels(data.data || []);
    if (filtered.length === 0) {
      return [
        { id: 'gpt-4o', name: 'gpt-4o', provider: 'openai', supportsWeb: true },
        { id: 'gpt-4o-mini', name: 'gpt-4o-mini', provider: 'openai', supportsWeb: true },
        { id: 'o3-mini', name: 'o3-mini', provider: 'openai', supportsWeb: true }
      ];
    }
    return filtered;
  },

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const { key, model, system, messages, maxOutputTokens = 4096, web, signal, onToken } = req;
    const authHeader = { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' };

    // If web search is requested, try /v1/responses ladder
    if (web) {
      try {
        return await executeOpenAIWebSearch(key, model, system, messages, signal);
      } catch (err: any) {
        // Fallback: notice and continue regular chat without web
        console.warn('OpenAI web search fallback to standard generation:', err);
      }
    }

    const formattedMessages: any[] = [];
    if (system) {
      formattedMessages.push({ role: 'system', content: system });
    }
    for (const m of messages) {
      formattedMessages.push({ role: m.role, content: m.content });
    }

    const stream = !!onToken;
    let payload: any = {
      model,
      messages: formattedMessages,
      max_completion_tokens: maxOutputTokens,
      stream
    };
    if (stream) {
      payload.stream_options = { include_usage: true };
    }

    // Attempt request with parameter fallback ladder on 400
    let res: Response;
    try {
      res = await resilientFetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify(payload),
        signal,
        provider: 'openai',
        timeoutMs: stream ? 60000 : 120000
      });
    } catch (err: any) {
      if (err?.code === 'PARAM') {
        // Try fallback: remove stream_options and swap token parameter
        payload = {
          model,
          messages: formattedMessages,
          max_tokens: Math.floor(maxOutputTokens / 2),
          stream
        };
        res = await resilientFetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: authHeader,
          body: JSON.stringify(payload),
          signal,
          provider: 'openai',
          timeoutMs: stream ? 60000 : 120000
        });
      } else {
        throw err;
      }
    }

    if (stream && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let tokensIn = 0;
      let tokensOut = 0;
      let truncated = false;
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.slice(5).trim();
            if (dataStr === '[DONE]') break;
            try {
              const chunk = JSON.parse(dataStr);
              if (chunk.usage) {
                tokensIn = chunk.usage.prompt_tokens || tokensIn;
                tokensOut = chunk.usage.completion_tokens || tokensOut;
              }
              const delta = chunk.choices?.[0]?.delta?.content;
              if (delta) {
                fullText += delta;
                if (onToken) onToken(delta);
              }
              if (chunk.choices?.[0]?.finish_reason === 'length') {
                truncated = true;
              }
            } catch {
              // Ignore line parse errors in SSE stream
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      return {
        text: fullText,
        usage: { in: tokensIn || Math.ceil(fullText.length / 4), out: tokensOut || Math.ceil(fullText.length / 4) },
        citations: [],
        truncated
      };
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    const text = choice?.message?.content || '';
    const truncated = choice?.finish_reason === 'length';
    const tokensIn = data.usage?.prompt_tokens || 0;
    const tokensOut = data.usage?.completion_tokens || 0;

    return {
      text,
      usage: { in: tokensIn, out: tokensOut },
      citations: [],
      truncated
    };
  }
};

async function executeOpenAIWebSearch(
  key: string,
  model: string,
  system?: string,
  messages: any[] = [],
  signal?: AbortSignal
): Promise<GenerateResult> {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const bodyPayload: any = {
    model,
    instructions: system || 'Answer the user using accurate up-to-date web information.',
    input: lastUserMsg,
    tools: [{ type: 'web_search' }]
  };

  let res: Response;
  try {
    res = await resilientFetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
      signal,
      provider: 'openai'
    });
  } catch (err: any) {
    if (err?.code === 'PARAM') {
      // Retry with web_search_preview
      bodyPayload.tools = [{ type: 'web_search_preview' }];
      res = await resilientFetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
        signal,
        provider: 'openai'
      });
    } else {
      throw err;
    }
  }

  const data = await res.json();
  let text = '';
  const citations: Citation[] = [];

  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (Array.isArray(item.content)) {
        for (const block of item.content) {
          if (block.type === 'output_text' && block.text) {
            text += block.text;
            if (Array.isArray(block.annotations)) {
              for (const ann of block.annotations) {
                if (ann.type === 'url_citation' && ann.url) {
                  citations.push({ title: ann.title || ann.url, url: ann.url });
                }
              }
            }
          }
        }
      }
    }
  }

  return {
    text: text || data.text || '',
    usage: { in: data.usage?.input_tokens || 0, out: data.usage?.output_tokens || 0 },
    citations,
    truncated: false
  };
}
