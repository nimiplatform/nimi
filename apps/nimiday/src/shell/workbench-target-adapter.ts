import type { RuntimeGateProjection } from './runtime-gate.js';
import {
  clearRuntimePlatformProjection,
  getRuntimePlatformProjection,
  unavailableFromError,
} from './auth/runtime-platform.js';

export { appTitle } from './auth/runtime-platform.js';

export async function resolveTargetRuntimeGate(): Promise<RuntimeGateProjection> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status === 'ready') return { status: 'ready' };
  return { ...projection, status: 'unavailable' };
}

export function clearTargetRuntimeGate(): void {
  clearRuntimePlatformProjection();
}

export function targetRuntimeGateError(error: unknown): Extract<RuntimeGateProjection, { status: 'unavailable' }> {
  return { ...unavailableFromError(error), status: 'unavailable' };
}
