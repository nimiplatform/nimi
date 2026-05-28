import { getPlatformClient } from '@nimiplatform/sdk';
import type { InferenceRouteSource } from './inference-audit';
import { createNimiError } from '@nimiplatform/sdk/runtime';
import {
  runtimeRouteCallTargetFromResolvedBinding,
  selectRuntimeLocalWarmCandidateFromResolvedBinding,
  type RuntimeResolvedBinding,
  type RuntimeRouteLocalWarmAssetEvidence,
  type RuntimeRouteLocalWarmCandidate,
} from '@nimiplatform/sdk/ai';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { emitRuntimeLog } from '../../telemetry/logger';

const DEFAULT_LOCAL_WARM_TIMEOUT_MS = 60_000;
const MAX_LOCAL_WARM_TIMEOUT_MS = 300_000;
const LOCAL_WARM_PAGE_SIZE = 100;
const LOCAL_WARM_MAX_PAGES = 20;

const warmedLocalModelKeys = new Set<string>();
const pendingLocalWarmups = new Map<string, Promise<void>>();

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(nowMs() - startedAt));
}

function logDesktopRuntimeAgentTiming(input: {
  stage: string;
  startedAt: number;
  details?: Record<string, unknown>;
}): void {
  emitRuntimeLog({
    level: 'info',
    area: 'desktop-runtime-agent-latency',
    message: `phase:${input.stage}`,
    costMs: elapsedMs(input.startedAt),
    details: {
      stage: input.stage,
      ...(input.details || {}),
    },
  });
}

function logDesktopRuntimeAgentCounter(input: {
  counter: string;
  value?: number;
  details?: Record<string, unknown>;
}): void {
  emitRuntimeLog({
    level: 'info',
    area: 'desktop-runtime-agent-latency',
    message: `action:${input.counter}`,
    details: {
      counter: input.counter,
      value: input.value ?? 1,
      ...(input.details || {}),
    },
  });
}

type EnsureRuntimeLocalModelWarmInput = {
  targetId: string;
  resolvedBinding: RuntimeResolvedBinding;
  timeoutMs?: number;
  onStateChange?: (state: 'warming' | 'ready', candidate: RuntimeRouteLocalWarmCandidate) => void;
};

export function createRuntimeTraceId(prefix = 'runtime-call'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveWarmTimeoutMs(timeoutMs: number | undefined): number {
  const numeric = Math.floor(Number(timeoutMs || 0));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_LOCAL_WARM_TIMEOUT_MS;
  }
  if (numeric > MAX_LOCAL_WARM_TIMEOUT_MS) {
    return MAX_LOCAL_WARM_TIMEOUT_MS;
  }
  return numeric;
}

function localWarmCacheKey(candidate: RuntimeRouteLocalWarmCandidate): string {
  return [
    String(candidate.localAssetId || '').trim(),
    String(candidate.endpoint || '').trim(),
  ].join('|');
}

async function listAllRuntimeLocalModels(): Promise<RuntimeRouteLocalWarmAssetEvidence[]> {
  const startedAt = nowMs();
  const runtime = getRuntimeClient();
  const models: RuntimeRouteLocalWarmAssetEvidence[] = [];
  let pages = 0;
  let pageToken = '';
  for (let index = 0; index < LOCAL_WARM_MAX_PAGES; index += 1) {
    const response = await runtime.local.listLocalAssets({
      statusFilter: 0,
      kindFilter: 0,
      engineFilter: '',
      pageSize: LOCAL_WARM_PAGE_SIZE,
      pageToken,
    });
    pages += 1;
    for (const model of response.assets || []) {
      if (model && typeof model === 'object' && !Array.isArray(model)) {
        models.push(model as RuntimeRouteLocalWarmAssetEvidence);
      }
    }
    pageToken = String(response.nextPageToken || '').trim();
    if (!pageToken) {
      break;
    }
  }
  logDesktopRuntimeAgentCounter({
    counter: 'desktop_runtime_agent_local_warm_list_pages_total',
    value: pages,
    details: {
      modelCount: models.length,
      hasNextPage: Boolean(pageToken),
    },
  });
  logDesktopRuntimeAgentTiming({
    stage: 'desktop.runtime_agent.local_warm_list_ms',
    startedAt,
    details: {
      modelCount: models.length,
      pages,
      hasNextPage: Boolean(pageToken),
    },
  });
  return models;
}

