import { withOpenApiContextLock } from '@runtime/context/openapi-context';
import type { DesktopChatRouteRequestDto } from '@runtime/chat';
import type { DesktopChatRouteResultDto } from '@runtime/chat';
import { resolveChatRouteByPolicy } from '@runtime/chat';
import { isDesktopChatRouteResultLike } from '@runtime/chat';
import {
  requestWithRetry,
  type RetryEvent,
  type RetryOptions,
} from '@runtime/net/request-with-retry';
import { tryParseJsonLike } from '@runtime/net/json';

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type DesktopApiClientOptions = {
  apiBaseUrl: string;
  accessToken: string;
  fetchImpl?: FetchImpl;
  retryOptions?: Partial<RetryOptions>;
  sleepImpl?: (ms: number) => Promise<void>;
  onRetryEvent?: (event: RetryEvent) => void;
};

function defaultSleepImpl(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class DesktopApiClient {
  private apiBaseUrl: string;
  private accessToken: string;
  private fetchImpl: FetchImpl;
  private sleepImpl: (ms: number) => Promise<void>;
  private onRetryEvent: ((event: RetryEvent) => void) | null;
  private retryOptions: RetryOptions;

  constructor({ apiBaseUrl, accessToken, fetchImpl, retryOptions, sleepImpl, onRetryEvent }: DesktopApiClientOptions) {
    this.apiBaseUrl = String(apiBaseUrl || '').replace(/\/$/, '');
    this.accessToken = accessToken;
    this.fetchImpl = fetchImpl || fetch;
    this.sleepImpl = sleepImpl || defaultSleepImpl;
    this.onRetryEvent = typeof onRetryEvent === 'function' ? onRetryEvent : null;
    this.retryOptions = {
      maxAttempts: 3,
      initialDelayMs: 120,
      maxDelayMs: 900,
      ...retryOptions,
    };
  }

  async withOpenApiContext<T>(task: () => Promise<T>): Promise<T> {
    const result = await withOpenApiContextLock(
      {
        apiBaseUrl: this.apiBaseUrl,
        accessToken: this.accessToken,
        fetchImpl: this.fetchImpl,
      },
      task,
    );
    const normalized = tryParseJsonLike(result);
    return (normalized === undefined ? ({} as T) : normalized) as T;
  }

  async requestWithRetry<T>(executor: () => Promise<T>, options?: Partial<RetryOptions>): Promise<T> {
    return requestWithRetry({
      executor: () => this.withOpenApiContext(executor),
      options,
      defaultOptions: this.retryOptions,
      sleepImpl: this.sleepImpl,
      onRetryEvent: this.onRetryEvent || undefined,
    });
  }

  async resolveChatRoute(input: DesktopChatRouteRequestDto): Promise<DesktopChatRouteResultDto> {
    try {
      const payload = await requestWithRetry({
        executor: async () => {
          const response = await this.fetchImpl(`${this.apiBaseUrl}/api/desktop/chat/route`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
          });

          if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(
              `desktop-chat-route-request-failed:${response.status}:${text || response.statusText}`,
            );
          }

          return tryParseJsonLike(await response.json());
        },
        defaultOptions: this.retryOptions,
        sleepImpl: this.sleepImpl,
        onRetryEvent: this.onRetryEvent || undefined,
      });

      if (!isDesktopChatRouteResultLike(payload)) {
        throw new Error('desktop-chat-route-invalid-response');
      }

      return payload;
    } catch {
      return resolveChatRouteByPolicy(input);
    }
  }
}
