const RENDERER_TRACE_SESSION_KEY = 'nimi.renderer.trace.sessionId.v1';
let rendererSessionTraceIdCache = '';

function newTraceToken(prefix = 'renderer-session'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function resetRendererSessionTraceIdForTest(): void {
  rendererSessionTraceIdCache = '';
}
