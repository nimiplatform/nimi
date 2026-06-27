import type { RuntimeDurableTargetRef } from '@nimiplatform/sdk/runtime';
import { toRuntimeDurableTargetRef } from '@nimiplatform/sdk/ai';
import type { ResolvedLLMBinding } from './tester-runtime-invokers-core.js';
import { buildMetadata } from './tester-runtime-invokers-core.js';

export const TESTER_APP_ID = 'nimi.tester';

function runtimeRoutePolicy(resolved: ResolvedLLMBinding): 'local' | 'cloud' | 'unspecified' {
  if (resolved.routePolicy === 'local' || resolved.routePolicy === 'cloud') {
    return resolved.routePolicy;
  }
  return 'unspecified';
}

export function runtimeJobHead(resolved: ResolvedLLMBinding, subjectUserId: string): {
  appId: string;
  subjectUserId: string;
  modelId: string;
  routePolicy: 'local' | 'cloud' | 'unspecified';
  connectorId?: string;
  targetRef: RuntimeDurableTargetRef;
  timeoutMs: number;
} {
  return {
    appId: TESTER_APP_ID,
    subjectUserId,
    modelId: resolved.model,
    routePolicy: runtimeRoutePolicy(resolved),
    ...(resolved.connectorId ? { connectorId: resolved.connectorId } : {}),
    targetRef: toRuntimeDurableTargetRef(resolved.targetRef),
    timeoutMs: 120_000,
  };
}

function stableIdPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
}

export function runtimeJobIdentity(capabilityId: string, scenarioId: string): {
  requestId: string;
  idempotencyKey: string;
} {
  const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const prefix = `nimi.tester:${capabilityId}:${stableIdPart(scenarioId)}`;
  return {
    requestId: `${prefix}:${nonce}`,
    idempotencyKey: `${prefix}:${nonce}`,
  };
}

function runtimeCallTimeoutError(capabilityId: string, timeoutMs: number): Error {
  const error = new Error(`${capabilityId} Runtime call timed out after ${timeoutMs}ms; the Runtime request did not complete before the configured client deadline.`);
  error.name = 'RuntimeCallTimeoutError';
  return error;
}

export async function withRuntimeClientTimeout<T>(
  capabilityId: string,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const normalizedTimeoutMs = Math.floor(Number(timeoutMs));
  if (!Number.isFinite(normalizedTimeoutMs) || normalizedTimeoutMs <= 0) {
    const controller = new AbortController();
    return run(controller.signal);
  }
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => {
      reject(runtimeCallTimeoutError(capabilityId, normalizedTimeoutMs));
      controller.abort();
    }, normalizedTimeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function runtimeLabels(
  surfaceId: string,
  resolved: ResolvedLLMBinding,
  evidenceMetadata: Record<string, string>,
): Record<string, string> {
  return buildMetadata(surfaceId, {
    ...resolved.metadata,
    ...evidenceMetadata,
  });
}
