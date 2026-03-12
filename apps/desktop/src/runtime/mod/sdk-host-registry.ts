const MOD_SDK_HOST_KEY = '__NIMI_MOD_SDK_HOST__';

export function setInternalModSdkHost(host: unknown): void {
  (globalThis as Record<string, unknown>)[MOD_SDK_HOST_KEY] = host;
}

export function clearInternalModSdkHost(): void {
  delete (globalThis as Record<string, unknown>)[MOD_SDK_HOST_KEY];
}
