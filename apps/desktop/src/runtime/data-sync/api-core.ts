export { normalizeApiError } from '@runtime/net/error-normalize';

export type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type DataSyncApiConfig = {
  realmBaseUrl?: string;
  accessToken?: string;
  accessTokenProvider?: () => string | Promise<string>;
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
