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
});
