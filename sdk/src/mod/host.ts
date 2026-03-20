import { createNimiError } from '../runtime/errors.js';
import { ReasonCode } from '../types/index.js';
import type { ModSdkHost } from './internal/host-types';

const MOD_SDK_HOST_KEY = Symbol.for('nimi.mod.sdk.host');

function readHost(): ModSdkHost | null {
  const value = (globalThis as Record<PropertyKey, unknown>)[MOD_SDK_HOST_KEY];
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as ModSdkHost;
}

export function setModSdkHost(host: ModSdkHost): void {
  const current = readHost();
  if (current && current !== host) {
    throw createNimiError({
      message: 'mod SDK host is already initialized for this execution context',
      reasonCode: ReasonCode.SDK_MOD_HOST_MISSING,
      actionHint: 'avoid_overwriting_existing_mod_host',
      source: 'sdk',
    });
  }
  (globalThis as Record<PropertyKey, unknown>)[MOD_SDK_HOST_KEY] = Object.freeze(host);
}

export function clearModSdkHost(): void {
  delete (globalThis as Record<PropertyKey, unknown>)[MOD_SDK_HOST_KEY];
}

export function getModSdkHost(): ModSdkHost {
  const host = readHost();
  if (host) {
    return host;
  }
  throw createNimiError({
    message: 'mod SDK host is not ready',
    reasonCode: ReasonCode.SDK_MOD_HOST_MISSING,
    actionHint: 'ensure_mod_host_initialized',
    source: 'sdk',
  });
}
