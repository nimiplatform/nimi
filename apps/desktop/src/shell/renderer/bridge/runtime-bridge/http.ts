import { assertRecord, parseOptionalJsonObject } from './shared.js';
import { hasTauriInvoke, nativeFetch } from './env';
import { invokeChecked } from './invoke';
import { resolveRendererSessionTraceId } from './logging';

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

async function proxyHttpFallback(payload: ProxyHttpPayload): Promise<ProxyHttpResult> {
  if (!payload || typeof payload !== 'object') {
    throw new Error('请求载荷无效');
  }

  const method = typeof payload.method === 'string' ? payload.method.toUpperCase() : 'GET';
  const rawUrl = String(payload.url || '').trim();
  if (!rawUrl) {
    throw new Error('请求地址为空');
  }
  const runtimeBaseUrl =
    typeof window !== 'undefined' && window.location
      ? window.location.origin
      : 'http://localhost';
  const url = new URL(rawUrl, runtimeBaseUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`不支持的协议：${url.protocol}`);
  }

  const init: RequestInit = {
    method,
    headers: sanitizeHeaders(payload.headers),
  };

  if (typeof payload.body === 'string' && method !== 'GET' && method !== 'HEAD') {
    init.body = payload.body;
  }

  if (!nativeFetch) {
    throw new Error('当前环境不支持 fetch');
  }
  const response = await nativeFetch(url.toString(), init);
  const body = await response.text();

  return {
    status: response.status,
    ok: response.ok,
    headers: Object.fromEntries(response.headers.entries()),
    body,
  };
}

export async function proxyHttp(payload: ProxyHttpPayload): Promise<ProxyHttpResult> {
  if (!hasTauriInvoke()) {
    return proxyHttpFallback(payload);
  }

  const diagnosticSessionId = resolveRendererSessionTraceId();
  return invokeChecked('http_request', {
    payload: {
      ...payload,
      diagnosticSessionId,
    },
  }, parseProxyHttpResult);
}
