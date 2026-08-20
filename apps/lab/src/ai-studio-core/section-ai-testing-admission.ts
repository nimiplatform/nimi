import type { StudioCapabilityRegistration } from './module-registration.js';
import type { StudioCapabilityRunResult } from './runtime-types.js';
import type { StudioRunTargetSummary } from './history.js';
import type { StudioTranslate } from './non-success-presentation.js';

export type CapabilityStatus = {
  label: 'configured' | 'blocked' | 'not admitted' | 'SDK gap' | 'tauri-only' | 'checking';
  tone: 'success' | 'warning' | 'info' | 'neutral';
  detail: string;
};

export function statusForCapability(
  registration: StudioCapabilityRegistration,
  target: StudioRunTargetSummary,
  lastResult: StudioCapabilityRunResult | null,
  translate: StudioTranslate,
): CapabilityStatus {
  const capability = registration.descriptor;
  if (capability.execution === 'standalone-tauri') {
    return { label: 'tauri-only', tone: 'info', detail: target.detail };
  }
  if (capability.execution === 'typed-unavailable') {
    return { label: 'SDK gap', tone: 'warning', detail: capability.missingSurface || translate('Studio.admission.sdkGapDetail') };
  }
  if (
    lastResult?.capabilityId === capability.id
    && !lastResult.ok
    && 'reason' in lastResult
    && lastResult.reason === 'sdk-method-unavailable'
  ) {
    return { label: 'SDK gap', tone: 'warning', detail: lastResult.message };
  }
  if (target.status === 'configured') return { label: 'configured', tone: 'info', detail: target.detail };
  if (target.status === 'checking') return { label: 'checking', tone: 'neutral', detail: target.detail };
  if (target.status === 'not-admitted') return { label: 'not admitted', tone: 'info', detail: target.detail };
  if (target.status === 'sdk-gap') return { label: 'SDK gap', tone: 'warning', detail: target.detail };
  return { label: 'blocked', tone: 'warning', detail: target.detail };
}
