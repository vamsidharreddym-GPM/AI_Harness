/**
 * Provider interfaces, models, and error types.
 */

export type ProviderId = 'anthropic' | 'openai' | 'google';

export interface ModelInfo {
  id: string;
  name: string;
  provider: ProviderId;
  supportsWeb?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Citation {
  title: string;
  url: string;
}

export interface GenerateRequest {
  key: string;
  model: string;
  system?: string;
  messages: ChatMessage[];
  json?: boolean;
  maxOutputTokens?: number;
  web?: boolean;
  signal?: AbortSignal;
  onToken?: (token: string) => void;
}

export interface GenerateResult {
  text: string;
  usage: {
    in: number;
    out: number;
  };
  citations: Citation[];
  truncated: boolean;
  blocked?: string;
}

export type ErrorCode =
  | 'AUTH'
  | 'QUOTA'
  | 'RATE'
  | 'OVERLOAD'
  | 'CONTEXT'
  | 'PARAM'
  | 'MODEL'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'TRUNCATED'
  | 'BLOCKED'
  | 'EMPTY'
  | 'BADJSON'
  | 'ABORT';

export interface AppError {
  code: ErrorCode;
  message: string;
  provider?: ProviderId;
  suggestedAction?: string;
  rawDetails?: string;
}

export interface LLMProvider {
  id: ProviderId;
  name: string;
  listModels(key: string): Promise<ModelInfo[]>;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}
