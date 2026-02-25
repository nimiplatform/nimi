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

export function createProxyFetch(): typeof fetch {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input instanceof Request
            ? input.url
            : String(input || '');

    const response = await desktopBridge.proxyHttp({
      url,
      method: init.method || 'GET',
      headers: normalizeHeaders(init.headers),
      body: typeof init.body === 'string' ? init.body : undefined,
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
