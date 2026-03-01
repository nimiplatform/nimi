export { normalizeApiError } from '@runtime/net/error-normalize';

export type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type DataSyncApiConfig = {
  realmBaseUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  fetchImpl?: FetchImpl;
};

export function tryParseJsonLike<T>(value: T): T {
  if (typeof value !== 'string') {
    return value;
  }

  const text = value.trim();
  if (!text) {
    return value;
  }

  if (
    (text.startsWith('{') && text.endsWith('}')) ||
    (text.startsWith('[') && text.endsWith(']'))
  ) {
    try {
      return JSON.parse(text) as T;
    } catch {
      return value;
    }
  }

  return value;
}

export function normalizeRealmBaseUrl(rawValue: unknown): string {
  const value = String(rawValue || '').trim();
  if (!value) {
    return '';
  }
  const normalized = value.replace(/\/$/, '');
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    const hasExplicitPort = parsed.port.trim().length > 0;
    const isLoopbackHttp =
      parsed.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1');
    if (isLoopbackHttp && !hasExplicitPort) {
      parsed.port = '3002';
      return parsed.toString().replace(/\/$/, '');
    }
    return normalized;
  } catch {
    return normalized;
  }
}
