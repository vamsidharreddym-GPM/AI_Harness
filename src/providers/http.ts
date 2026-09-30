/**
 * Resilient HTTP client with timeouts, retry backoff, and concurrency semaphore.
 */
import { normalizeError, redactKeys } from './errors';
import { AppError, ProviderId } from './types';

class Semaphore {
  private current = 0;
  private max = 3;
  private queue: Array<() => void> = [];

  setMax(m: number) {
    this.max = Math.max(1, m);
  }

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  release() {
    this.current--;
    if (this.queue.length > 0 && this.current < this.max) {
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

export const requestSemaphore = new Semaphore();

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  provider?: ProviderId;
  maxRetries?: number;
}

export async function resilientFetch(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  const {
    timeoutMs = 120000,
    provider,
    maxRetries = 2,
    signal: userSignal,
    ...fetchInit
  } = options;

  await requestSemaphore.acquire();

  try {
    let attempt = 0;
    while (attempt <= maxRetries) {
      const controller = new AbortController();
      let timer: any = null;

      const abortHandler = () => controller.abort();
      if (userSignal) {
        userSignal.addEventListener('abort', abortHandler);
      }

      timer = setTimeout(() => {
        controller.abort(new Error('Request timed out'));
      }, timeoutMs);

      try {
        const response = await fetch(url, {
          ...fetchInit,
          signal: controller.signal
        });

        clearTimeout(timer);
        if (userSignal) {
          userSignal.removeEventListener('abort', abortHandler);
        }

        // Handle Rate limiting (429) and Server Overload (500/502/503/529)
        if (response.status === 429 || (response.status >= 500 && response.status <= 529)) {
          // If 429 is due to quota (status 402 or explicit body indication), don't retry
          const textCopy = await response.clone().text().catch(() => '');
          const normalized = normalizeError(null, provider, response.status, textCopy);
          if (normalized.code === 'QUOTA' || normalized.code === 'AUTH') {
            throw normalized;
          }

          if (response.status === 429) {
            // Lower concurrency
            requestSemaphore.setMax(1);
          }

          if (attempt < maxRetries) {
            const retryAfter = response.headers.get('retry-after');
            let waitMs = 1000 * Math.pow(2, attempt) + Math.random() * 500;
            if (retryAfter) {
              const seconds = parseFloat(retryAfter);
              if (!isNaN(seconds)) waitMs = Math.max(waitMs, seconds * 1000);
            }
            attempt++;
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            continue;
          }
          throw normalized;
        }

        if (!response.ok) {
          const bodyText = await response.text().catch(() => '');
          throw normalizeError(new Error(bodyText), provider, response.status, bodyText);
        }

        return response;
      } catch (err: any) {
        clearTimeout(timer);
        if (userSignal) {
          userSignal.removeEventListener('abort', abortHandler);
        }

        if (userSignal?.aborted) {
          throw normalizeError(new Error('ABORT'), provider);
        }

        if (err?.code) {
          // Already normalized
          throw err;
        }

        if (attempt < maxRetries && (err?.name === 'TypeError' || err?.message?.includes('network'))) {
          attempt++;
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          continue;
        }

        throw normalizeError(err, provider);
      }
    }

    throw normalizeError(new Error('Exceeded maximum retry attempts'), provider);
  } finally {
    requestSemaphore.release();
  }
}
