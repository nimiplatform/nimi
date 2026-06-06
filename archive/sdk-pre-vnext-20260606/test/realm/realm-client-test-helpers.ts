export type FetchCall = {
  url: string;
  authorization?: string;
};

export function createAbortError(message: string): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException(message, 'AbortError');
  }
  const error = new Error(message) as Error & { name?: string };
  error.name = 'AbortError';
  return error;
}

export function resolveFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.url;
  }
  return String(input || '');
}

export function resolveFetchHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    const requestHeaders = new Headers(input.headers);
    requestHeaders.forEach((value, key) => {
      if (!headers.has(key)) {
        headers.set(key, value);
      }
    });
  }
  return headers;
}

export function resolveFetchSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | null {
  if (init?.signal) {
    return init.signal;
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.signal;
  }
  return null;
}

export function extractPathParameterNames(path: string): string[] {
  const names: string[] = [];
  const matcher = /\{([^}]+)\}/g;
  let match = matcher.exec(path);
  while (match) {
    const name = String(match[1] || '').trim();
    if (name && !names.includes(name)) {
      names.push(name);
    }
    match = matcher.exec(path);
  }
  return names;
}
