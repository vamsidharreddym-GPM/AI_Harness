/**
 * Google Gemini provider implementation.
 * REST v1beta direct browser access with header x-goog-api-key and grounding citations.
 */
import { resilientFetch } from './http';
import { Citation, GenerateRequest, GenerateResult, LLMProvider, ModelInfo } from './types';

export function filterGeminiModels(data: any[]): ModelInfo[] {
  if (!Array.isArray(data)) return [];
  const excluded = ['embedding', 'imagen', 'veo', 'tts', 'aqa'];

  return data
    .filter((m) => {
      const id = (m?.name || '').replace(/^models\//, '').toLowerCase();
      const methods: string[] = m?.supportedGenerationMethods || [];
      if (!methods.includes('generateContent')) return false;
      return !excluded.some((ex) => id.includes(ex));
    })
    .map((m) => {
      const cleanId = (m.name || '').replace(/^models\//, '');
      return {
        id: cleanId,
        name: m.displayName || cleanId,
        provider: 'google' as const,
        supportsWeb: true
      };
    })
    .sort((a, b) => b.id.localeCompare(a.id));
}

export const googleProvider: LLMProvider = {
  id: 'google',
  name: 'Google (Gemini)',

  async listModels(key: string): Promise<ModelInfo[]> {
    const res = await resilientFetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
      method: 'GET',
      headers: {
        'x-goog-api-key': key.trim()
      },
      provider: 'google'
    });

    const data = await res.json();
    const filtered = filterGeminiModels(data.models || []);
    if (filtered.length === 0) {
      return [
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google', supportsWeb: true },
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google', supportsWeb: true },
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google', supportsWeb: true }
      ];
    }
    return filtered;
  },

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const { key, model, system, messages, maxOutputTokens = 8192, json, web, signal, onToken } = req;
    const cleanModel = model.replace(/^models\//, '');

    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const generationConfig: any = {
      maxOutputTokens
    };

    // Note: Do not use responseMimeType: 'application/json' together with google_search
    if (json && !web) {
      generationConfig.responseMimeType = 'application/json';
    }

    const payload: any = {
      contents,
      generationConfig
    };

    if (system) {
      payload.systemInstruction = {
        parts: [{ text: system }]
      };
    }

    if (web) {
      payload.tools = [{ google_search: {} }];
    }

    const stream = !!onToken && !web;
    const endpoint = stream
      ? `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:streamGenerateContent?alt=sse`
      : `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent`;

    let res: Response;
    try {
      res = await resilientFetch(endpoint, {
        method: 'POST',
        headers: {
          'x-goog-api-key': key.trim(),
          'content-type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal,
        provider: 'google',
        timeoutMs: stream ? 60000 : 120000
      });
    } catch (err: any) {
      // If web search returned 400, retry with camelCase googleSearch
      if (web && err?.code === 'PARAM') {
        payload.tools = [{ googleSearch: {} }];
        res = await resilientFetch(endpoint, {
          method: 'POST',
          headers: {
            'x-goog-api-key': key.trim(),
            'content-type': 'application/json'
          },
          body: JSON.stringify(payload),
          signal,
          provider: 'google',
          timeoutMs: 120000
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
      let blocked: string | undefined;
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
              if (chunk.promptFeedback?.blockReason) {
                blocked = chunk.promptFeedback.blockReason;
              }
              const candidate = chunk.candidates?.[0];
              if (candidate?.finishReason === 'MAX_TOKENS') {
                truncated = true;
              }
              if (candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'PROHIBITED_CONTENT') {
                blocked = candidate.finishReason;
              }
              const textPiece = candidate?.content?.parts?.[0]?.text;
              if (textPiece) {
                fullText += textPiece;
                if (onToken) onToken(textPiece);
              }
              if (chunk.usageMetadata) {
                tokensIn = chunk.usageMetadata.promptTokenCount || tokensIn;
                tokensOut = chunk.usageMetadata.candidatesTokenCount || tokensOut;
              }
            } catch {
              // Ignore line parse errors in SSE
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
        truncated,
        blocked
      };
    }

    // Non-streaming response
    const data = await res.json();
    let text = '';
    const citations: Citation[] = [];
    let truncated = false;
    let blocked: string | undefined;

    if (data.promptFeedback?.blockReason) {
      blocked = data.promptFeedback.blockReason;
    }

    const candidate = data.candidates?.[0];
    if (candidate) {
      if (candidate.finishReason === 'MAX_TOKENS') {
        truncated = true;
      }
      if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT') {
        blocked = candidate.finishReason;
      }
      if (Array.isArray(candidate.content?.parts)) {
        for (const part of candidate.content.parts) {
          if (part.text) text += part.text;
        }
      }
      const groundingChunks = candidate.groundingMetadata?.groundingChunks;
      if (Array.isArray(groundingChunks)) {
        for (const chunk of groundingChunks) {
          if (chunk.web?.uri) {
            citations.push({
              title: chunk.web.title || chunk.web.uri,
              url: chunk.web.uri
            });
          }
        }
      }
    }

    const tokensIn = data.usageMetadata?.promptTokenCount || 0;
    const tokensOut = data.usageMetadata?.candidatesTokenCount || 0;

    return {
      text,
      usage: { in: tokensIn, out: tokensOut },
      citations,
      truncated,
      blocked
    };
  }
};
