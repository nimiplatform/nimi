import { afterEach, describe, expect, it } from 'vitest';
import {
  BridgeError,
  clearAuthSession,
  loadAuthSession,
  saveAuthSession,
} from '../src/bridge/index.js';
import type { SharedDesktopAuthSession } from '@nimiplatform/nimi-kit/auth';

type TauriTestGlobal = typeof globalThis & {
  __NIMI_TAURI_TEST__?: {
    invoke?: (command: string, payload?: unknown) => Promise<unknown>;
  };
};

const testGlobal = globalThis as TauriTestGlobal;

const session: SharedDesktopAuthSession = {
  realmBaseUrl: 'https://realm.test',
  user: {
    id: 'user-1',
    displayName: 'User One',
  },
  accessToken: 'access-token',
  updatedAt: '2026-05-08T00:00:00.000Z',
};

afterEach(() => {
  delete testGlobal.__NIMI_TAURI_TEST__;
});

describe('auth session bridge', () => {
  it('fails closed when loading without Tauri invoke', async () => {
    await expect(loadAuthSession()).rejects.toBeInstanceOf(BridgeError);
  });

  it('fails closed when saving without Tauri invoke', async () => {
    await expect(saveAuthSession(session)).rejects.toBeInstanceOf(BridgeError);
  });

  it('fails closed when clearing without Tauri invoke', async () => {
    await expect(clearAuthSession()).rejects.toBeInstanceOf(BridgeError);
  });

  it('uses the runtime auth-session command when Tauri invoke is available', async () => {
    const calls: Array<{ command: string; payload: unknown }> = [];
    testGlobal.__NIMI_TAURI_TEST__ = {
      invoke: async (command, payload) => {
        calls.push({ command, payload });
        return null;
      },
    };

    await saveAuthSession(session);
    await clearAuthSession();

    expect(calls).toEqual([
      { command: 'auth_session_save', payload: { payload: session } },
      { command: 'auth_session_clear', payload: {} },
    ]);
  });
});
