import type { RuntimeDurableTargetRef } from '@nimiplatform/sdk/runtime';
import { toRuntimeDurableTargetRef } from '@nimiplatform/sdk/ai';
import {
  buildNimiRuntimeScenarioJobHead,
  buildNimiRuntimeScenarioJobIdentity,
} from '@nimiplatform/sdk/features/generation';
import type { ResolvedLLMBinding } from './tester-runtime-invokers-core.js';
import { buildMetadata } from './tester-runtime-invokers-core.js';

export const TESTER_APP_ID = 'nimi.tester';

export function runtimeJobHead(resolved: ResolvedLLMBinding, subjectUserId: string): {
  appId: string;
  subjectUserId: string;
  modelId: string;
  routePolicy: 'local' | 'cloud' | 'unspecified';
  connectorId?: string;
  targetRef: RuntimeDurableTargetRef;
  timeoutMs: number;
} {
  return buildNimiRuntimeScenarioJobHead({
    appId: TESTER_APP_ID,
    subjectUserId,
    modelId: resolved.model,
    routePolicy: resolved.routePolicy,
    ...(resolved.connectorId ? { connectorId: resolved.connectorId } : {}),
    targetRef: toRuntimeDurableTargetRef(resolved.targetRef),
    timeoutMs: 120_000,
  });
}

export function runtimeJobIdentity(capabilityId: string, scenarioId: string): {
  requestId: string;
  idempotencyKey: string;
} {
  return buildNimiRuntimeScenarioJobIdentity({ appId: TESTER_APP_ID, capabilityId, scenarioId });
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
