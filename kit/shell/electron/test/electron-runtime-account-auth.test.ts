import { describe, expect, it } from 'vitest';

import {
  createNimiElectronInstalledAppRuntimeAccountTrustedMetadataProvider,
  createNimiElectronRuntimeAccountTrustedMetadataProvider,
} from '../src/main/runtime-account-auth.js';

const ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP = 1;

describe('Electron Runtime account trusted metadata provider', () => {
  it('hardcuts direct registration, session minting, and grant issuance without a protected carrier', async () => {
    const provider = createNimiElectronRuntimeAccountTrustedMetadataProvider({
      appId: 'nimi.thirdparty.fixture',
      runtimeEndpoint: '127.0.0.1:46371',
      accountCaller: {
        appId: 'nimi.thirdparty.fixture',
        appInstanceId: 'fixture.instance',
        deviceId: 'fixture.device',
        mode: ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
        scopes: [],
      },
      appSession: appSession(),
    });

    await expect(provider(providerInput())).rejects.toMatchObject({
      reasonCode: protectedCarrierRequiredReason(),
    });
    provider.invalidate?.('runtime-restarted');
  });

  it('hardcuts installed launch bindings until A.1 supplies a protected session carrier', async () => {
    const provider = createNimiElectronInstalledAppRuntimeAccountTrustedMetadataProvider({
      appId: 'nimi.thirdparty.fixture',
      runtimeEndpoint: '127.0.0.1:46371',
      installedApp: {
        appInstanceId: 'fixture.instance',
        deviceId: 'fixture.device',
        launchHostId: 'desktop-electron-installed-app-host',
        launchNonce: 'renderer-owned-nonce-is-not-authority',
        releaseDescriptorRef: 'fixture.release',
      },
      appSession: { capabilities: ['realm.feed.read'] },
    });

    await expect(provider(providerInput())).rejects.toMatchObject({
      reasonCode: protectedCarrierRequiredReason(),
    });
  });
});

function providerInput() {
  return {
    command: 'nimi.shell.runtime.unary',
    methodId: '/nimi.runtime.v1.RuntimeAgentService/ListAgents',
    event: {},
    appId: 'nimi.thirdparty.fixture',
    runtimeEndpoint: '127.0.0.1:46371',
  } as never;
}

function appSession() {
  return {
    appInstanceId: 'fixture.instance',
    deviceId: 'fixture.device',
    capabilities: ['realm.feed.read'],
  };
}

function protectedCarrierRequiredReason(): string {
  return 'DESKTOP_CONTROL_TRANSPORT_REQUIRED';
}
