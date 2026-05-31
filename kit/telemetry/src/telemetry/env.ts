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

type RendererTelemetryInvoke = (command: string, payload?: unknown) => Promise<unknown>;
type RendererTelemetryHook = {
  invoke?: RendererTelemetryInvoke;
};
type RendererTelemetryGlobal = typeof globalThis & {
  __NIMI_TAURI_TEST__?: RendererTelemetryHook;
  __NIMI_TAURI_RUNTIME__?: RendererTelemetryHook;
  __TAURI__?: {
    core?: RendererTelemetryHook;
    invoke?: RendererTelemetryInvoke;
  };
  window?: Window & {
    __NIMI_TAURI_TEST__?: RendererTelemetryHook;
    __NIMI_TAURI_RUNTIME__?: RendererTelemetryHook;
    __TAURI__?: {
      core?: RendererTelemetryHook;
      invoke?: RendererTelemetryInvoke;
    };
  };
};

function telemetryGlobal(): RendererTelemetryGlobal {
  return globalThis as RendererTelemetryGlobal;
}

function invokeFromHook(hook: RendererTelemetryHook | undefined): RendererTelemetryInvoke | null {
  return typeof hook?.invoke === 'function' ? hook.invoke : null;
}

function invokeFromTauriGlobal(): RendererTelemetryInvoke | null {
  const value = telemetryGlobal();
  const tauri = value.__TAURI__ || value.window?.__TAURI__;
  if (typeof tauri?.core?.invoke === 'function') {
    return tauri.core.invoke.bind(tauri.core);
  }
  if (typeof tauri?.invoke === 'function') {
    return tauri.invoke.bind(tauri);
  }
  return null;
}

export function resolveRendererTelemetryInvoke(): RendererTelemetryInvoke | null {
  const value = telemetryGlobal();
  return (
    invokeFromHook(value.__NIMI_TAURI_TEST__)
    || invokeFromHook(value.window?.__NIMI_TAURI_TEST__)
    || invokeFromHook(value.__NIMI_TAURI_RUNTIME__)
    || invokeFromHook(value.window?.__NIMI_TAURI_RUNTIME__)
    || invokeFromTauriGlobal()
  );
}

export function hasTauriInvoke(): boolean {
  return Boolean(resolveRendererTelemetryInvoke());
}
