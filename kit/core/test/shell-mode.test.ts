import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, '../src/shell-mode.ts'), 'utf8');

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

  it('owns shell feature flags without retired mod toggles', () => {
    expect(source).toMatch(/enableRuntimeTab:\s*\w+/);
    expect(source).toMatch(/enableMenuBarShell/);
    expect(source).toMatch(/isMacDesktopEnvironment/);
    expect(source).not.toMatch(/enableModUi|enableModWorkspaceTabs|VITE_NIMI_ENABLE_MOD_DEVELOPER_UI/);
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
