import { createNimiLocalFirstPartyRuntimeAccountCaller } from '@nimiplatform/sdk/runtime';

export function createZhiyuElectronRuntimeAccountCaller(appId: string) {
  const normalizedAppId = requireText(appId, 'appId');
  const clientIdPrefix = normalizeClientIdPrefix(normalizedAppId);
  const runtimeAccountDeviceId = `${clientIdPrefix}-local-first-party-device`;
  return createNimiLocalFirstPartyRuntimeAccountCaller({
    appId: normalizedAppId,
    appInstanceId: `${normalizedAppId}.local-first-party`,
    deviceId: runtimeAccountDeviceId,
  });
}

export function normalizeZhiyuElectronRuntimeClientIdPrefix(value: string): string {
  return normalizeClientIdPrefix(value);
}

function normalizeClientIdPrefix(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'nimi-app';
}

function requireText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`zhiyu Electron Runtime auth requires ${field}`);
  }
  return normalized;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
