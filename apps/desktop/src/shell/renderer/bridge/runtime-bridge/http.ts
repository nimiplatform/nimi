import { createNimiError } from '@nimiplatform/sdk/types';
import { hasElectronInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { assertRecord, parseOptionalJsonObject } from './shared.js';
import { invokeChecked } from './invoke';
import { resolveRendererSessionTraceId } from '@nimiplatform/kit/telemetry';

type ProxyHttpPayload = {
  url: string;
  method?: string;
  headers?: HeadersInit;
  body?: string;
};

type ProxyHttpResult = {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
};

function createDesktopBridgeError(reasonCode: string, message: string) {
  return createNimiError({
    message,
    reasonCode,
    actionHint: 'check_desktop_bridge_config',
    source: 'runtime',
  });
}

function parseProxyHttpResult(value: unknown): ProxyHttpResult {
  const record = assertRecord(value, 'http_request returned invalid payload');
  const status = Number(record.status);
  if (!Number.isFinite(status)) {
    throw new Error('http_request returned invalid status');
  }
  const headers = parseOptionalJsonObject(record.headers) || {};
  return {
    status,
    ok: Boolean(record.ok),
    headers: Object.fromEntries(
      Object.entries(headers).map(([key, headerValue]) => [String(key), String(headerValue || '')]),
    ),
    body: String(record.body || ''),
  };
}

function sanitizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(
      headers
        .filter((entry) => Array.isArray(entry) && entry.length >= 2)
        .map(([key, value]) => [String(key), String(value)]),
    );
  }

  if (!headers || typeof headers !== 'object') {
    return {};
  }

  const entries = Object.entries(headers)
    .filter(([key, value]) => typeof key === 'string' && value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)]);

  return Object.fromEntries(entries);
}

function sanitizeRendererHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const normalizedHeaders = sanitizeHeaders(headers);
  for (const key of Object.keys(normalizedHeaders)) {
    if (key.trim().toLowerCase() !== 'authorization') {
      continue;
    }
    throw createDesktopBridgeError(
      'DESKTOP_HTTP_RENDERER_AUTHORIZATION_FORBIDDEN',
      'Desktop renderer HTTP requests cannot carry Authorization credentials.',
    );
  }
  return normalizedHeaders;
}

export async function proxyHttp(payload: ProxyHttpPayload): Promise<ProxyHttpResult> {
  if (!hasElectronInvoke()) {
    throw createDesktopBridgeError(
      'DESKTOP_HTTP_ELECTRON_HOST_REQUIRED',
      'Desktop HTTP requests require the Electron standard shell host.',
    );
  }

  const diagnosticSessionId = resolveRendererSessionTraceId();
  const headers = sanitizeRendererHeaders(payload.headers);
  return invokeChecked('http_request', {
    payload: {
      ...payload,
      headers,
      diagnosticSessionId,
    },
  }, parseProxyHttpResult);
}