export function resetRuntimeLocalModelWarmCacheForTests(): void {
  warmedLocalModelKeys.clear();
  pendingLocalWarmups.clear();
}

export async function ensureRuntimeLocalModelWarm(input: EnsureRuntimeLocalModelWarmInput): Promise<void> {
  const routeTarget = runtimeRouteCallTargetFromResolvedBinding(input.resolvedBinding);
  if (routeTarget.source !== 'local') {
    return;
  }
  const totalStartedAt = nowMs();
  logDesktopRuntimeAgentCounter({
    counter: 'desktop_runtime_agent_local_warm_attempt_total',
    details: {
      route: routeTarget.source,
      modelId: routeTarget.modelId,
      engine: routeTarget.engine || '',
      hasEndpoint: Boolean(String(routeTarget.endpoint || '').trim()),
    },
  });

  const cacheCheckStartedAt = nowMs();
  const initialCandidate = selectRuntimeLocalWarmCandidateFromResolvedBinding({
    resolved: input.resolvedBinding,
    assets: await listAllRuntimeLocalModels(),
  });
  logDesktopRuntimeAgentTiming({
    stage: 'desktop.runtime_agent.local_warm_cache_check_ms',
    startedAt: cacheCheckStartedAt,
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
  if (initialCandidate.status === 2 && warmedLocalModelKeys.has(initialCacheKey)) {
    logDesktopRuntimeAgentCounter({
      counter: 'desktop_runtime_agent_local_warm_cache_hit_total',
      details: {
        modelId: routeTarget.modelId,
        localAssetId: initialCandidate.localAssetId,
        engine: initialCandidate.engine,
      },
    });
    logDesktopRuntimeAgentTiming({
      stage: 'desktop.runtime_agent.local_warm_total_ms',
      startedAt: totalStartedAt,
      details: {
        modelId: routeTarget.modelId,
        localAssetId: initialCandidate.localAssetId,
        engine: initialCandidate.engine,
        cacheHit: true,
      },
    });
    return;
  }
  logDesktopRuntimeAgentCounter({
    counter: 'desktop_runtime_agent_local_warm_cache_miss_total',
    details: {
      modelId: routeTarget.modelId,
      localAssetId: initialCandidate.localAssetId,
      engine: initialCandidate.engine,
    },
  });

  const pending = pendingLocalWarmups.get(initialCacheKey);
  if (pending) {
    await pending;
    logDesktopRuntimeAgentTiming({
      stage: 'desktop.runtime_agent.local_warm_total_ms',
      startedAt: totalStartedAt,
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
    const timeoutMs = resolveWarmTimeoutMs(input.timeoutMs);
    const callOptions = await buildRuntimeCallOptions({
      targetId: input.targetId,
      timeoutMs,
      source: 'local',
      providerEndpoint: initialCandidate.endpoint,
    });
    await getRuntimeClient().local.warmLocalAsset({
      localAssetId: initialCandidate.localAssetId,
      timeoutMs,
    }, callOptions);
    const refreshedCandidate = selectRuntimeLocalWarmCandidateFromResolvedBinding({
      resolved: {
        ...input.resolvedBinding,
        localModelId: initialCandidate.localAssetId,
        goRuntimeLocalModelId: initialCandidate.localAssetId,
      },
      assets: await listAllRuntimeLocalModels(),
    }) || initialCandidate;
    warmedLocalModelKeys.add(localWarmCacheKey(refreshedCandidate));
    input.onStateChange?.('ready', refreshedCandidate);
  })().finally(() => {
    pendingLocalWarmups.delete(initialCacheKey);
  });

  pendingLocalWarmups.set(initialCacheKey, warmPromise);
  await warmPromise;
  logDesktopRuntimeAgentTiming({
    stage: 'desktop.runtime_agent.local_warm_total_ms',
    startedAt: totalStartedAt,
    details: {
      modelId: routeTarget.modelId,
      localAssetId: initialCandidate.localAssetId,
      engine: initialCandidate.engine,
      cacheHit: false,
    },
  });
}

export function getRuntimeClient() {
  const runtime = getPlatformClient().runtime;
  if (!runtime) {
    throw createNimiError({
      message: 'runtime sdk client unavailable',
      reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      actionHint: 'check_runtime_client_bootstrap',
      source: 'runtime',
    });
  }
  return runtime;
}

function resolveCaller(targetId: string): {
  callerKind: 'desktop-core';
  callerId: string;
} {
  const normalized = String(targetId || '').trim();
  return {
    callerKind: 'desktop-core',
    callerId: normalized ? `target:${normalized}` : 'target:unknown',
  };
}

export async function buildRuntimeRequestMetadata(input: {
  source: InferenceRouteSource;
  connectorId?: string;
  providerEndpoint?: string;
}): Promise<Record<string, string>> {
  const traceId = createRuntimeTraceId();
  const metadata: Record<string, string> = {
    traceId,
    'x-nimi-trace-id': traceId,
  };
  if (String(input.connectorId || '').trim()) {
    metadata.keySource = 'managed';
  }
  return metadata;
}

export async function buildRuntimeCallOptions(input: {
  targetId: string;
  timeoutMs: number;
  source: InferenceRouteSource;
  connectorId?: string;
  providerEndpoint?: string;
}): Promise<{
  idempotencyKey: string;
  timeoutMs: number;
  metadata: {
    traceId: string;
    callerKind: 'desktop-core';
    callerId: string;
    surfaceId: string;
    keySource?: 'managed';
  };
}> {
  const caller = resolveCaller(input.targetId);
  const traceId = createRuntimeTraceId();
  const idempotencyKey = createRuntimeTraceId('runtime-idem');
  return {
    idempotencyKey,
    timeoutMs: input.timeoutMs,
    metadata: {
      traceId,
      callerKind: caller.callerKind,
      callerId: caller.callerId,
      surfaceId: 'desktop.renderer',
      ...(String(input.connectorId || '').trim() ? { keySource: 'managed' as const } : {}),
    },
  };
}

export async function buildRuntimeStreamOptions(
  input: {
    targetId: string;
    timeoutMs: number;
    signal?: AbortSignal;
    source: InferenceRouteSource;
    connectorId?: string;
    providerEndpoint?: string;
  },
): Promise<{
  idempotencyKey: string;
  timeoutMs: number;
  signal?: AbortSignal;
  metadata: {
    traceId: string;
    callerKind: 'desktop-core';
    callerId: string;
    surfaceId: string;
    keySource?: 'managed';
  };
}> {
  const caller = resolveCaller(input.targetId);
  const traceId = createRuntimeTraceId();
  const idempotencyKey = createRuntimeTraceId('runtime-idem');
  return {
    idempotencyKey,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
    metadata: {
      traceId,
      callerKind: caller.callerKind,
      callerId: caller.callerId,
      surfaceId: 'desktop.renderer',
      ...(String(input.connectorId || '').trim() ? { keySource: 'managed' as const } : {}),
    },
  };
}

export {
  asRuntimeInvokeError,
  base64FromBytes,
  extractEmbeddings,
  extractRuntimeReasonCode,
  extractTextFromGenerateOutput,
  resolveTranscribeAudio,
  toLocalRuntimeReasonCode,
  type DesktopScenarioOutput,
  type FetchImpl,
} from './runtime-ai-bridge-output';
