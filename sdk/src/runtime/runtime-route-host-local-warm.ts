import { createNimiError } from '../core/errors.js';
import { ReasonCode } from '../types/index.js';
import type { RuntimeCallOptions } from './types.js';
import {
  runtimeRouteCallTargetFromResolvedBinding,
  selectRuntimeLocalWarmCandidateFromResolvedBinding,
} from './runtime-route.js';
import type {
  RuntimeRouteExecutionCallTarget,
  RuntimeRouteLocalWarmAssetEvidence,
  RuntimeRouteLocalWarmCandidate,
  RuntimeResolvedBinding,
} from './runtime-route.js';
import type { JsonObject } from '../internal/utils.js';

export const RUNTIME_ROUTE_LOCAL_WARM_DEFAULT_TIMEOUT_MS = 60_000;
export const RUNTIME_ROUTE_LOCAL_WARM_MAX_TIMEOUT_MS = 300_000;
export const RUNTIME_ROUTE_LOCAL_WARM_PAGE_SIZE = 100;
export const RUNTIME_ROUTE_LOCAL_WARM_MAX_PAGES = 20;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export type RuntimeRouteLocalWarmCallOptionsInput = {
  targetId: string;
  timeoutMs: number;
  source: 'local';
  providerEndpoint?: string;
};

export type RuntimeRouteLocalAssetsRequest = {
  statusFilter: number;
  kindFilter: number;
  engineFilter: string;
  pageSize: number;
  pageToken: string;
};

export type RuntimeRouteLocalAssetsResponse = {
  assets?: RuntimeRouteLocalWarmAssetEvidence[];
  nextPageToken?: string;
};

export type RuntimeRouteLocalWarmCache = {
  warmedLocalModelKeys: Set<string>;
  pendingLocalWarmups: Map<string, Promise<void>>;
};

export type RuntimeRouteLocalWarmMetric =
  | {
    kind: 'counter';
    name: string;
    value?: number;
    details?: JsonObject;
  }
  | {
    kind: 'timing';
    name: string;
    durationMs: number;
    details?: JsonObject;
  };

export type RuntimeRouteLocalWarmDeps = {
  listLocalAssets: (request: RuntimeRouteLocalAssetsRequest) => Promise<RuntimeRouteLocalAssetsResponse>;
  warmLocalAsset: (
    request: { localAssetId: string; timeoutMs: number },
    options: RuntimeCallOptions,
  ) => Promise<unknown>;
  buildCallOptions: (input: RuntimeRouteLocalWarmCallOptionsInput) => Promise<RuntimeCallOptions>;
  cache?: RuntimeRouteLocalWarmCache;
  nowMs?: () => number;
  emitMetric?: (metric: RuntimeRouteLocalWarmMetric) => void;
};

export type RuntimeRouteLocalWarmInput = {
  targetId: string;
  resolvedBinding: RuntimeResolvedBinding;
  timeoutMs?: number;
  onStateChange?: (state: 'warming' | 'ready', candidate: RuntimeRouteLocalWarmCandidate) => void;
};


const defaultRuntimeRouteLocalWarmCache: RuntimeRouteLocalWarmCache = {
  warmedLocalModelKeys: new Set<string>(),
  pendingLocalWarmups: new Map<string, Promise<void>>(),
};

function defaultNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function elapsedMs(startedAt: number, now: () => number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

function resolveRuntimeRouteLocalWarmTimeoutMs(timeoutMs: number | undefined): number {
  const numeric = Math.floor(Number(timeoutMs || 0));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return RUNTIME_ROUTE_LOCAL_WARM_DEFAULT_TIMEOUT_MS;
  }
  if (numeric > RUNTIME_ROUTE_LOCAL_WARM_MAX_TIMEOUT_MS) {
    return RUNTIME_ROUTE_LOCAL_WARM_MAX_TIMEOUT_MS;
  }
  return numeric;
}

function localWarmCacheKey(candidate: RuntimeRouteLocalWarmCandidate): string {
  return [
    normalizeText(candidate.localAssetId),
    normalizeText(candidate.endpoint),
  ].join('|');
}

async function listRuntimeRouteLocalWarmAssets(
  deps: RuntimeRouteLocalWarmDeps,
  now: () => number,
): Promise<RuntimeRouteLocalWarmAssetEvidence[]> {
  const startedAt = now();
  const assets: RuntimeRouteLocalWarmAssetEvidence[] = [];
  let pages = 0;
  let pageToken = '';
  for (let index = 0; index < RUNTIME_ROUTE_LOCAL_WARM_MAX_PAGES; index += 1) {
    const response = await deps.listLocalAssets({
      statusFilter: 0,
      kindFilter: 0,
      engineFilter: '',
      pageSize: RUNTIME_ROUTE_LOCAL_WARM_PAGE_SIZE,
      pageToken,
    });
    pages += 1;
    for (const item of response.assets || []) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        assets.push(item);
      }
    }
    pageToken = normalizeText(response.nextPageToken);
    if (!pageToken) {
      break;
    }
  }
  deps.emitMetric?.({
    kind: 'counter',
    name: 'runtime_route_local_warm_list_pages_total',
    value: pages,
    details: {
      modelCount: assets.length,
      hasNextPage: Boolean(pageToken),
    },
  });
  deps.emitMetric?.({
    kind: 'timing',
    name: 'runtime.route.local_warm_list_ms',
    durationMs: elapsedMs(startedAt, now),
    details: {
      modelCount: assets.length,
      pages,
      hasNextPage: Boolean(pageToken),
    },
  });
  return assets;
}

