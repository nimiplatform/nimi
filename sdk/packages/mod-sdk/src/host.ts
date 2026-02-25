import type { ModSdkHost } from './internal/host-types';

const MOD_SDK_HOST_KEY = '__NIMI_MOD_SDK_HOST__';

function readHost(): ModSdkHost | null {
  const value = (globalThis as Record<string, unknown>)[MOD_SDK_HOST_KEY];
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as ModSdkHost;
}

export function setModSdkHost(host: ModSdkHost): void {
  (globalThis as Record<string, unknown>)[MOD_SDK_HOST_KEY] = host;
}

export function clearModSdkHost(): void {
  delete (globalThis as Record<string, unknown>)[MOD_SDK_HOST_KEY];
}

export function getModSdkHost(): ModSdkHost {
  const host = readHost();
  if (host) {
    return host;
  }
  throw new Error('MOD_SDK_HOST_NOT_READY');
}
