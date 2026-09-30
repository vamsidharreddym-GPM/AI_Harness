/**
 * Error normalization and taxonomy per Section 4.3.
 */
import { AppError, ErrorCode, ProviderId } from './types';

export function redactKeys(text: string): string {
  if (!text) return '';
  return text
    .replace(/sk-[a-zA-Z0-9_-]{20,}/g, '••••redacted••••')
    .replace(/AIzaSy[a-zA-Z0-9_-]{20,}/g, '••••redacted••••')
    .replace(/x-api-key:[^\n,]+/gi, 'x-api-key: ••••redacted••••')
    .replace(/x-goog-api-key:[^\n,]+/gi, 'x-goog-api-key: ••••redacted••••')
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer ••••redacted••••');
}

export function normalizeError(
  err: any,
  provider?: ProviderId,
  statusCode?: number,
  responseBodyText?: string
): AppError {
  const provName = provider
    ? provider === 'anthropic'
      ? 'Anthropic'
      : provider === 'openai'
      ? 'OpenAI'
      : 'Google Gemini'
    : 'Provider';

  if (err?.name === 'AbortError' || err?.message === 'ABORT') {
    return {
      code: 'ABORT',
      message: 'Request was cancelled.',
      provider
    };
  }

  const combined = redactKeys(
    `${err?.message || ''} ${responseBodyText || ''} ${statusCode || ''}`.toLowerCase()
  );

  // AUTH (401, 403, invalid api key, permission)
  if (
    statusCode === 401 ||
    statusCode === 403 ||
    combined.includes('invalid api key') ||
    combined.includes('unauthorized') ||
    combined.includes('permission denied') ||
    combined.includes('authentication')
  ) {
    return {
      code: 'AUTH',
      message: `Your ${provName} key was rejected. Check it in Settings.`,
      provider,
      suggestedAction: 'Go to Settings and verify your API key.'
    };
  }

  // QUOTA (402, or 429 with quota/billing/insufficient)
  if (
    statusCode === 402 ||
    (statusCode === 429 &&
      (combined.includes('quota') ||
        combined.includes('billing') ||
        combined.includes('insufficient_quota') ||
        combined.includes('exceeded your current quota')))
  ) {
    return {
      code: 'QUOTA',
      message: `Your ${provName} account is out of credit or quota.`,
      provider,
      suggestedAction: 'Check your billing balance on the provider dashboard.'
    };
  }

  // RATE (429 otherwise)
  if (statusCode === 429 || combined.includes('rate limit') || combined.includes('too many requests')) {
    return {
      code: 'RATE',
      message: `Rate limited by ${provName}. Wait a moment and retry.`,
      provider,
      suggestedAction: 'Wait 30-60 seconds before retrying.'
    };
  }

  // OVERLOAD (500, 502, 503, 529)
  if (
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 529 ||
    combined.includes('overloaded') ||
    combined.includes('service unavailable')
  ) {
    return {
      code: 'OVERLOAD',
      message: `${provName} is temporarily unavailable or overloaded.`,
      provider,
      suggestedAction: 'Try again in a few moments or switch models.'
    };
  }

  // CONTEXT (400 with context / too long / maximum context / token limit)
  if (
    statusCode === 400 &&
    (combined.includes('context') ||
      combined.includes('too long') ||
      combined.includes('maximum context') ||
      combined.includes('token limit') ||
      combined.includes('max_tokens') ||
      combined.includes('prompt is too long'))
  ) {
    return {
      code: 'CONTEXT',
      message: `Content is too large for the model's context window.`,
      provider,
      suggestedAction: 'Switch to a model with a larger context window or reduce document scope.'
    };
  }

  // MODEL (404 or model not found)
  if (
    statusCode === 404 ||
    combined.includes('model not found') ||
    combined.includes('does not exist') ||
    combined.includes('unknown model')
  ) {
    return {
      code: 'MODEL',
      message: `Selected model isn't available to your key or does not exist.`,
      provider,
      suggestedAction: 'Pick another model from the dropdown or enter a valid model ID.'
    };
  }

  // TIMEOUT
  if (combined.includes('timeout') || err?.name === 'TimeoutError') {
    return {
      code: 'TIMEOUT',
      message: 'Request timed out after waiting for response.',
      provider,
      suggestedAction: 'Retry the request.'
    };
  }

  // BLOCKED
  if (
    combined.includes('safety') ||
    combined.includes('blocked') ||
    combined.includes('prohibited_content')
  ) {
    return {
      code: 'BLOCKED',
      message: 'The model declined to process this content (safety filter).',
      provider,
      suggestedAction: 'Try modifying prompt input or switching to another model.'
    };
  }

  // NETWORK (TypeError, Failed to fetch, CORS)
  if (
    err instanceof TypeError ||
    combined.includes('failed to fetch') ||
    combined.includes('networkerror') ||
    combined.includes('cors')
  ) {
    return {
      code: 'NETWORK',
      message: `Couldn't reach ${provName}. Check your connection, VPN, or ad-blocker. If it persists, your browser may be blocking direct requests (CORS).`,
      provider,
      suggestedAction: 'Ensure no browser extensions or network policies block requests to the provider API.'
    };
  }

  // PARAM (other 400)
  if (statusCode === 400) {
    return {
      code: 'PARAM',
      message: `Invalid parameters sent to ${provName}: ${err?.message || 'Bad Request'}`,
      provider,
      suggestedAction: 'The system will attempt parameter fallback.'
    };
  }

  return {
    code: 'OVERLOAD',
    message: err?.message ? redactKeys(err.message) : `An unexpected error occurred with ${provName}.`,
    provider
  };
}
