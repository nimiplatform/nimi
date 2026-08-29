import assert from 'node:assert/strict';
import test from 'node:test';
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
    localAppClient: {},
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

test('desktop Electron Runtime calls do not mint a public Grant token', async () => {
  let accountStatusCalls = 0;
  let publicGrantCalls = 0;
  setDesktopNimiClientSessionForTests({
    appId: 'nimi.desktop',
    runtimeTransport: { type: 'electron-ipc' },
    runtimeClients: {},
    localAppClient: {},
    accountRuntime: {
      account: {
        getAccountSessionStatus: async () => {
          accountStatusCalls += 1;
          throw new Error('Electron renderer must not fetch account metadata for protected scopes');
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
        return 'electron-host-owned';
      },
    );
    assert.equal(result, 'electron-host-owned');
    assert.equal(accountStatusCalls, 0);
    assert.equal(publicGrantCalls, 0);
  } finally {
    clearDesktopNimiClientSession();
  }
});
