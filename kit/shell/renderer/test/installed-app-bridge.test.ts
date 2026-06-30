import { describe, expect, it } from 'vitest';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { createInstalledNimiAppStandardShellSurface } from '../src/bridge/index.js';

type RendererInstalledAppTestGlobal = typeof globalThis & {
  __NIMI_ELECTRON_TEST__?: {
    invoke: (command: string, payload?: unknown) => Promise<unknown>;
    listen: (eventName: string, handler: (event: { payload: unknown }) => void) => () => void;
  };
};

describe('renderer installed app standard shell surface', () => {
  it('composes only host-neutral standard shell commands for installed Nimi App bootstrap', async () => {
    const root = globalThis as RendererInstalledAppTestGlobal;
    const previous = root.__NIMI_ELECTRON_TEST__;
    const calls: Array<{ readonly command: string; readonly payload: unknown }> = [];
    root.__NIMI_ELECTRON_TEST__ = {
      invoke: async (command, payload) => {
        calls.push({ command, payload });
        if (command === NIMI_STANDARD_SHELL_COMMANDS['config.get']) return { path: 'config/app.json', config: { theme: 'dark' } };
        if (command === NIMI_STANDARD_SHELL_COMMANDS['config.set']) return { path: 'config/app.json', config: { density: 'compact' } };
        if (command === NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve']) return { path: 'D:/Nimi/apps/fixture/data/settings.json' };
        if (command === NIMI_STANDARD_SHELL_COMMANDS['storage.readJson']) return { path: 'settings/view.json', value: { zoom: 1 } };
        if (command === NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson']) return { path: 'settings/view.json', value: { zoom: 2 } };
        if (command === NIMI_STANDARD_SHELL_COMMANDS['local-assets.resolveUrl']) return { path: 'dist/icon.png', url: 'nimi-installed-app://fixture/dist/icon.png' };
        throw new Error(`unexpected command ${command}`);
      },
      listen: () => () => undefined,
    };

    try {
      const surface = createInstalledNimiAppStandardShellSurface();
      await expect(surface.config.get()).resolves.toEqual({ theme: 'dark' });
      await expect(surface.config.set({ density: 'compact' })).resolves.toEqual({ density: 'compact' });
      await expect(surface.data.resolvePath('settings/view.json')).resolves.toBe('D:/Nimi/apps/fixture/data/settings.json');
      await expect(surface.storage.readJson('settings/view.json')).resolves.toEqual({ zoom: 1 });
      await expect(surface.storage.writeJson('settings/view.json', { zoom: 2 })).resolves.toEqual({ zoom: 2 });
      await expect(surface.localAssets.resolveUrl('dist/icon.png')).resolves.toBe('nimi-installed-app://fixture/dist/icon.png');
    } finally {
      root.__NIMI_ELECTRON_TEST__ = previous;
    }

    expect(calls.map((call) => call.command)).toEqual([
      NIMI_STANDARD_SHELL_COMMANDS['config.get'],
      NIMI_STANDARD_SHELL_COMMANDS['config.set'],
      NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve'],
      NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'],
      NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'],
      NIMI_STANDARD_SHELL_COMMANDS['local-assets.resolveUrl'],
    ]);
    expect(calls[1]?.payload).toEqual({ payload: { config: { density: 'compact' } } });
    expect(calls[4]?.payload).toEqual({ payload: { relativePath: 'settings/view.json', value: { zoom: 2 } } });
  });
});
