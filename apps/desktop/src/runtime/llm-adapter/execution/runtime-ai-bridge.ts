import { getPlatformClient } from '@nimiplatform/sdk';
import type { InferenceRouteSource } from './inference-audit';
import { createNimiError } from '@nimiplatform/sdk/runtime';
import {
  createRuntimeRouteLocalWarmCache,
  ensureRuntimeRouteLocalWarmWithHost,
  resetRuntimeRouteLocalWarmCache,
  type RuntimeResolvedBinding,
  type RuntimeRouteLocalWarmCandidate,
  type RuntimeRouteLocalWarmMetric,
} from '@nimiplatform/sdk/ai';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { emitRuntimeLog } from '../../telemetry/logger';

const runtimeRouteLocalWarmCache = createRuntimeRouteLocalWarmCache();

type EnsureRuntimeLocalModelWarmInput = {
  targetId: string;
  resolvedBinding: RuntimeResolvedBinding;
  timeoutMs?: number;
  onStateChange?: (state: 'warming' | 'ready', candidate: RuntimeRouteLocalWarmCandidate) => void;
};

export function createRuntimeTraceId(prefix = 'runtime-call'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function emitDesktopRuntimeRouteWarmMetric(metric: RuntimeRouteLocalWarmMetric): void {
  if (metric.kind === 'timing') {
    emitRuntimeLog({
      level: 'info',
      area: 'desktop-runtime-agent-latency',
      message: `phase:desktop.${metric.name}`,
      costMs: metric.durationMs,
      details: {
        stage: metric.name,
        ...(metric.details || {}),
      },
    });
    return;
  }
  emitRuntimeLog({
    level: 'info',
    area: 'desktop-runtime-agent-latency',
    message: `action:desktop_${metric.name}`,
    details: {
      counter: `desktop_${metric.name}`,
      value: metric.value ?? 1,
      ...(metric.details || {}),
    },
  });
}

export function resetRuntimeLocalModelWarmCacheForTests(): void {
  resetRuntimeRouteLocalWarmCache(runtimeRouteLocalWarmCache);
}

export async function ensureRuntimeLocalModelWarm(input: EnsureRuntimeLocalModelWarmInput): Promise<void> {
  const runtime = getRuntimeClient();
  await ensureRuntimeRouteLocalWarmWithHost(input, {
    cache: runtimeRouteLocalWarmCache,
    listLocalAssets: (request) => runtime.local.listLocalAssets(request),
    warmLocalAsset: (request, options) => runtime.local.warmLocalAsset(request, options),
    buildCallOptions: buildRuntimeCallOptions,
    emitMetric: emitDesktopRuntimeRouteWarmMetric,
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
  extractRuntimeReasonCode,
  toLocalRuntimeReasonCode,
} from './runtime-ai-bridge-output';
