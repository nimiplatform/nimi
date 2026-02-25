export const nativeFetch =
  typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;

function isRendererDebugEnabled(): boolean {
  const env = (import.meta as { env?: Record<string, string> }).env;
  return String(env?.VITE_NIMI_DEBUG_BOOT || '').trim() === '1';
}

export const RENDERER_DEBUG_ENABLED = isRendererDebugEnabled();

export function hasTauriInvoke() {
  return typeof window.__TAURI__?.core?.invoke === 'function';
}
