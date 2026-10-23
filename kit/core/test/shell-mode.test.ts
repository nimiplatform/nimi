import { afterEach, describe, expect, it, vi } from 'vitest';

type ShellModeModule = typeof import('../src/shell-mode.js');

async function loadShellModeModule(): Promise<ShellModeModule> {
  vi.resetModules();
  return await import('../src/shell-mode.js');
}

describe('shell mode primitives', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults ordinary browser windows without shell host bridge to web mode', async () => {
    vi.stubGlobal('window', {});

    const { getShellFeatureFlags, isWebShellMode } = await loadShellModeModule();

    expect(getShellFeatureFlags()).toEqual({
      mode: 'web',
      enableRuntimeTab: false,
      enableTitlebarDrag: false,
      enableMenuBarShell: false,
      enableRuntimeBootstrap: false,
    });
    expect(isWebShellMode()).toBe(true);
  });

  it('treats the Electron preload bridge as a desktop Runtime account shell', async () => {
    vi.stubGlobal('window', {
      __NIMI_ELECTRON_RUNTIME__: {
        invoke: async () => null,
        listen: () => () => {},
      },
    });
    vi.stubGlobal('navigator', {
      platform: 'Linux x86_64',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    });

    const { getShellFeatureFlags, isWebShellMode } = await loadShellModeModule();

    expect(getShellFeatureFlags()).toEqual({
      mode: 'desktop',
      enableRuntimeTab: true,
      enableTitlebarDrag: false,
      enableMenuBarShell: false,
      enableRuntimeBootstrap: true,
    });
    expect(isWebShellMode()).toBe(false);
  });

  it('enables the menu-bar shell for Electron on macOS without claiming custom titlebar drag', async () => {
    vi.stubGlobal('window', {
      __NIMI_ELECTRON_RUNTIME__: {
        invoke: async () => null,
        listen: () => () => {},
      },
    });
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)',
    });

    const { getShellFeatureFlags } = await loadShellModeModule();

    expect(getShellFeatureFlags()).toEqual({
      mode: 'desktop',
      enableRuntimeTab: true,
      enableTitlebarDrag: false,
      enableMenuBarShell: true,
      enableRuntimeBootstrap: true,
    });
  });

  it('enables the system entry for Windows Electron using its platform hint', async () => {
    vi.stubGlobal('window', { __NIMI_ELECTRON_RUNTIME__: { invoke: async () => null } });
    vi.stubGlobal('navigator', { userAgentData: { platform: 'Windows' }, platform: 'Win32', userAgent: '' });
    const { getShellFeatureFlags } = await loadShellModeModule();
    expect(getShellFeatureFlags().enableMenuBarShell).toBe(true);
    expect(getShellFeatureFlags().enableTitlebarDrag).toBe(false);
  });

  it.each([
    ['ordinary browser', {}],
    ['Tauri-only host', { __TAURI__: {} }],
  ])('does not create a Windows system entry for an %s', async (_label, host) => {
    vi.stubGlobal('window', host);
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Windows NT 10.0' });
    const { getShellFeatureFlags } = await loadShellModeModule();
    expect(getShellFeatureFlags().enableMenuBarShell).toBe(false);
  });

  it('keeps explicit Web mode free of a system entry even if an Electron hook exists', async () => {
    vi.stubEnv('VITE_NIMI_SHELL_MODE', 'web');
    vi.stubGlobal('window', { __NIMI_ELECTRON_RUNTIME__: { invoke: async () => null } });
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'Mac OS X' });
    const { getShellFeatureFlags } = await loadShellModeModule();
    expect(getShellFeatureFlags().mode).toBe('web');
    expect(getShellFeatureFlags().enableMenuBarShell).toBe(false);
  });
});
