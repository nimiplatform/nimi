import type { LanguageModelUsage } from 'ai';
import type {
  HealthResult,
  InvokeRequest,
  InvokeResponse,
  LlmStreamEvent,
  NormalizedUsage,
  ProviderAdapterConfig,
  ProviderType,
  ModelProfile,
} from '../types';

export type AdapterInvokeOptions = {
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

export interface ProviderAdapter {
  readonly type: ProviderType;
  readonly config: ProviderAdapterConfig;

  invoke(request: InvokeRequest, options?: AdapterInvokeOptions): Promise<InvokeResponse>;
  invokeStream(request: InvokeRequest, options?: AdapterInvokeOptions): AsyncIterable<LlmStreamEvent>;
  healthCheck(model?: string): Promise<HealthResult>;
  listModels(): Promise<ModelProfile[]>;
}

export function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

export function normalizeSdkUsage(usage?: LanguageModelUsage): NormalizedUsage {
  const input = usage?.inputTokens ?? 0;
  const output = usage?.outputTokens ?? 0;
  const cacheRead = usage?.inputTokenDetails?.cacheReadTokens;
  const cacheWrite = usage?.inputTokenDetails?.cacheWriteTokens;

  return {
    input,
    output,
    cacheRead: cacheRead ?? undefined,
    cacheWrite: cacheWrite ?? undefined,
    total: input + output,
  };
}

export async function fetchJson<T>(
  url: string,
  options?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  },
): Promise<T> {
  const fetchImpl = options?.fetch ?? fetch;
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: options?.headers,
    signal: options?.signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}
