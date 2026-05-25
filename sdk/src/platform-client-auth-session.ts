import { asRecord, normalizeText } from './internal/utils.js';
import { createNimiError } from './runtime/errors.js';
import { Runtime } from './runtime/runtime.js';
import { ReasonCode } from './types/index.js';

export const DEFAULT_PLATFORM_APP_ID = 'nimi.app';
export const PLATFORM_RUNTIME_SESSION_APP_INSTANCE_SUFFIX = '.platform-runtime-session';
export const PLATFORM_RUNTIME_SESSION_DEVICE_ID = 'platform-runtime-session';
export const PLATFORM_RUNTIME_SESSION_TTL_SECONDS = 3600;
export const PLATFORM_RUNTIME_SESSION_REFRESH_SKEW_MS = 30_000;

function readProcessEnv(name: string): string {
  if (typeof process === 'undefined' || typeof process.env === 'undefined') {
    return '';
  }
  return normalizeText(process.env[name]);
}

export function resolvePlatformRealmBaseUrl(explicitBaseUrl: string | undefined): string {
  const normalizedExplicitBaseUrl = normalizeText(explicitBaseUrl);
  if (normalizedExplicitBaseUrl) {
    return normalizedExplicitBaseUrl;
  }

  const envBaseUrl = readProcessEnv('VITE_NIMI_REALM_BASE_URL') || readProcessEnv('NIMI_REALM_URL');
  if (envBaseUrl) {
    return envBaseUrl;
  }

  const locationOrigin = normalizeText((globalThis as { location?: { origin?: string } }).location?.origin);
  if (locationOrigin && /^https?:\/\//.test(locationOrigin)) {
    return locationOrigin;
  }

  throw createNimiError({
    message: 'platform client requires realmBaseUrl, NIMI_REALM_URL, or a browser location origin',
    reasonCode: ReasonCode.SDK_REALM_ENDPOINT_REQUIRED,
    actionHint: 'set_platform_realm_base_url',
    source: 'sdk',
  });
}

function decodeBase64UrlUtf8(input: string): string {
  const normalized = normalizeText(input).replace(/-/g, '+').replace(/_/g, '/');
  if (!normalized) {
    return '';
  }
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const padded = `${normalized}${'='.repeat(paddingLength)}`;

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(padded, 'base64').toString('utf8');
  }
  if (typeof atob === 'function') {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8').decode(bytes);
    }
    return String.fromCharCode(...bytes);
  }
  return '';
}

export async function resolveToken(
  explicit: string | undefined,
  provider: (() => string | Promise<string>) | undefined,
  storeProvider: (() => string | Promise<string>) | undefined,
): Promise<string> {
  if (storeProvider) {
    const value = normalizeText(await storeProvider());
    if (value) return value;
  }
  if (provider) {
    const value = normalizeText(await provider());
    if (value) return value;
  }
  return normalizeText(explicit);
}

function decodeJwtExpiry(accessToken: string): number | null {
  const normalizedToken = normalizeText(accessToken);
  if (!normalizedToken) {
    return null;
  }
  const rawToken = normalizedToken.toLowerCase().startsWith('bearer ')
    ? normalizeText(normalizedToken.slice(7))
    : normalizedToken;
  const parts = rawToken.split('.');
  if (parts.length < 2) {
    return null;
  }
  try {
    const payloadText = decodeBase64UrlUtf8(parts[1] || '');
    if (!payloadText) {
      return null;
    }
    const payload = asRecord(JSON.parse(payloadText));
    const expSeconds = Number(payload.exp);
    if (!Number.isFinite(expSeconds) || expSeconds <= 0) {
      return null;
    }
    return expSeconds * 1000;
  } catch {
    return null;
  }
}

export function discardExpiredRuntimeAccessToken(accessToken: string): string {
  const normalizedToken = normalizeText(accessToken);
  if (!normalizedToken) {
    return '';
  }
  const expiryMs = decodeJwtExpiry(normalizedToken);
  if (expiryMs !== null && expiryMs <= Date.now()) {
    return '';
  }
  return normalizedToken;
}

export function timestampToMillis(
  value: { seconds?: string | number | bigint; nanos?: number } | null | undefined,
): number {
  if (!value) {
    return 0;
  }
  const seconds = Number(value.seconds || 0);
  const nanos = Number(value.nanos || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 0;
  }
  return seconds * 1000 + Math.floor((Number.isFinite(nanos) ? nanos : 0) / 1_000_000);
}

export function createDisabledRuntime(appId: string): Runtime {
  const target = { appId } as Runtime;
  return new Proxy(target, {
    get(currentTarget, prop, receiver) {
      if (prop === 'appId') {
        return Reflect.get(currentTarget, prop, receiver);
      }
      if (prop === 'toString') {
        return () => '[DisabledRuntime]';
      }
      throw createNimiError({
        message: `runtime is disabled for platform client ${appId}`,
        reasonCode: ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
        actionHint: 'configure_runtime_transport',
        source: 'sdk',
      });
    },
  });
}

export function createLocalFirstPartyAuthRouteError(route: string): never {
  throw createNimiError({
    message: `local first-party Runtime mode does not expose Realm ${route} as account truth`,
    reasonCode: ReasonCode.SDK_AUTH_MODE_INVALID,
    actionHint: 'use_runtime_account_browser_login',
    source: 'sdk',
  });
}
