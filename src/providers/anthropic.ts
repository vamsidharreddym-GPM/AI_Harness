/**
 * Anthropic provider implementation.
 * Browser direct access with required headers and SSE streaming.
 */
import { resilientFetch } from './http';
import { Citation, GenerateRequest, GenerateResult, LLMProvider, ModelInfo } from './types';

export const anthropicProvider: LLMProvider = {
  id: 'anthropic',
  name: 'Anthropic (Claude)',

  async listModels(key: string): Promise<ModelInfo[]> {
    const res = await resilientFetch('https://api.anthropic.com/v1/models?limit=100', {
      method: 'GET',
      headers: {
        'x-api-key': key.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      provider: 'anthropic'
    });

    const data = await res.json();
    const list: ModelInfo[] = [];
    if (data?.data && Array.isArray(data.data)) {
      for (const item of data.data) {
        if (item?.id) {
          list.push({
            id: item.id,
            name: item.display_name || item.id,
            provider: 'anthropic',
            supportsWeb: true
          });
        }
      }
    }

    if (list.length === 0) {
      // Fallback default models if list is empty
      list.push(
        { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', provider: 'anthropic', supportsWeb: true },
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic', supportsWeb: true },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', supportsWeb: true }
      );
    }

    return list;
  },

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const { key, model, system, messages, maxOutputTokens = 8192, web, signal, onToken } = req;

    const headers: Record<string, string> = {
      'x-api-key': key.trim(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json'
    };

    const formattedMessages = messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));

    // Web search in Anthropic is non-streaming
    const stream = !!onToken && !web;

    const bodyPayload: any = {
      model,
      max_tokens: maxOutputTokens,
      messages: formattedMessages,
      stream
    };

    if (system) {
      bodyPayload.system = system;
    }

    if (web) {
      bodyPayload.tools = [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 3
        }
      ];
    }

    const res = await resilientFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload),
      signal,
      provider: 'anthropic',
      timeoutMs: stream ? 60000 : 120000
    });

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
              const event = JSON.parse(dataStr);
              if (event.type === 'message_start' && event.message?.usage?.input_tokens) {
                tokensIn = event.message.usage.input_tokens;
              }
              if (event.type === 'content_block_delta' && event.delta?.text) {
                const chunk = event.delta.text;
                fullText += chunk;
                if (onToken) onToken(chunk);
              }
              if (event.type === 'message_delta') {
                if (event.usage?.output_tokens) {
                  tokensOut = event.usage.output_tokens;
                }
                if (event.delta?.stop_reason === 'max_tokens') {
                  truncated = true;
                }
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

    // Non-streaming response
    const data = await res.json();
    let text = '';
    const citations: Citation[] = [];

    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'text' && block.text) {
          text += block.text;
          if (Array.isArray(block.citations)) {
            for (const c of block.citations) {
              if (c.url) citations.push({ title: c.title || c.url, url: c.url });
            }
          }
        }
      }
    }

    const truncated = data.stop_reason === 'max_tokens';
    const tokensIn = data.usage?.input_tokens || 0;
    const tokensOut = data.usage?.output_tokens || 0;

    return {
      text,
      usage: { in: tokensIn, out: tokensOut },
      citations,
      truncated
    };
  }
};
