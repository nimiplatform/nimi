import { describe, expect, it } from 'vitest';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { getShellPlatformProjection } from '../src/bridge/index.js';

type RendererPlatformProjectionTestGlobal = typeof globalThis & {
  __NIMI_ELECTRON_TEST__?: {
    invoke: (command: string, payload?: unknown) => Promise<unknown>;
    listen: (eventName: string, handler: (event: { payload: unknown }) => void) => () => void;
  };
};

async function withElectronInvoke<T>(
  invoke: (command: string, payload?: unknown) => Promise<unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const root = globalThis as RendererPlatformProjectionTestGlobal;
  const previous = root.__NIMI_ELECTRON_TEST__;
  root.__NIMI_ELECTRON_TEST__ = { invoke, listen: () => () => undefined };
  try {
    return await run();
  } finally {
    root.__NIMI_ELECTRON_TEST__ = previous;
  }
}

describe('renderer platform projection bridge', () => {
  it('invokes the standard platform projection command with nested payload', async () => {
    const calls: Array<{ readonly command: string; readonly payload: unknown }> = [];
    await withElectronInvoke(async (command, payload) => {
      calls.push({ command, payload });
      return {
        projectionId: 'apps-bridge',
        record: {
          registryPath: '~/.nimi/apps/registry.json',
          packagesPath: '~/.nimi/apps/packages.json',
          registryRows: [],
          releaseDescriptors: [],
        },
      };
    }, async () => {
      await expect(getShellPlatformProjection({ projectionId: 'apps-bridge' })).resolves.toEqual({
        projectionId: 'apps-bridge',
        record: {
          registryPath: '~/.nimi/apps/registry.json',
          packagesPath: '~/.nimi/apps/packages.json',
          registryRows: [],
          releaseDescriptors: [],
        },
      });
    });

    expect(calls).toEqual([
      {
        command: NIMI_STANDARD_SHELL_COMMANDS['platform-projection.get'],
        payload: { payload: { projectionId: 'apps-bridge' } },
      },
    ]);
  });
});
