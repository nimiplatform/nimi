import { desktopBridge } from '@renderer/bridge';

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const entries = headers instanceof Headers
    ? [...headers.entries()]
    : Array.isArray(headers)
      ? headers
      : Object.entries(headers || {});
  const normalized: Record<string, string> = {};
  for (const [key, value] of entries) {
    const name = String(key).trim();
    if (!name || value === undefined || value === null) {
      continue;
    }
    if (name.toLowerCase() === 'authorization') {
      throw new Error('Desktop renderer proxy fetch cannot carry Authorization credentials.');
    }
    normalized[name] = String(value);
  }
  return normalized;
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== 'undefined' && input instanceof Request;
}

async function resolveBody(
  input: RequestInfo | URL,
  init: RequestInit,
  method: string,
): Promise<string | undefined> {
  if (method === 'GET' || method === 'HEAD') {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(init, 'body')) {
    if (init.body === undefined || init.body === null) {
      return undefined;
    }
    if (typeof init.body === 'string') {
      return init.body;
    }
    return new Request('https://probe.nimi.ai/proxy-body', {
      method: 'POST',
      body: init.body,
    }).text();
  }
  return isRequest(input) ? input.clone().text() : undefined;
}

export function createProxyFetch(): typeof fetch {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = String(init.method || (isRequest(input) ? input.method : 'GET')).trim().toUpperCase();
    const headers = normalizeHeaders({
      ...(isRequest(input) ? normalizeHeaders(input.headers) : {}),
      ...normalizeHeaders(init.headers),
    });
    const response = await desktopBridge.proxyHttp({
      url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      method,
      headers,
      body: await resolveBody(input, init, method),
    });
    const body = response.status === 204 || response.status === 205 || response.status === 304
      ? null
      : response.body;
    return new Response(body, {
      status: response.status,
      headers: response.headers,
    });
  };
}
