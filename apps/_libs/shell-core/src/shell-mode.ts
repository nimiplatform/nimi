export type ShellMode = 'desktop' | 'web';

export type ShellFeatureFlags = {
  mode: ShellMode;
  enableRuntimeTab: boolean;
  enableMarketplaceTab: boolean;
  enableModUi: boolean;
  enableModWorkspaceTabs: boolean;
  enableSettingsExtensions: boolean;
  enableTitlebarDrag: boolean;
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
  const raw = String((import.meta as { env?: Record<string, string> }).env?.VITE_NIMI_SHELL_MODE || '').trim().toLowerCase();
  if (raw === 'desktop' || raw === 'web') {
    return raw;
  }
  if (typeof window === 'undefined') {
    return 'desktop';
  }
  return hasTauriRuntime() ? 'desktop' : 'web';
}

let cachedFlags: ShellFeatureFlags | null = null;

export function getShellFeatureFlags(): ShellFeatureFlags {
  if (cachedFlags) {
    return cachedFlags;
  }

  const mode = resolveShellModeFromEnv();
  const isDesktop = mode === 'desktop';

  cachedFlags = {
    mode,
    enableRuntimeTab: isDesktop,
    enableMarketplaceTab: isDesktop,
    enableModUi: isDesktop,
    enableModWorkspaceTabs: isDesktop,
    enableSettingsExtensions: isDesktop,
    enableTitlebarDrag: isDesktop,
    enableRuntimeBootstrap: isDesktop,
  };

  return cachedFlags;
}

export function isWebShellMode(): boolean {
  return getShellFeatureFlags().mode === 'web';
}
