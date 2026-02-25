import { ApiError } from '@nimiplatform/sdk-realm';
import { tryParseJsonLike } from './json';

export function normalizeApiError(error: unknown): Error {
  if (!(error instanceof ApiError)) {
    if (error instanceof Error) {
      return error;
    }
    return new Error('UNKNOWN_ERROR: 请求失败');
  }

  const body = tryParseJsonLike(error.body);
  if (body && typeof body === 'object') {
    const data = body as Record<string, unknown>;
    const code = String(data.code || data.error || `HTTP_${error.status}`);
    const message = String(
      data.message || data.error_description || error.message || error.statusText,
    );
    return new Error(`${code}: ${message}`);
  }

  if (typeof body === 'string' && body.trim()) {
    return new Error(`HTTP_${error.status}: ${body}`);
  }

  return new Error(`HTTP_${error.status}: ${error.statusText || error.message}`);
}
