import { describe, expect, it } from 'vitest';
import {
  createNimiElectronInstalledAppRuntimeAccountTrustedMetadataProvider,
  createNimiElectronRuntimeAccountTrustedMetadataProvider,
} from '../src/main/runtime-account-auth.js';

const ACCOUNT_SESSION_STATE_ANONYMOUS = 1;
const ACCOUNT_SESSION_STATE_AUTHENTICATED = 3;
const ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP = 1;
const ACCOUNT_CALLER_MODE_LOCAL_DEVELOPER_APP = 7;
const ACCOUNT_CALLER_MODE_DESKTOP_LAUNCHED_NIMI_APP = 8;
const EXTERNAL_PRINCIPAL_TYPE_APP = 2;
const POLICY_MODE_CUSTOM = 2;
const AUTHORIZATION_PRESET_UNSPECIFIED = 0;

describe('Electron Runtime account trusted metadata provider', () => {
  it('returns undefined when account is unauthenticated', async () => {
    let registerCalled = false;
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
            registerCalled = true;
            return { accepted: true };
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
    expect(registerCalled).toBe(true);
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
        mode: ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
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

  it('invalidates only protected access metadata when a cached app grant is rejected', async () => {
    let openSessionCount = 0;
    let authorizeCount = 0;
    const provider = createNimiElectronRuntimeAccountTrustedMetadataProvider({
      appId: 'nimi.zhiyu',
      runtimeEndpoint: '127.0.0.1:46371',
      accountCaller: {
        appId: 'nimi.zhiyu',
        appInstanceId: 'nimi.zhiyu.local-first-party',
        deviceId: 'zhiyu-local-first-party-device',
        mode: ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
        scopes: [],
      },
      protectedAccess: {
        consentId: 'zhiyu-runtime-account',
        authorizationVersion: 'zhiyu-runtime-account-v1',
        scopeCatalogVersion: 'sdk-v2',
        scopes: ['runtime.agent.turn.read', 'runtime.agent.turn.write'],
      },
      appSession: {
        appInstanceId: 'nimi.zhiyu.platform-runtime-session',
        deviceId: 'zhiyu-platform-runtime-session',
        capabilities: ['runtime.agent.turn.read', 'runtime.agent.turn.write'],
      },
      runtime: {
        account: {
          getAccountSessionStatus: async () => ({
            state: ACCOUNT_SESSION_STATE_AUTHENTICATED,
            accountProjection: { accountId: 'acct-zhiyu', displayName: 'Zhiyu' },
          }),
        },
        auth: {
          registerApp: async () => ({ accepted: true }),
          openSession: async () => {
            openSessionCount += 1;
            return {
              sessionId: 'session-zhiyu',
              sessionToken: 'session-secret',
              expiresAt: { seconds: Math.floor(Date.now() / 1000) + 3600, nanos: 0 },
            };
          },
        },
        grants: {
          authorizeExternalPrincipal: async () => {
            authorizeCount += 1;
            return {
              tokenId: `grant-${authorizeCount}`,
              secret: 'grant-secret',
              expiresAt: { seconds: Math.floor(Date.now() / 1000) + 3600, nanos: 0 },
            };
          },
        },
      },
    });
    const input = {
      command: 'nimi.shell.runtime.unary',
      methodId: '/nimi.runtime.v1.RuntimeAgentService/ListAgents',
      event: {},
      appId: 'nimi.zhiyu',
      runtimeEndpoint: '127.0.0.1:46371',
    } as never;

    const first = await provider(input);
    const cached = await provider(input);
    provider.invalidate?.('APP_GRANT_INVALID');
    const refreshed = await provider(input);

    expect(first?.protectedAccessToken?.tokenId).toBe('grant-1');
    expect(cached?.protectedAccessToken?.tokenId).toBe('grant-1');
    expect(refreshed?.protectedAccessToken?.tokenId).toBe('grant-2');
    expect(openSessionCount).toBe(1);
    expect(authorizeCount).toBe(2);
  });

  it('passes a safe protected access scope signature to custom idempotency keys', async () => {
    let idempotencyInput: Record<string, unknown> | undefined;
    const provider = createNimiElectronRuntimeAccountTrustedMetadataProvider({
      appId: 'nimi.zhiyu',
      runtimeEndpoint: '127.0.0.1:46371',
      accountCaller: {
        appId: 'nimi.zhiyu',
        appInstanceId: 'nimi.zhiyu.local-first-party',
        deviceId: 'zhiyu-local-first-party-device',
        mode: ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
        scopes: [],
      },
      protectedAccess: {
        consentId: 'zhiyu-runtime-account',
        authorizationVersion: 'zhiyu-runtime-account-v1',
        scopeCatalogVersion: 'sdk-v2',
        scopes: ['runtime.agent.turn.read', 'runtime.agent.ai_config.read'],
        idempotencyKey: (input) => {
          idempotencyInput = input;
          return `zhiyu-runtime-protected-${input.normalizedSubjectUserId}-${input.scopesSignature}`;
        },
      },
      appSession: {
        appInstanceId: 'nimi.zhiyu.platform-runtime-session',
        deviceId: 'zhiyu-platform-runtime-session',
        capabilities: ['runtime.agent.turn.read', 'runtime.agent.ai_config.read'],
      },
      runtime: {
        account: {
          getAccountSessionStatus: async () => ({
            state: ACCOUNT_SESSION_STATE_AUTHENTICATED,
            accountProjection: { accountId: 'acct-zhiyu', displayName: 'Zhiyu' },
          }),
        },
        auth: {
          registerApp: async () => ({ accepted: true }),
          openSession: async () => ({
            sessionId: 'session-zhiyu',
            sessionToken: 'session-secret',
            expiresAt: { seconds: Math.floor(Date.now() / 1000) + 3600, nanos: 0 },
          }),
        },
        grants: {
          authorizeExternalPrincipal: async () => ({
            tokenId: 'grant-zhiyu',
            secret: 'grant-secret',
            expiresAt: { seconds: Math.floor(Date.now() / 1000) + 3600, nanos: 0 },
          }),
        },
      },
    });

    await provider({
      command: 'nimi.shell.runtime.unary',
      methodId: '/nimi.runtime.v1.RuntimeAgentService/ListAgents',
      event: {},
      appId: 'nimi.zhiyu',
      runtimeEndpoint: '127.0.0.1:46371',
    } as never);

    expect(idempotencyInput?.scopesSignature).toMatch(/^s2-[a-z0-9]+$/u);
    expect(String(idempotencyInput?.scopesSignature)).not.toContain('|');
  });

  it('pre-registers local first-party account callers before account subject lookup', async () => {
    const events: string[] = [];
    let registeredCaller = false;
    const registerInputs: Record<string, unknown>[] = [];
    const provider = createNimiElectronRuntimeAccountTrustedMetadataProvider({
      appId: 'nimi.zhiyu',
      runtimeEndpoint: '127.0.0.1:46371',
      accountCaller: {
        appId: 'nimi.zhiyu',
        appInstanceId: 'nimi.zhiyu.local-first-party',
        deviceId: 'zhiyu-local-first-party-device',
        mode: ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
        scopes: ['runtime.account.read'],
      },
      protectedAccess: {
        consentId: 'zhiyu-runtime-account',
        authorizationVersion: 'zhiyu-runtime-account-v1',
        scopeCatalogVersion: 'sdk-v2',
        scopes: ['runtime.account.read', 'runtime.agent.read'],
      },
      appSession: {
        appInstanceId: 'nimi.zhiyu.platform-runtime-session',
        deviceId: 'zhiyu-platform-runtime-session',
        capabilities: ['runtime.account.read', 'runtime.agent.read'],
      },
      runtime: {
        account: {
          getAccountSessionStatus: async () => {
            events.push('status');
            return registeredCaller
              ? {
                state: ACCOUNT_SESSION_STATE_AUTHENTICATED,
                accountProjection: { accountId: 'acct-zhiyu', displayName: 'Zhiyu' },
              }
              : { state: ACCOUNT_SESSION_STATE_AUTHENTICATED };
          },
        },
        auth: {
          registerApp: async (input: Record<string, unknown>) => {
            events.push(`register:${input.appInstanceId}`);
            if (input.appInstanceId === 'nimi.zhiyu.local-first-party') {
              registeredCaller = true;
            }
            registerInputs.push(input);
            return { accepted: true };
          },
          openSession: async () => ({
            sessionId: 'session-zhiyu',
            sessionToken: 'session-secret',
            expiresAt: { seconds: Math.floor(Date.now() / 1000) + 3600, nanos: 0 },
          }),
        },
        grants: {
          authorizeExternalPrincipal: async () => ({
            tokenId: 'grant-zhiyu',
            secret: 'grant-secret',
            expiresAt: { seconds: Math.floor(Date.now() / 1000) + 3600, nanos: 0 },
          }),
        },
      },
    });

    const metadata = await provider({
      command: 'nimi.shell.runtime.unary',
      methodId: '/nimi.runtime.v1.RuntimeAgentService/ListAgents',
      event: {},
      appId: 'nimi.zhiyu',
      runtimeEndpoint: '127.0.0.1:46371',
    } as never);

    expect(events[0]).toBe('register:nimi.zhiyu.local-first-party');
    expect(events[1]).toBe('status');
    expect(registerInputs[0]?.developerRegistration).toBe(false);
    expect(registerInputs[0]?.capabilities).toEqual(['runtime.account.read', 'runtime.agent.read']);
    expect(registerInputs.some((input) => input.appInstanceId === 'nimi.zhiyu.platform-runtime-session')).toBe(true);
    expect(metadata?.appSession).toEqual({ sessionId: 'session-zhiyu', sessionToken: 'session-secret' });
    expect(metadata?.protectedAccessToken).toEqual({ tokenId: 'grant-zhiyu', secret: 'grant-secret' });
  });

  it('pre-registers developer app sessions before account subject lookup', async () => {
    const events: string[] = [];
    let registeredCaller = false;
    const registerInputs: Record<string, unknown>[] = [];
    const provider = createNimiElectronRuntimeAccountTrustedMetadataProvider({
      appId: 'nimi.zhiyu',
      runtimeEndpoint: '127.0.0.1:46371',
      accountCaller: {
        appId: 'nimi.zhiyu',
        appInstanceId: 'nimi.zhiyu.local-developer',
        deviceId: 'zhiyu-local-developer-device',
        mode: ACCOUNT_CALLER_MODE_LOCAL_DEVELOPER_APP,
        scopes: ['runtime.account.read'],
      },
      protectedAccess: {
        consentId: 'zhiyu-runtime-account',
        authorizationVersion: 'zhiyu-runtime-account-v1',
        scopeCatalogVersion: 'sdk-v2',
        scopes: ['runtime.account.read', 'runtime.agent.read'],
      },
      appSession: {
        appInstanceId: 'nimi.zhiyu.platform-runtime-session',
        deviceId: 'zhiyu-platform-runtime-session',
        capabilities: ['runtime.account.read', 'runtime.agent.read'],
        developerRegistration: true,
      },
      runtime: {
        account: {
          getAccountSessionStatus: async () => {
            events.push('status');
            return registeredCaller
              ? {
                state: ACCOUNT_SESSION_STATE_AUTHENTICATED,
                accountProjection: { accountId: 'acct-zhiyu', displayName: 'Zhiyu' },
              }
              : { state: ACCOUNT_SESSION_STATE_AUTHENTICATED };
          },
        },
        auth: {
          registerApp: async (input: Record<string, unknown>) => {
            events.push(`register:${input.appInstanceId}`);
            if (input.appInstanceId === 'nimi.zhiyu.local-developer') {
              registeredCaller = true;
            }
            registerInputs.push(input);
            return { accepted: true };
          },
          openSession: async () => ({
            sessionId: 'session-zhiyu',
            sessionToken: 'session-secret',
            expiresAt: { seconds: Math.floor(Date.now() / 1000) + 3600, nanos: 0 },
          }),
        },
        grants: {
          authorizeExternalPrincipal: async () => ({
            tokenId: 'grant-zhiyu',
            secret: 'grant-secret',
            expiresAt: { seconds: Math.floor(Date.now() / 1000) + 3600, nanos: 0 },
          }),
        },
      },
    });

    const metadata = await provider({
      command: 'nimi.shell.runtime.unary',
      methodId: '/nimi.runtime.v1.RuntimeAgentService/ListAgents',
      event: {},
      appId: 'nimi.zhiyu',
      runtimeEndpoint: '127.0.0.1:46371',
    } as never);

    expect(events[0]).toBe('register:nimi.zhiyu.local-developer');
    expect(events[1]).toBe('status');
    expect(registerInputs[0]?.developerRegistration).toBe(true);
    expect(registerInputs[0]?.capabilities).toEqual(['runtime.account.read', 'runtime.agent.read']);
    expect(registerInputs.some((input) => input.appInstanceId === 'nimi.zhiyu.platform-runtime-session')).toBe(true);
    expect(metadata?.appSession).toEqual({ sessionId: 'session-zhiyu', sessionToken: 'session-secret' });
    expect(metadata?.protectedAccessToken).toEqual({ tokenId: 'grant-zhiyu', secret: 'grant-secret' });
  });

  it('builds installed app trusted metadata from Desktop launch binding without developer registration', async () => {
    let statusInput: Record<string, unknown> | undefined;
    let registerInput: Record<string, unknown> | undefined;
    const provider = createNimiElectronInstalledAppRuntimeAccountTrustedMetadataProvider({
      appId: 'community.nimi.fixture.platform-proof',
      runtimeEndpoint: '127.0.0.1:46371',
      installedApp: {
        appInstanceId: 'community.nimi.fixture.platform-proof.desktop-host',
        deviceId: 'desktop-installed-app-host-device',
        launchHostId: 'desktop-electron-installed-app-host',
        launchNonce: 'launch-nonce-1',
        releaseDescriptorRef: 'community.nimi.fixture.platform-proof.0.1.0-sandbox',
      },
      protectedAccess: {
        consentId: 'fixture-runtime-account',
        authorizationVersion: 'fixture-runtime-account-v1',
        scopeCatalogVersion: 'sdk-v2',
        scopes: ['ai.spend.meter'],
      },
      appSession: {
        capabilities: ['realm.feed.read', 'runtime.ai.consume'],
      },
      runtime: {
        account: {
          getAccountSessionStatus: async (input: Record<string, unknown>) => {
            statusInput = input;
            return {
              state: ACCOUNT_SESSION_STATE_AUTHENTICATED,
              accountProjection: { accountId: 'acct-1', displayName: 'Fixture' },
            };
          },
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
          authorizeExternalPrincipal: async () => ({
            tokenId: 'grant-1',
            secret: 'grant-secret',
            expiresAt: { seconds: Math.floor(Date.now() / 1000) + 3600, nanos: 0 },
          }),
        },
      },
    });

    const metadata = await provider({
      command: 'nimi.shell.runtime.unary',
      methodId: '/nimi.runtime.v1.RuntimeAgentService/ListAgents',
      event: {},
      appId: 'community.nimi.fixture.platform-proof',
      runtimeEndpoint: '127.0.0.1:46371',
    } as never);

    expect(metadata?.appSession).toEqual({ sessionId: 'session-1', sessionToken: 'session-secret' });
    expect((statusInput?.caller as Record<string, unknown>)?.mode).toBe(ACCOUNT_CALLER_MODE_DESKTOP_LAUNCHED_NIMI_APP);
    expect(registerInput?.appId).toBe('community.nimi.fixture.platform-proof');
    expect(registerInput?.appInstanceId).toBe('community.nimi.fixture.platform-proof.desktop-host');
    expect(registerInput?.deviceId).toBe('desktop-installed-app-host-device');
    expect(registerInput?.developerRegistration).toBe(false);
  });

  it('rejects developer registration for installed app trusted metadata', () => {
    expect(() => createNimiElectronInstalledAppRuntimeAccountTrustedMetadataProvider({
      appId: 'community.nimi.fixture.platform-proof',
      runtimeEndpoint: '127.0.0.1:46371',
      installedApp: {
        appInstanceId: 'community.nimi.fixture.platform-proof.desktop-host',
        deviceId: 'desktop-installed-app-host-device',
        launchHostId: 'desktop-electron-installed-app-host',
        launchNonce: 'launch-nonce-1',
        releaseDescriptorRef: 'community.nimi.fixture.platform-proof.0.1.0-sandbox',
      },
      protectedAccess: {
        consentId: 'fixture-runtime-account',
        authorizationVersion: 'fixture-runtime-account-v1',
        scopeCatalogVersion: 'sdk-v2',
        scopes: ['ai.spend.meter'],
      },
      appSession: {
        capabilities: ['realm.feed.read'],
        developerRegistration: true,
      },
      runtime: {
        account: { getAccountSessionStatus: async () => ({ state: ACCOUNT_SESSION_STATE_AUTHENTICATED }) },
        auth: {
          registerApp: async () => ({ accepted: true }),
          openSession: async () => ({ sessionId: 'session', sessionToken: 'token' }),
        },
        grants: { authorizeExternalPrincipal: async () => ({ tokenId: 'grant', secret: 'secret' }) },
      },
    })).toThrow(/developerRegistration/);
  });
});
