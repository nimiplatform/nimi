import { Realm } from '@nimiplatform/sdk/realm';
import { emitRuntimeLog, type RuntimeLogMessage } from '@runtime/telemetry/logger';

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type OpenApiContextInput = {
  apiBaseUrl: string;
  accessToken?: string;
  fetchImpl?: FetchImpl | null;
};

let contextQueue: Promise<void> = Promise.resolve();
let contextPendingCount = 0;
const CONTEXT_DEBUG_ENABLED =
  String((import.meta as { env?: Record<string, string> }).env?.VITE_NIMI_DEBUG_BOOT || '').trim() ===
  '1';

function newContextId() {
  return `realm-ctx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function emitContextLog(payload: {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: RuntimeLogMessage;
  flowId: string;
  costMs?: number;
  details?: Record<string, unknown>;
}) {
  if (payload.level === 'debug' && !CONTEXT_DEBUG_ENABLED) {
    return;
  }
  emitRuntimeLog({
    level: payload.level,
    area: 'realm-context',
    message: payload.message,
    flowId: payload.flowId,
    costMs: payload.costMs,
    details: payload.details,
  });
}

function toRealm(input: OpenApiContextInput): Realm {
  return new Realm({
    baseUrl: input.apiBaseUrl,
    auth: {
      accessToken: async () => String(input.accessToken || ''),
    },
    fetchImpl: input.fetchImpl || undefined,
  });
}

async function executeWithRealmContext<T>(
  input: OpenApiContextInput,
  task: (realm: Realm) => Promise<T>,
  scope: {
    contextId: string;
    enqueuedAt: number;
    pendingAtEnqueue: number;
  },
): Promise<T> {
  const startedAt = performance.now();
  const queueWaitMs = Number((startedAt - scope.enqueuedAt).toFixed(2));
  const contextId = scope.contextId;

  emitContextLog({
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

  const realm = toRealm(input);

  try {
    await realm.connect();
    const result = await task(realm);
    emitContextLog({
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
    emitContextLog({
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
    await realm.close();
  }
}

export async function withOpenApiContextLock<T>(
  input: OpenApiContextInput,
  task: (realm: Realm) => Promise<T>,
): Promise<T> {
  const contextId = newContextId();
  const enqueuedAt = performance.now();
  contextPendingCount += 1;

  emitContextLog({
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
    executeWithRealmContext(input, task, {
      contextId,
      enqueuedAt,
      pendingAtEnqueue: contextPendingCount,
    }),
  );

  contextQueue = current.then(
    () => {
      contextPendingCount = Math.max(0, contextPendingCount - 1);
      emitContextLog({
        level: 'debug',
        message: 'action:context-lock:dequeued',
        flowId: contextId,
        details: { pendingCount: contextPendingCount },
      });
      return undefined;
    },
    () => {
      contextPendingCount = Math.max(0, contextPendingCount - 1);
      emitContextLog({
        level: 'debug',
        message: 'action:context-lock:dequeued',
        flowId: contextId,
        details: { pendingCount: contextPendingCount },
      });
      return undefined;
    },
  );

  return current;
}
