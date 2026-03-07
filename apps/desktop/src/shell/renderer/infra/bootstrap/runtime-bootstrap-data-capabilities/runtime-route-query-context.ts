export type RuntimeRouteQueryContext<TContext> = TContext;

type RuntimeRouteQueryContextCache<TContext> = {
  fetchedAt: number;
  value: TContext;
};

const DEFAULT_RUNTIME_ROUTE_QUERY_CONTEXT_TTL_MS = 5_000;

let cachedRuntimeRouteQueryContext: RuntimeRouteQueryContextCache<unknown> | null = null;
let runtimeRouteQueryContextInFlight: Promise<unknown> | null = null;

export async function loadCachedRuntimeRouteQueryContext<TContext>(input: {
  load: () => Promise<TContext>;
  now?: () => number;
  ttlMs?: number;
}): Promise<TContext> {
  const now = input.now || Date.now;
  const ttlMs = input.ttlMs ?? DEFAULT_RUNTIME_ROUTE_QUERY_CONTEXT_TTL_MS;
  const cached = cachedRuntimeRouteQueryContext as RuntimeRouteQueryContextCache<TContext> | null;
  const nowMs = now();

  if (cached && (nowMs - cached.fetchedAt) < ttlMs) {
    return cached.value;
  }

  if (runtimeRouteQueryContextInFlight) {
    return runtimeRouteQueryContextInFlight as Promise<TContext>;
  }

  const task = input.load();
  runtimeRouteQueryContextInFlight = task;

  try {
    const value = await task;
    cachedRuntimeRouteQueryContext = {
      fetchedAt: nowMs,
      value,
    };
    return value;
  } finally {
    if (runtimeRouteQueryContextInFlight === task) {
      runtimeRouteQueryContextInFlight = null;
    }
  }
}

export function resetRuntimeRouteQueryContextCacheForTests(): void {
  cachedRuntimeRouteQueryContext = null;
  runtimeRouteQueryContextInFlight = null;
}
