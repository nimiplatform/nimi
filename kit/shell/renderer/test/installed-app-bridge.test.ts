import { describe, expect, it } from 'vitest';
import { createInstalledNimiAppStandardShellSurface } from '../src/bridge/index.js';

type RendererInstalledAppTestGlobal = typeof globalThis & {
  __NIMI_ELECTRON_TEST__?: {
    invoke: (command: string, payload?: unknown) => Promise<unknown>;
    listen: (eventName: string, handler: (event: { payload: unknown }) => void) => () => void;
  };
};

describe('renderer installed app standard shell surface', () => {
  it('fails closed before A.1 without issuing installed-app IPC', async () => {
    const root = globalThis as RendererInstalledAppTestGlobal;
    const previous = root.__NIMI_ELECTRON_TEST__;
    const calls: Array<{ readonly command: string; readonly payload: unknown }> = [];
    root.__NIMI_ELECTRON_TEST__ = {
      invoke: async (command, payload) => {
        calls.push({ command, payload });
        return {};
      },
      listen: () => () => undefined,
    };

    try {
      const surface = createInstalledNimiAppStandardShellSurface();
      const operations = [
        () => surface.config.get(),
        () => surface.config.set({ density: 'compact' }),
        () => surface.data.resolvePath('settings/view.json'),
        () => surface.storage.readJson('settings/view.json'),
        () => surface.storage.writeJson('settings/view.json', { zoom: 2 }),
        () => surface.storage.removeJson('settings/view.json'),
        () => surface.localAssets.resolveUrl('dist/icon.png'),
        () => surface.aiConfig.get('app:fixture'),
        () => surface.aiConfig.set('app:fixture', { capabilities: { selectedParams: {} } }),
      ];

      for (const operation of operations) {
        await expect(operation()).rejects.toMatchObject({
          code: 'capability-unavailable',
          reasonCode: 'renderer-installed-app-carrier-required',
          source: 'renderer',
        });
      }
    } finally {
      root.__NIMI_ELECTRON_TEST__ = previous;
    }

    expect(calls).toEqual([]);
  });
});
