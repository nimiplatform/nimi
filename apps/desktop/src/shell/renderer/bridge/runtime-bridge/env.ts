export const nativeFetch =
  typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;

function envFlagEnabled(value: string | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function rendererEnv(): Record<string, string> | undefined {
  return (import.meta as { env?: Record<string, string> }).env;
}

function isRendererDebugEnabled(): boolean {
  const env = rendererEnv();
  return envFlagEnabled(env?.VITE_NIMI_DEBUG_BOOT);
}

function isRendererVerboseEnabled(): boolean {
  const env = rendererEnv();
  return envFlagEnabled(env?.VITE_NIMI_VERBOSE_RENDERER_LOGS) || isRendererDebugEnabled();
}

export const RENDERER_VERBOSE_ENABLED = isRendererVerboseEnabled();

export function shouldForwardRendererLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
  if (level === 'warn' || level === 'error') {
    return true;
  }
  return RENDERER_VERBOSE_ENABLED;
}

export const RENDERER_DEBUG_ENABLED = isRendererDebugEnabled();

export function hasTauriInvoke() {
  return typeof window.__TAURI__?.core?.invoke === 'function';
}