export function createRuntimeRouteLocalWarmCache(): RuntimeRouteLocalWarmCache {
  return {
    warmedLocalModelKeys: new Set<string>(),
    pendingLocalWarmups: new Map<string, Promise<void>>(),
  };
}

export function resetRuntimeRouteLocalWarmCache(
  cache: RuntimeRouteLocalWarmCache = defaultRuntimeRouteLocalWarmCache,
): void {
  cache.warmedLocalModelKeys.clear();
  cache.pendingLocalWarmups.clear();
}

export async function ensureRuntimeRouteLocalWarmWithHost(
  input: RuntimeRouteLocalWarmInput,
  deps: RuntimeRouteLocalWarmDeps,
): Promise<void> {
  const routeTarget = runtimeRouteCallTargetFromResolvedBinding(input.resolvedBinding);
  if (routeTarget.source !== 'local') {
    return;
  }

  const cache = deps.cache || defaultRuntimeRouteLocalWarmCache;
  const now = deps.nowMs || defaultNowMs;
  const totalStartedAt = now();
  deps.emitMetric?.({
    kind: 'counter',
    name: 'runtime_route_local_warm_attempt_total',
    details: {
      route: routeTarget.source,
      modelId: routeTarget.modelId,
      engine: routeTarget.engine || '',
      hasEndpoint: Boolean(normalizeText(routeTarget.endpoint)),
    },
  });

  const cacheCheckStartedAt = now();
  const initialCandidate = selectRuntimeLocalWarmCandidateFromResolvedBinding({
    resolved: input.resolvedBinding,
    assets: await listRuntimeRouteLocalWarmAssets(deps, now),
  });
  deps.emitMetric?.({
    kind: 'timing',
    name: 'runtime.route.local_warm_cache_check_ms',
    durationMs: elapsedMs(cacheCheckStartedAt, now),
    details: {
      route: routeTarget.source,
      modelId: routeTarget.modelId,
      engine: routeTarget.engine || '',
      selectedLocalAssetId: initialCandidate?.localAssetId || null,
    },
  });
  if (!initialCandidate) {
    throw createNimiError({
      message: 'runtime local model unavailable',
      reasonCode: ReasonCode.AI_LOCAL_MODEL_UNAVAILABLE,
      actionHint: 'inspect_local_runtime_model_health',
      source: 'runtime',
    });
  }

  const initialCacheKey = localWarmCacheKey(initialCandidate);
  if (initialCandidate.status === 2 && cache.warmedLocalModelKeys.has(initialCacheKey)) {
    deps.emitMetric?.({
      kind: 'counter',
      name: 'runtime_route_local_warm_cache_hit_total',
      details: {
        modelId: routeTarget.modelId,
        localAssetId: initialCandidate.localAssetId,
        engine: initialCandidate.engine,
      },
    });
    deps.emitMetric?.({
      kind: 'timing',
      name: 'runtime.route.local_warm_total_ms',
      durationMs: elapsedMs(totalStartedAt, now),
      details: {
        modelId: routeTarget.modelId,
        localAssetId: initialCandidate.localAssetId,
        engine: initialCandidate.engine,
        cacheHit: true,
      },
    });
    return;
  }

  deps.emitMetric?.({
    kind: 'counter',
    name: 'runtime_route_local_warm_cache_miss_total',
    details: {
      modelId: routeTarget.modelId,
      localAssetId: initialCandidate.localAssetId,
      engine: initialCandidate.engine,
    },
  });

  const pending = cache.pendingLocalWarmups.get(initialCacheKey);
  if (pending) {
    await pending;
    deps.emitMetric?.({
      kind: 'timing',
      name: 'runtime.route.local_warm_total_ms',
      durationMs: elapsedMs(totalStartedAt, now),
      details: {
        modelId: routeTarget.modelId,
        localAssetId: initialCandidate.localAssetId,
        engine: initialCandidate.engine,
        pendingJoined: true,
      },
    });
    return;
  }

  const warmPromise = (async () => {
    input.onStateChange?.('warming', initialCandidate);
    const timeoutMs = resolveRuntimeRouteLocalWarmTimeoutMs(input.timeoutMs);
    const callOptions = await deps.buildCallOptions({
      targetId: input.targetId,
      timeoutMs,
      source: 'local',
      providerEndpoint: initialCandidate.endpoint,
    });
    await deps.warmLocalAsset({
      localAssetId: initialCandidate.localAssetId,
      timeoutMs,
    }, callOptions);
    const refreshedCandidate = selectRuntimeLocalWarmCandidateFromResolvedBinding({
      resolved: {
        ...input.resolvedBinding,
        localModelId: initialCandidate.localAssetId,
        goRuntimeLocalModelId: initialCandidate.localAssetId,
      },
      assets: await listRuntimeRouteLocalWarmAssets(deps, now),
    }) || initialCandidate;
    cache.warmedLocalModelKeys.add(localWarmCacheKey(refreshedCandidate));
    input.onStateChange?.('ready', refreshedCandidate);
  })().finally(() => {
    cache.pendingLocalWarmups.delete(initialCacheKey);
  });

  cache.pendingLocalWarmups.set(initialCacheKey, warmPromise);
  await warmPromise;
  deps.emitMetric?.({
    kind: 'timing',
    name: 'runtime.route.local_warm_total_ms',
    durationMs: elapsedMs(totalStartedAt, now),
    details: {
      modelId: routeTarget.modelId,
      localAssetId: initialCandidate.localAssetId,
      engine: initialCandidate.engine,
      cacheHit: false,
    },
  });
}
