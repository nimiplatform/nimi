const RENDERER_TRACE_SESSION_KEY = 'nimi.renderer.trace.sessionId.v1';
let rendererSessionTraceIdCache = '';

function requireSecureCrypto(): Crypto {
  if (typeof globalThis.crypto === 'undefined') {
    throw new Error('Secure random generator is unavailable');
  }
  return globalThis.crypto;
}

function newTraceToken(prefix = 'renderer-session'): string {
  const secureCrypto = requireSecureCrypto();
  if (typeof secureCrypto.randomUUID === 'function') {
    return `${prefix}-${secureCrypto.randomUUID().replace(/-/g, '')}`;
  }
  const bytes = new Uint8Array(12);
  secureCrypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${suffix}`;
}

export function resolveRendererSessionTraceId(): string {
  const fromWindow = String(
    (window as Window & { __NIMI_HTML_BOOT_ID__?: string }).__NIMI_HTML_BOOT_ID__ || '',
  ).trim();
  if (fromWindow) return fromWindow;

  if (rendererSessionTraceIdCache) {
    return rendererSessionTraceIdCache;
  }

  try {
    const fromSession = String(sessionStorage.getItem(RENDERER_TRACE_SESSION_KEY) || '').trim();
    if (fromSession) {
      rendererSessionTraceIdCache = fromSession;
      return fromSession;
    }
  } catch {
    // ignore
  }

  const created = newTraceToken();
  rendererSessionTraceIdCache = created;
  try {
    sessionStorage.setItem(RENDERER_TRACE_SESSION_KEY, created);
  } catch {
    // ignore
  }
  return created;
}

export function createRendererFlowId(prefix: string): string {
  return newTraceToken(prefix);
}

export function resetRendererSessionTraceIdForTest(): void {
  rendererSessionTraceIdCache = '';
}
