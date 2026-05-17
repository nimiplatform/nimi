import { readBundledEnv } from './env.js';

export { readBundledEnv };

export type ShellMode = 'desktop' | 'web' | 'forge';

export type ShellFeatureFlags = {
  mode: ShellMode;
  enableRuntimeTab: boolean;
  enableModUi: boolean;
  enableModWorkspaceTabs: boolean;
  enableSettingsExtensions: boolean;
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

function resolveShellModeFromEnv(): ShellMode {
  const raw = readBundledEnv('VITE_NIMI_SHELL_MODE').toLowerCase();
  if (raw === 'desktop' || raw === 'web' || raw === 'forge') {
    return raw;
  }
  if (typeof window === 'undefined') {
    return 'desktop';
  }
  return hasTauriRuntime() ? 'desktop' : 'web';
}

function isMacDesktopEnvironment(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  // Prefer User-Agent Client Hints when available; navigator.platform is kept only as a legacy fallback.
  const userAgentDataPlatform = (navigator as Navigator & {
    userAgentData?: { platform?: string };
  }).userAgentData?.platform;
  const platform = String(userAgentDataPlatform || navigator.platform || '').toLowerCase();
  const userAgent = String(navigator.userAgent || '').toLowerCase();
  return platform.includes('mac') || userAgent.includes('mac os');
}

let cachedFlags: ShellFeatureFlags | null = null;

export function getShellFeatureFlags(): ShellFeatureFlags {
  if (cachedFlags) {
    return cachedFlags;
  }

  const mode = resolveShellModeFromEnv();
  const isDesktop = mode === 'desktop';
  const isForge = mode === 'forge';
  const isTauriShell = isDesktop || isForge;
  const enableMenuBarShell = isDesktop && isMacDesktopEnvironment();

  // Per closed Nimi Home Platform Entry Redesign (P-NAPP-012, P-MOEX-006),
  // Mod Hub is retired from ordinary-user product surfaces. Developer
  // builds may re-enable it by setting VITE_NIMI_ENABLE_MOD_DEVELOPER_UI=true.
  const developerModUiOptIn = readBundledEnv('VITE_NIMI_ENABLE_MOD_DEVELOPER_UI').toLowerCase() === 'true';

  cachedFlags = {
    mode,
    enableRuntimeTab: isDesktop,
    enableModUi: isDesktop && developerModUiOptIn,
    enableModWorkspaceTabs: isDesktop && developerModUiOptIn,
    enableSettingsExtensions: isTauriShell,
    enableTitlebarDrag: isTauriShell,
    enableMenuBarShell,
    enableRuntimeBootstrap: isTauriShell,
  };

  return cachedFlags;
}

export function isWebShellMode(): boolean {
  return getShellFeatureFlags().mode === 'web';
}
