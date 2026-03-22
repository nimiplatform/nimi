import { assertRecord, parseOptionalJsonObject } from './shared.js';
import { hasTauriInvoke, nativeFetch } from './env';
import { invokeChecked } from './invoke';
import { resolveRendererSessionTraceId } from './logging';

type ProxyHttpPayload = {
  url: string;
  method?: string;
  headers?: HeadersInit;
  authorization?: string;
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

function splitAuthorization(headers: HeadersInit | undefined, authorization?: string): {
  headers: Record<string, string>;
  authorization?: string;
} {
  const normalizedHeaders = sanitizeHeaders(headers);
  let resolvedAuthorization = typeof authorization === 'string' ? authorization.trim() : '';

  for (const [key, value] of Object.entries(normalizedHeaders)) {
    if (key.trim().toLowerCase() !== 'authorization') {
      continue;
    }
    if (!resolvedAuthorization) {
      resolvedAuthorization = String(value || '').trim();
    }
    delete normalizedHeaders[key];
  }

  return {
    headers: normalizedHeaders,
    authorization: resolvedAuthorization || undefined,
  };
}

function isIpv4Host(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) {
      return false;
    }
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}

function isPrivateIpv4Host(hostname: string): boolean {
  if (!isIpv4Host(hostname)) {
    return false;
  }
  const parts = hostname.split('.').map((part) => Number(part));
  const first = parts[0] ?? -1;
  const second = parts[1] ?? -1;
  return (
    first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 100 && second >= 64 && second <= 127)
  );
}

function isPrivateIpv6Host(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (!normalized.includes(':')) {
    return false;
  }
  if (normalized === '::1') {
    return true;
  }
  if (normalized.startsWith('::ffff:')) {
    return isPrivateIpv4Host(normalized.slice('::ffff:'.length));
  }
  return (
    normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb')
  );
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = String(hostname || '').trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]';
}

function isPrivateNetworkHost(hostname: string): boolean {
  const normalized = String(hostname || '').trim().toLowerCase();
  return isLoopbackHost(normalized) || isPrivateIpv4Host(normalized) || isPrivateIpv6Host(normalized);
}

function resolveFallbackFetchUrl(url: URL, runtimeOrigin: string, allowSameMachineLoopbackProxy: boolean): string {
  if (!allowSameMachineLoopbackProxy) {
    return url.toString();
  }
  if (!url.pathname.startsWith('/api/')) {
    return url.toString();
  }
  return `${runtimeOrigin}${url.pathname}${url.search}${url.hash}`;
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
  const runtimeUrl = new URL(runtimeBaseUrl);
  const runtimeOrigin = runtimeUrl.origin;
  const isLoopbackToLoopbackRequest =
    isLoopbackHost(runtimeUrl.hostname) && isLoopbackHost(url.hostname);
  if (url.origin !== runtimeOrigin && isPrivateNetworkHost(url.hostname) && !isLoopbackToLoopbackRequest) {
    throw new Error(`禁止访问私有网络地址：${url.hostname}`);
  }
  const { headers, authorization } = splitAuthorization(payload.headers, payload.authorization);

  const init: RequestInit = {
    method,
    headers,
  };
  if (authorization) {
    const headerBag = new Headers(init.headers);
    headerBag.set('authorization', authorization);
    init.headers = headerBag;
  }

  if (typeof payload.body === 'string' && method !== 'GET' && method !== 'HEAD') {
    init.body = payload.body;
  }

  if (!nativeFetch) {
    throw new Error('当前环境不支持 fetch');
  }
  const response = await nativeFetch(
    resolveFallbackFetchUrl(url, runtimeOrigin, isLoopbackToLoopbackRequest),
    init,
  );
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
  const { headers, authorization } = splitAuthorization(payload.headers, payload.authorization);
  return invokeChecked('http_request', {
    payload: {
      ...payload,
      headers,
      authorization,
      diagnosticSessionId,
    },
  }, parseProxyHttpResult);
}
