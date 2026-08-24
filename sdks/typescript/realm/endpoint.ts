import { ReasonCode, createNimiError } from '../types';

export interface NimiRealmBaseUrlViewInput {
  readonly realmBaseUrl?: unknown;
}

const NIMI_REALM_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function endpointError(message: string, protocol?: string): Error {
  return createNimiError({
    message,
    reasonCode: ReasonCode.CONFIG_INVALID,
    actionHint: 'set_realm_base_url',
    source: 'sdk',
    details: protocol ? { protocol } : undefined,
  });
}

export function normalizeNimiRealmBaseUrl(input: unknown): string {
  const value = String(input || '').trim();
  if (!value) {
    return '';
  }

  let parsed: URL;
  try {
    parsed = new URL(value.replace(/\/+$/u, ''));
  } catch {
    throw endpointError('Realm base URL must be a valid URL.');
  }

  const host = parsed.hostname.toLowerCase();
  const hasExplicitPort = parsed.port.trim().length > 0;
  const isLoopbackHost = NIMI_REALM_LOOPBACK_HOSTS.has(host);

  if (parsed.protocol === 'http:') {
    if (!isLoopbackHost) {
      throw endpointError('Realm base URL must use https unless the host is loopback.', parsed.protocol);
    }
    if (!hasExplicitPort) {
      parsed.port = '3002';
    }
    return parsed.toString().replace(/\/+$/u, '');
  }

  if (parsed.protocol !== 'https:') {
    throw endpointError(`Unsupported Realm base URL protocol: ${parsed.protocol}`, parsed.protocol);
  }

  return parsed.toString().replace(/\/+$/u, '');
}

export function resolveNimiRealmBaseUrl(input: NimiRealmBaseUrlViewInput | null | undefined): string {
  return normalizeNimiRealmBaseUrl(input?.realmBaseUrl);
}
