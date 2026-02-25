import { OpenAPI } from '@nimiplatform/sdk-realm/core/OpenAPI';
import { emitRuntimeLog, type RuntimeLogMessage } from '@runtime/telemetry/logger';

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type OpenApiContextInput = {
  apiBaseUrl: string;
  accessToken?: string;
  fetchImpl?: FetchImpl | null;
};

let contextQueue: Promise<void> = Promise.resolve();
let contextPendingCount = 0;
const OPENAPI_CONTEXT_DEBUG_ENABLED =
  String((import.meta as { env?: Record<string, string> }).env?.VITE_NIMI_DEBUG_BOOT || '').trim() ===
  '1';

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.url;
  }
  return String(input || '');
}

function resolveOrigin(url: string, base?: string): string {
  const normalizedBase = String(base || '').trim() || 'http://localhost';
  try {
    return new URL(url, normalizedBase).origin;
  } catch {
    return '';
  }
}

function newOpenApiContextId() {
  return `openapi-ctx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function emitOpenApiContextLog(payload: {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: RuntimeLogMessage;
  flowId: string;
  costMs?: number;
  details?: Record<string, unknown>;
}) {
  if (payload.level === 'debug' && !OPENAPI_CONTEXT_DEBUG_ENABLED) {
    return;
  }
  emitRuntimeLog({
    level: payload.level,
    area: 'openapi-context',
    message: payload.message,
    flowId: payload.flowId,
    costMs: payload.costMs,
    details: payload.details,
  });
}

async function executeWithOpenApiContext<T>(
  input: OpenApiContextInput,
  task: () => Promise<T>,
  scope: {
    contextId: string;
    enqueuedAt: number;
    pendingAtEnqueue: number;
  },
): Promise<T> {
  const previousBase = OpenAPI.BASE;
  const previousToken = OpenAPI.TOKEN;
  const previousFetch = globalThis.fetch;
  const startedAt = performance.now();
  const queueWaitMs = Number((startedAt - scope.enqueuedAt).toFixed(2));
  const contextId = scope.contextId;
  emitOpenApiContextLog({
    level: 'info',
    message: 'action:context-execution:start',
    flowId: contextId,
    details: {
      queueWaitMs,
      pendingAtEnqueue: scope.pendingAtEnqueue,
      hasAccessToken: Boolean(String(input.accessToken || '').trim()),
      hasFetchImpl: Boolean(input.fetchImpl),
      apiBaseUrl: String(input.apiBaseUrl || ''),
    },
  });

  OpenAPI.BASE = input.apiBaseUrl;
  OpenAPI.TOKEN = input.accessToken || undefined;
  if (input.fetchImpl) {
    const apiOrigin = resolveOrigin(input.apiBaseUrl);
    const runtimeOrigin =
      typeof window !== 'undefined' && window.location
        ? window.location.origin
        : 'http://localhost';
    const contextFetch = input.fetchImpl;
    globalThis.fetch = ((requestInput: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = resolveRequestUrl(requestInput);
      const requestOrigin = resolveOrigin(requestUrl, runtimeOrigin);
      const requestScope =
        apiOrigin && requestOrigin && requestOrigin !== apiOrigin
          ? 'native-fetch'
          : 'proxy-fetch';
      const isRendererLogInvoke =
        requestOrigin.startsWith('ipc://') && /\/log_renderer_event(?:\?|$)/.test(requestUrl);

      if (!isRendererLogInvoke) {
        emitOpenApiContextLog({
          level: 'debug',
          message: 'action:fetch-route-selected',
          flowId: contextId,
          details: {
            requestScope,
            requestOrigin,
            apiOrigin,
            requestUrl,
          },
        });
      }

      // Only proxy API origin calls. Keep runtime/tooling same-origin traffic on native fetch.
      if (apiOrigin && requestOrigin && requestOrigin !== apiOrigin) {
        return previousFetch(requestInput, init);
      }
      return contextFetch(requestInput, init);
    }) as typeof fetch;
  }

  try {
    const result = await task();
    emitOpenApiContextLog({
      level: 'info',
      message: 'action:context-execution:done',
      flowId: contextId,
      costMs: Number((performance.now() - startedAt).toFixed(2)),
    });
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error || '');
    const isPermissionOrAuthError =
      /\b(401|403|unauthorized|forbidden)\b/i.test(errorMessage);
    emitOpenApiContextLog({
      level: isPermissionOrAuthError ? 'warn' : 'error',
      message: isPermissionOrAuthError
        ? 'action:context-execution:denied'
        : 'action:context-execution:failed',
      flowId: contextId,
      costMs: Number((performance.now() - startedAt).toFixed(2)),
      details: {
        error: errorMessage,
      },
    });
    throw error;
  } finally {
    OpenAPI.BASE = previousBase;
    OpenAPI.TOKEN = previousToken;
    if (input.fetchImpl) {
      globalThis.fetch = previousFetch;
    }
  }
}

export async function withOpenApiContextLock<T>(
  input: OpenApiContextInput,
  task: () => Promise<T>,
): Promise<T> {
  const contextId = newOpenApiContextId();
  const enqueuedAt = performance.now();
  contextPendingCount += 1;
  emitOpenApiContextLog({
    level: 'debug',
    message: 'action:context-lock:enqueued',
    flowId: contextId,
    details: {
      pendingCount: contextPendingCount,
      hasAccessToken: Boolean(String(input.accessToken || '').trim()),
      hasFetchImpl: Boolean(input.fetchImpl),
      apiBaseUrl: String(input.apiBaseUrl || ''),
    },
  });

  const current = contextQueue.then(() =>
    executeWithOpenApiContext(input, task, {
      contextId,
      enqueuedAt,
      pendingAtEnqueue: contextPendingCount,
    }),
  );
  contextQueue = current.then(
    () => {
      contextPendingCount = Math.max(0, contextPendingCount - 1);
      emitOpenApiContextLog({
        level: 'debug',
        message: 'action:context-lock:dequeued',
        flowId: contextId,
        details: {
          pendingCount: contextPendingCount,
        },
      });
      return undefined;
    },
    () => {
      contextPendingCount = Math.max(0, contextPendingCount - 1);
      emitOpenApiContextLog({
        level: 'debug',
        message: 'action:context-lock:dequeued',
        flowId: contextId,
        details: {
          pendingCount: contextPendingCount,
        },
      });
      return undefined;
    },
  );
  return current;
}
