import { afterEach, describe, expect, it } from 'vitest';
import { createNimiAppRuntimePlatformClient } from '@nimiplatform/kit/core/sdk-contract';

import { createNimiLocalAppStandardShellSurface } from '../src/bridge/index.js';

afterEach(() => {
  delete (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__;
});

describe('renderer local-app standard-shell surface', () => {
  it('is consumed directly by the SDK without an app-local adapter', async () => {
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string) => {
        if (command.endsWith('sessionStatus')) {
          return { state: 'ready', reasonCode: 'action-executed', retryable: false };
        }
        throw new Error(`unexpected command ${command}`);
      },
      listen: () => () => {},
    };
    const client = createNimiAppRuntimePlatformClient({
      standardShell: createNimiLocalAppStandardShellSurface(),
    });
    await expect(client.auth.status()).resolves.toMatchObject({
      mode: 'local-app',
      state: 'session-bound',
      reasonCode: 'action-executed',
      retryable: false,
    });
  });

  it('emits only product permission ids and declared request fields', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        return {
          state: 'unavailable',
          permissionId: 'agents.interact',
          canRequest: false,
          reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE',
        };
      },
      listen: () => () => {},
    };
    const surface = createNimiLocalAppStandardShellSurface();
    await surface.permission.status({ permissionId: 'agents.interact' });
    await surface.permission.request({ permissionId: 'agents.interact', reason: 'Continue the conversation' });
    expect(invocations).toEqual([
      {
        command: 'nimi.shell.localApp.permissionStatus',
        payload: { payload: { permissionId: 'agents.interact' } },
      },
      {
        command: 'nimi.shell.localApp.permissionRequest',
        payload: { payload: { permissionId: 'agents.interact', reason: 'Continue the conversation' } },
      },
    ]);
    expect(surface).not.toHaveProperty('agent');
    expect(surface).not.toHaveProperty('artifacts');
  });

  it('rejects a permission reason beyond 240 UTF-8 bytes before host invocation', () => {
    const invocations: unknown[] = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (...args: unknown[]) => { invocations.push(args); return {}; },
      listen: () => () => {},
    };
    expect(() => createNimiLocalAppStandardShellSurface().permission.request({
      permissionId: 'agents.interact',
      reason: '需'.repeat(81),
    })).toThrowError(/reason is invalid/u);
    expect(invocations).toEqual([]);
  });

  it('rejects protected authority material in a permission projection', async () => {
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async () => ({
        state: 'unavailable',
        permissionId: 'agents.interact',
        canRequest: false,
        reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE',
        grantId: 'forbidden',
      }),
      listen: () => () => {},
    };
    await expect(createNimiLocalAppStandardShellSurface().permission.status({
      permissionId: 'agents.interact',
    })).rejects.toMatchObject({
      code: 'invalid-payload',
      reasonCode: 'renderer-standard-shell-result-invalid',
    });
  });

  it('carries bounded app-private storage documents without exposing a path or root', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        if (command.endsWith('removeJson')) return { removed: false };
        return { value: { token: 'app-content' }, sizeBytes: 23 };
      },
      listen: () => () => {},
    };
    const storage = createNimiLocalAppStandardShellSurface().storage;
    await expect(storage.writeJson('agent-chat/state.json', { token: 'app-content' })).resolves.toEqual({
      value: { token: 'app-content' },
      sizeBytes: 23,
    });
    await expect(storage.removeJson('agent-chat/state.json')).resolves.toEqual({ removed: false });
    expect(invocations).toEqual([
      {
        command: 'nimi.shell.storage.writeJson',
        payload: { payload: { relativePath: 'agent-chat/state.json', value: { token: 'app-content' } } },
      },
      {
        command: 'nimi.shell.storage.removeJson',
        payload: { payload: { relativePath: 'agent-chat/state.json' } },
      },
    ]);
    expect(() => storage.readJson('../escape.json')).toThrow(/relativePath is invalid/u);
  });
});
