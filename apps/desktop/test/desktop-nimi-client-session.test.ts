import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountSessionState } from '@nimiplatform/sdk/runtime/wire-types';
import {
  clearDesktopNimiClientSession,
  setDesktopNimiClientSessionForTests,
  withDesktopRuntimeProtectedScopes,
} from '../src/shell/renderer/infra/sdk/desktop-nimi-client-session';

test('desktop Electron Runtime calls leave host-owned auth metadata to the Electron shell', async () => {
  setDesktopNimiClientSessionForTests({
    appId: 'nimi.desktop',
    runtimeTransport: { type: 'electron-ipc' },
    runtimeClients: {},
    accountRuntime: {
      account: {
        getAccountSessionStatus: async () => {
          throw new Error('Electron renderer must not mint Runtime account metadata');
        },
      },
    },
    accountCaller: {},
    realm: {},
  } as never);
  try {
    const result = await withDesktopRuntimeProtectedScopes(['runtime.agent.read'], async (callOptions) => {
      assert.deepEqual(callOptions, {});
      return 'electron-host-owned';
    });
    assert.equal(result, 'electron-host-owned');
  } finally {
    clearDesktopNimiClientSession();
  }
});

test('desktop Tauri Runtime calls use the exact host carrier without minting a public Grant token', async () => {
  let accountStatusCalls = 0;
  let publicGrantCalls = 0;
  setDesktopNimiClientSessionForTests({
    appId: 'nimi.desktop',
    runtimeTransport: { type: 'tauri-ipc' },
    runtimeClients: {},
    accountRuntime: {
      account: {
        getAccountSessionStatus: async () => {
          accountStatusCalls += 1;
          return {
            state: AccountSessionState.AUTHENTICATED,
            accountProjection: { accountId: 'user-1' },
          };
        },
      },
      grants: {
        authorizeExternalPrincipal: async () => {
          publicGrantCalls += 1;
          return { tokenId: 'public-token', secret: 'public-secret' };
        },
      },
    },
    accountCaller: {},
    realm: {},
  } as never);
  try {
    const result = await withDesktopRuntimeProtectedScopes(
      ['runtime.agent.read'],
      async (callOptions) => {
        assert.deepEqual(callOptions, {});
        return 'tauri-host-owned';
      },
    );
    assert.equal(result, 'tauri-host-owned');
    assert.equal(accountStatusCalls, 0);
    assert.equal(publicGrantCalls, 0);
  } finally {
    clearDesktopNimiClientSession();
  }
});
