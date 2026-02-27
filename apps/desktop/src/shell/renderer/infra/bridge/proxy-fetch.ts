import { desktopBridge } from '@renderer/bridge';

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
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

  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [String(key), String(value)]),
  );
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== 'undefined' && input instanceof Request;
}

function hasOwnBody(init: RequestInit): boolean {
  return Object.prototype.hasOwnProperty.call(init, 'body');
}

function resolveMethod(input: RequestInfo | URL, init: RequestInit): string {
  if (typeof init.method === 'string' && init.method.trim()) {
    return init.method.trim().toUpperCase();
  }
  if (isRequest(input) && typeof input.method === 'string' && input.method.trim()) {
    return input.method.trim().toUpperCase();
  }
  return 'GET';
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if (isRequest(input)) {
    return input.url;
  }
  return String(input || '');
}

async function readBodyString(body: BodyInit | null | undefined): Promise<string | undefined> {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (typeof body === 'string') {
    return body;
  }
  const probeRequest = new Request('https://nimi.invalid/proxy-body', {
    method: 'POST',
    body,
  });
  return probeRequest.text();
}

async function resolveBody(
  input: RequestInfo | URL,
  init: RequestInit,
  method: string,
): Promise<string | undefined> {
  if (method === 'GET' || method === 'HEAD') {
    return undefined;
  }
  if (hasOwnBody(init)) {
    return readBodyString(init.body ?? undefined);
  }
  if (isRequest(input)) {
    try {
      return await input.clone().text();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function createProxyFetch(): typeof fetch {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = resolveMethod(input, init);
    const baseHeaders = isRequest(input) ? normalizeHeaders(input.headers) : {};
    const overrideHeaders = normalizeHeaders(init.headers);
    const requestBody = await resolveBody(input, init, method);

    const response = await desktopBridge.proxyHttp({
      url: resolveUrl(input),
      method,
      headers: {
        ...baseHeaders,
        ...overrideHeaders,
      },
      body: requestBody,
    });

    const status = Number(response.status || 0);
    const disallowBody = status === 204 || status === 205 || status === 304;
    const body = disallowBody ? null : response.body;
    return new Response(body, {
      status: response.status,
      headers: response.headers,
    });
  };
}
