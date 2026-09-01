import type {
  WorkbenchRuntimeGateCopy,
  WorkbenchRuntimeGateProjection,
} from '../workbench-core/index.js';
import {
  appTitle,
  clearRuntimePlatformProjection,
  getRuntimePlatformProjection,
} from './auth/runtime-platform.js';

export { appTitle };

export const targetRuntimeGateCopy: WorkbenchRuntimeGateCopy = Object.freeze({
  checking: 'App-host check',
  setupRequired: 'Action required',
  signInRequired: 'Sign in to Nimi',
  connectionRequired: 'Runtime session unavailable',
  retry: 'Retry Runtime check',
  offlineTier: (tier) => `Offline tier: ${tier}`,
  nextAction: (action) => `Next action: ${action}`,
});

export async function resolveTargetRuntimeGate(): Promise<WorkbenchRuntimeGateProjection> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status === 'ready') return { status: 'ready' };
  return {
    status: 'unavailable',
    body: projection.message || 'Runtime session projection is not ready.',
    signInRequired: projection.reasonCode === 'runtime-unauthenticated',
    nextAction: projection.actionHint,
  };
}

export function clearTargetRuntimeGate(): void {
  clearRuntimePlatformProjection();
}

export function targetRuntimeGateErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'App-host check failed');
}
