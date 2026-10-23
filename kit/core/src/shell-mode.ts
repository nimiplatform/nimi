import { readBundledEnv } from './env.js';

export { readBundledEnv };

export type ShellMode = 'desktop' | 'web';

export type ShellFeatureFlags = {
  mode: ShellMode;
  enableRuntimeTab: boolean;
  enableTitlebarDrag: boolean;
  enableMenuBarShell: boolean;
  enableRuntimeBootstrap: boolean;
};

function hasTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const win = window as unknown as Record<string, unknown>;
  return Boolean(win.__TAURI__ || win.__TAURI_INTERNALS__ || win.__TAURI_IPC__);
}

function hasElectronRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const win = window as unknown as Record<string, unknown>;
  const hook = win.__NIMI_ELECTRON_RUNTIME__;
  if (!hook || typeof hook !== 'object' || Array.isArray(hook)) {
    return false;
  }
  return typeof (hook as { invoke?: unknown }).invoke === 'function';
}

function resolveShellModeFromEnv(): ShellMode {
  const raw = readBundledEnv('VITE_NIMI_SHELL_MODE').toLowerCase();
  if (raw === 'desktop' || raw === 'web') {
    return raw;
  }
  if (typeof window === 'undefined') {
    return 'desktop';
  }
  return hasTauriRuntime() || hasElectronRuntime() ? 'desktop' : 'web';
}

function isSystemEntryPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  // These hints choose presentation only; the native Home host still verifies
  // its actual platform before creating an entry or accepting any operation.
  const userAgentDataPlatform = (navigator as Navigator & {
    userAgentData?: { platform?: string };
  }).userAgentData?.platform;
  const platform = String(userAgentDataPlatform || navigator.platform || '').toLowerCase();
  const userAgent = String(navigator.userAgent || '').toLowerCase();
  if (platform) return platform.startsWith('mac') || platform.startsWith('win');
  return userAgent.includes('mac os') || userAgent.includes('windows nt');
}

let cachedFlags: ShellFeatureFlags | null = null;

export function getShellFeatureFlags(): ShellFeatureFlags {
  if (cachedFlags) {
    return cachedFlags;
  }

  const mode = resolveShellModeFromEnv();
  const isDesktop = mode === 'desktop';
  const isTauriShell = hasTauriRuntime();
  const isElectronShell = hasElectronRuntime();
  // @nimi-authority: rule.nimi.desktop.shell-ui.r004
  const enableMenuBarShell = isDesktop && isElectronShell && isSystemEntryPlatform();

  cachedFlags = {
    mode,
    enableRuntimeTab: isDesktop,
    enableTitlebarDrag: isTauriShell,
    enableMenuBarShell,
    enableRuntimeBootstrap: isDesktop,
  };

  return cachedFlags;
}

export function isWebShellMode(): boolean {
  return getShellFeatureFlags().mode === 'web';
}
