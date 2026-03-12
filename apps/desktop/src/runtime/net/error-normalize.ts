import type { NimiError } from '@nimiplatform/sdk/types';
import { extractRuntimeErrorFields } from '../telemetry/error-fields';
import { tryParseJsonLike } from './json';

type ApiErrorLike = {
  status: number;
  statusText?: string;
  body?: unknown;
  message?: string;
};

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
    const data = body as Record<string, unknown>;
    const code = String(data.code || data.error || data.reasonCode || `HTTP_${error.status}`);
    const message = String(
      data.message || data.error_description || error.message || error.statusText || fallback,
    );
    const normalized = new Error(`${code}: ${message}`) as Error & Partial<NimiError>;
    const fields = extractRuntimeErrorFields(data);
    normalized.reasonCode = String(data.reasonCode || fields.reasonCode || code);
    normalized.actionHint = String(data.actionHint || data.action_hint || fields.actionHint || '');
    normalized.traceId = fields.traceId;
    normalized.retryable = fields.retryable;
    return normalized;
  }

  if (typeof body === 'string' && body.trim()) {
    return new Error(`HTTP_${error.status}: ${body}`);
  }

  return new Error(`HTTP_${error.status}: ${error.statusText || error.message || fallback}`);
}
