import { createNimiError } from '../../core/errors.js';
import { ReasonCode } from '../../types/index.js';

export type RealmBaseUrlProjectionInput = {
  realmBaseUrl?: unknown;
};

export type RealmRealtimeUrlProjectionInput = {
  realmBaseUrl?: unknown;
  realtimeUrl?: unknown;
};

const REALM_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function createRealmEndpointError(message: string, protocol?: string): Error {
  return createNimiError({
    message,
    reasonCode: ReasonCode.CONFIG_INVALID,
    actionHint: 'set_realm_base_url',
    source: 'sdk',
    details: protocol ? { protocol } : undefined,
  });
}

export function normalizeRealmBaseUrl(input: unknown): string {
  const value = String(input || '').trim();
  if (!value) {
    return '';
  }

  let parsed: URL;
  try {
    parsed = new URL(value.replace(/\/+$/, ''));
  } catch {
    throw createRealmEndpointError('Realm base URL must be a valid URL');
  }

  const host = parsed.hostname.toLowerCase();
  const hasExplicitPort = parsed.port.trim().length > 0;
  const isLoopbackHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';

  if (parsed.protocol === 'http:') {
    if (!isLoopbackHost) {
      throw createRealmEndpointError('Realm base URL must use https unless the host is loopback', parsed.protocol);
    }
    if (!hasExplicitPort) {
      parsed.port = '3002';
    }
    return parsed.toString().replace(/\/+$/, '');
  }

  if (parsed.protocol !== 'https:') {
    throw createRealmEndpointError(`Unsupported Realm base URL protocol: ${parsed.protocol}`, parsed.protocol);
  }

  return parsed.toString().replace(/\/+$/, '');
}

export function projectRealmBaseUrl(input: RealmBaseUrlProjectionInput | null | undefined): string {
  return normalizeRealmBaseUrl(input?.realmBaseUrl);
}

function toRealmEndpointOrigin(input: unknown): string {
  const value = String(input || '').trim();
  if (!value) {
    return '';
  }
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

export function projectRealmRealtimeUrl(input: RealmRealtimeUrlProjectionInput | null | undefined): string {
  const explicitRealtimeOrigin = toRealmEndpointOrigin(input?.realtimeUrl);
  if (explicitRealtimeOrigin) {
    return explicitRealtimeOrigin;
  }

  const realmOrigin = toRealmEndpointOrigin(input?.realmBaseUrl);
  if (!realmOrigin) {
    return '';
  }

  try {
    const parsed = new URL(realmOrigin);
    const host = parsed.hostname.toLowerCase();
    if (REALM_LOOPBACK_HOSTS.has(host) && parsed.port === '3002') {
      parsed.port = '3003';
      return parsed.origin;
    }
    return parsed.origin;
  } catch {
    return '';
  }
}
