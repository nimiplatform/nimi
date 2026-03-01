import type { NimiError } from '@nimiplatform/sdk/types';

export type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type DataSyncApiConfig = {
  realmBaseUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  fetchImpl?: FetchImpl;
};

type ApiErrorLike = {
  status: number;
  statusText?: string;
  body?: unknown;
  message?: string;
};

function objectValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return {};
}

function isApiErrorLike(error: unknown): error is ApiErrorLike {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const status = Number((error as { status?: unknown }).status);
  return Number.isFinite(status) && status > 0;
}

function isNimiError(error: unknown): error is NimiError {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as Record<string, unknown>;
  return typeof record.reasonCode === 'string' && typeof record.actionHint === 'string';
}

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

export function normalizeApiError(error: unknown, fallback = '请求失败'): Error {
  if (error instanceof Error && !isApiErrorLike(error)) {
    return error;
  }

  if (isNimiError(error)) {
    return error;
  }

  if (!isApiErrorLike(error)) {
    return new Error(fallback);
  }

  const body = tryParseJsonLike(error.body);
  if (body && typeof body === 'object') {
    const payload = objectValue(body);
    const code = payload.code || payload.error || payload.reasonCode || `HTTP_${error.status}`;
    const message = payload.message || payload.error_description || error.message || error.statusText;
    return new Error(`${String(code)}: ${String(message || fallback)}`);
  }

  if (typeof body === 'string' && body.trim()) {
    return new Error(`HTTP_${error.status}: ${body}`);
  }

  return new Error(`HTTP_${error.status}: ${error.statusText || error.message || fallback}`);
}
