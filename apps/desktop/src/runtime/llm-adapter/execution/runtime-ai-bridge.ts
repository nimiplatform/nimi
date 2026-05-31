import { getPlatformClient } from '@nimiplatform/sdk';
import type { InferenceRouteSource } from './inference-audit';
import { createNimiError } from '@nimiplatform/sdk/runtime';
import {
  buildRuntimeRequestMetadata as buildSdkRuntimeRequestMetadata,
  buildRuntimeTargetCallOptions,
  createRuntimeRouteLocalWarmCache,
  ensureRuntimeRouteLocalWarmWithHost,
  resetRuntimeRouteLocalWarmCache,
  type RuntimeResolvedBinding,
  type RuntimeRouteLocalWarmCandidate,
  type RuntimeRouteLocalWarmMetric,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { emitRuntimeLog } from '../../telemetry/logger';

const runtimeRouteLocalWarmCache = createRuntimeRouteLocalWarmCache();

type EnsureRuntimeLocalModelWarmInput = {
  targetId: string;
  resolvedBinding: RuntimeResolvedBinding;
  timeoutMs?: number;
  onStateChange?: (state: 'warming' | 'ready', candidate: RuntimeRouteLocalWarmCandidate) => void;
};

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
  return buildSdkRuntimeRequestMetadata({
    connectorId: input.connectorId,
  });
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
  const options = buildRuntimeTargetCallOptions({
    targetId: input.targetId,
    timeoutMs: input.timeoutMs,
    callerKind: caller.callerKind,
    surfaceId: 'desktop.renderer',
    connectorId: input.connectorId,
  });
  return options as Awaited<ReturnType<typeof buildRuntimeCallOptions>>;
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
  const options = buildRuntimeTargetCallOptions({
    targetId: input.targetId,
    timeoutMs: input.timeoutMs,
    callerKind: caller.callerKind,
    surfaceId: 'desktop.renderer',
    connectorId: input.connectorId,
    signal: input.signal,
  });
  return options as Awaited<ReturnType<typeof buildRuntimeStreamOptions>>;
}

export {
  extractRuntimeReasonCode,
  toLocalRuntimeReasonCode,
} from './runtime-ai-bridge-output';
