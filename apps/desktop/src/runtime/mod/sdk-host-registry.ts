import { clearModSdkHost, setModSdkHost } from '@nimiplatform/sdk/mod';

const MOD_SDK_HOST_KEY = '__NIMI_MOD_SDK_HOST__';

export function setInternalModSdkHost(host: unknown): void {
  const globals = globalThis as Record<string, unknown>;
  const previousInternalHost = globals[MOD_SDK_HOST_KEY];
  if (previousInternalHost && previousInternalHost !== host) {
    clearModSdkHost();
  }
  globals[MOD_SDK_HOST_KEY] = host;
  setModSdkHost(host as Parameters<typeof setModSdkHost>[0]);
}

export function clearInternalModSdkHost(): void {
  delete (globalThis as Record<string, unknown>)[MOD_SDK_HOST_KEY];
  clearModSdkHost();
}
