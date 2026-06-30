import { describe, expect, it } from 'vitest';
import { createNimiElectronRuntimeAccountTrustedMetadataProvider } from '../src/main/runtime-account-auth.js';

const ACCOUNT_SESSION_STATE_ANONYMOUS = 1;
const ACCOUNT_SESSION_STATE_AUTHENTICATED = 3;
const EXTERNAL_PRINCIPAL_TYPE_APP = 2;
const POLICY_MODE_CUSTOM = 2;
const AUTHORIZATION_PRESET_UNSPECIFIED = 0;

describe('Electron Runtime account trusted metadata provider', () => {
  it('returns undefined when account is unauthenticated', async () => {
    const provider = createNimiElectronRuntimeAccountTrustedMetadataProvider({
      appId: 'nimi.thirdparty.fixture',
      runtimeEndpoint: '127.0.0.1:46371',
      accountCaller: {
        appId: 'nimi.thirdparty.fixture',
        appInstanceId: 'fixture.instance',
        deviceId: 'fixture.device',
        mode: 1,
        scopes: [],
      },
      protectedAccess: {
        consentId: 'fixture-runtime-account',
        authorizationVersion: 'fixture-runtime-account-v1',
        scopeCatalogVersion: 'sdk-v2',
        scopes: ['ai.spend.meter'],
      },
      appSession: {
        appInstanceId: 'fixture.instance',
        deviceId: 'fixture.device',
        capabilities: ['realm.feed.read', 'runtime.ai.consume'],
      },
      runtime: {
        account: {
          getAccountSessionStatus: async () => ({ state: ACCOUNT_SESSION_STATE_ANONYMOUS }),
        },
        auth: {
          registerApp: async () => {
            throw new Error('app must not be registered without account');
          },
          openSession: async () => {
            throw new Error('app session must not be opened without account');
          },
        },
        grants: {
          authorizeExternalPrincipal: async () => {
            throw new Error('grant must not be issued without account');
          },
        },
      },
    });

    await expect(provider({
      command: 'nimi.shell.runtime.unary',
      methodId: '/nimi.runtime.v1.RuntimeAgentService/ListAgents',
      event: {},
      appId: 'nimi.thirdparty.fixture',
      runtimeEndpoint: '127.0.0.1:46371',
    } as never)).resolves.toBeUndefined();
  });

  it('returns host-owned session and grant metadata', async () => {
    let registerInput: Record<string, unknown> | undefined;
    let authorizeInput: Record<string, unknown> | undefined;
    const provider = createNimiElectronRuntimeAccountTrustedMetadataProvider({
      appId: 'nimi.thirdparty.fixture',
      runtimeEndpoint: '127.0.0.1:46371',
      accountCaller: {
        appId: 'nimi.thirdparty.fixture',
        appInstanceId: 'fixture.instance',
        deviceId: 'fixture.device',
        mode: 1,
        scopes: [],
      },
      protectedAccess: {
        consentId: 'fixture-runtime-account',
        authorizationVersion: 'fixture-runtime-account-v1',
        scopeCatalogVersion: 'sdk-v2',
        scopes: ['ai.spend.meter'],
      },
      appSession: {
        appInstanceId: 'fixture.instance',
        deviceId: 'fixture.device',
        capabilities: ['realm.feed.read', 'runtime.ai.consume'],
      },
      runtime: {
        account: {
          getAccountSessionStatus: async () => ({
            state: ACCOUNT_SESSION_STATE_AUTHENTICATED,
            accountProjection: { accountId: 'acct-1', displayName: 'Fixture' },
          }),
        },
        auth: {
          registerApp: async (input: Record<string, unknown>) => {
            registerInput = input;
            return { accepted: true };
          },
          openSession: async () => ({
            sessionId: 'session-1',
            sessionToken: 'session-secret',
            expiresAt: { seconds: Math.floor(Date.now() / 1000) + 3600, nanos: 0 },
          }),
        },
        grants: {
          authorizeExternalPrincipal: async (input: Record<string, unknown>) => {
            authorizeInput = input;
            return {
              tokenId: 'grant-1',
              secret: 'grant-secret',
              expiresAt: { seconds: Math.floor(Date.now() / 1000) + 3600, nanos: 0 },
            };
          },
        },
      },
    });

    const metadata = await provider({
      command: 'nimi.shell.runtime.unary',
      methodId: '/nimi.runtime.v1.RuntimeAgentService/ListAgents',
      event: {},
      appId: 'nimi.thirdparty.fixture',
      runtimeEndpoint: '127.0.0.1:46371',
    } as never);

    expect(metadata?.appSession).toEqual({ sessionId: 'session-1', sessionToken: 'session-secret' });
    expect(metadata?.protectedAccessToken).toEqual({ tokenId: 'grant-1', secret: 'grant-secret' });
    expect(registerInput?.capabilities).toEqual(['realm.feed.read', 'runtime.ai.consume']);
    expect(registerInput?.developerRegistration).toBe(false);
    expect(authorizeInput?.externalPrincipalType).toBe(EXTERNAL_PRINCIPAL_TYPE_APP);
    expect(authorizeInput?.policyMode).toBe(POLICY_MODE_CUSTOM);
    expect(authorizeInput?.preset).toBe(AUTHORIZATION_PRESET_UNSPECIFIED);
  });
});
