import { afterEach, describe, expect, it } from 'vitest';
import {
  getRuntimeAccountSessionStatus,
  parseDesktopAccountSessionStatus,
} from '../src/bridge/index.js';

type RuntimeAccountTestGlobal = typeof globalThis & {
  __NIMI_TAURI_TEST__?: {
    invoke?: (command: string, payload?: unknown) => Promise<unknown>;
  };
};

const testGlobal = globalThis as RuntimeAccountTestGlobal;

afterEach(() => {
  delete testGlobal.__NIMI_TAURI_TEST__;
});

describe('protected Desktop account status', () => {
  it('invokes one exact no-input command and returns the safe projection', async () => {
    const calls: Array<{ command: string; payload: unknown }> = [];
    testGlobal.__NIMI_TAURI_TEST__ = {
      invoke: async (command, payload) => {
        calls.push({ command, payload });
        return {
          state: 'authenticated',
          accountProjection: {
            accountId: 'account-1',
            displayName: 'Nimi User',
            realmEnvironmentId: 'realm-1',
          },
        };
      },
    };

    await expect(getRuntimeAccountSessionStatus()).resolves.toEqual({
      state: 'authenticated',
      accountProjection: {
        accountId: 'account-1',
        displayName: 'Nimi User',
        realmEnvironmentId: 'realm-1',
      },
    });
    expect(calls).toEqual([
      { command: 'runtime_account_session_status', payload: {} },
    ]);
  });

  it('rejects unknown states, missing authenticated projection, and protected material', () => {
    expect(() => parseDesktopAccountSessionStatus({ state: 'forged' })).toThrow(/unsupported state/);
    expect(() => parseDesktopAccountSessionStatus({ state: 'authenticated' })).toThrow(/requires accountProjection/);
    expect(() => parseDesktopAccountSessionStatus({
      state: 'authenticated',
      accountProjection: {
        accountId: 'account-1',
        displayName: 'Nimi User',
        realmEnvironmentId: 'realm-1',
        sessionToken: 'forbidden',
      },
    })).toThrow(/forbidden fields/);
  });
});
