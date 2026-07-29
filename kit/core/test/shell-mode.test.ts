import { afterEach, describe, expect, it, vi } from 'vitest';

type ShellModeModule = typeof import('../src/shell-mode.js');

async function loadShellModeModule(): Promise<ShellModeModule> {
  vi.resetModules();
  return await import('../src/shell-mode.js');
}

describe('shell mode primitives', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
});
