export const nativeFetch =
  typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;

function envFlagEnabled(value: string | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function rendererEnv(): Record<string, string> | undefined {
  const fromGlobal = (globalThis as typeof globalThis & {
    __NIMI_RENDERER_ENV__?: Record<string, string>;
  }).__NIMI_RENDERER_ENV__;
  if (fromGlobal && typeof fromGlobal === 'object') {
    return fromGlobal;
  }
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
export const RENDERER_DEBUG_ENABLED = isRendererDebugEnabled();

export function isRendererVerboseEnabledForCurrentEnv(): boolean {
  return isRendererVerboseEnabled();
}

export function isRendererDebugEnabledForCurrentEnv(): boolean {
  return isRendererDebugEnabled();
}

export function shouldForwardRendererLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
  if (level === 'warn' || level === 'error') {
    return true;
  }
  return isRendererVerboseEnabled();
}

export function hasTauriInvoke() {
  return typeof window.__TAURI__?.core?.invoke === 'function';
}
