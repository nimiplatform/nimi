import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountCallerMode, AccountSessionState } from '@nimiplatform/sdk/runtime/browser';
import type { RuntimeDefaults } from '@renderer/bridge';

const mocks = vi.hoisted(() => ({
  createLocalFirstPartyRuntimePlatformClient: vi.fn(),
  getPlatformClient: vi.fn(),
  buildDesktopWebAuthLaunchUrl: vi.fn(),
  ensureMomentBootstrapReady: vi.fn(async () => undefined),
}));

vi.mock('@nimiplatform/sdk', () => ({
  createLocalFirstPartyRuntimePlatformClient: mocks.createLocalFirstPartyRuntimePlatformClient,
  getPlatformClient: mocks.getPlatformClient,
}));

vi.mock('@nimiplatform/nimi-kit/auth', () => ({
  buildDesktopWebAuthLaunchUrl: mocks.buildDesktopWebAuthLaunchUrl,
}));

vi.mock('@renderer/infra/bootstrap/moment-bootstrap.js', () => ({
  ensureMomentBootstrapReady: mocks.ensureMomentBootstrapReady,
}));

const {
  MOMENT_RUNTIME_APP_ID,
  createMomentLocalFirstPartyPlatformClient,
  createMomentRuntimeAccountBrowserBroker,
  loadMomentRuntimeAccountUser,
  momentRuntimeAccountCaller,
} = await import('@renderer/infra/bootstrap/moment-runtime-account.js');

const {
  createMomentDesktopBrowserAuthAdapter,
  loadMomentCurrentUser,
} = await import('./moment-auth-adapter.js');

const runtimeDefaults: RuntimeDefaults = {
  realm: {
    realmBaseUrl: 'http://localhost:3002',
    realtimeUrl: 'ws://localhost:3002/ws',
    accessToken: '',
    jwksUrl: 'http://localhost:3002/api/auth/jwks',
    revocationUrl: 'http://localhost:3002/api/auth/revocation',
    jwtIssuer: 'http://localhost:3002',
    jwtAudience: 'nimi-runtime',
  },
  runtime: {
    provider: 'llama',
    connectorId: '',
    localProviderModel: 'qwen3',
    localProviderEndpoint: 'http://127.0.0.1:11434',
    localOpenAiEndpoint: '',
    targetType: '',
    targetAccountId: '',
    agentId: '',
    worldId: '',
    userConfirmedUpload: false,
  },
};

describe('moment runtime account auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildDesktopWebAuthLaunchUrl.mockImplementation((input: { callbackUrl: string; state: string; baseUrl?: string }) =>
      `launch:${input.state}:${input.callbackUrl}:${input.baseUrl ?? ''}`);
  });

  it('uses Moment as a local first-party Runtime caller', () => {
    expect(momentRuntimeAccountCaller).toMatchObject({
      appId: MOMENT_RUNTIME_APP_ID,
      appInstanceId: 'nimi.moment.local-first-party',
      deviceId: 'local-first-party-device',
      mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
    });
  });

  it('creates a local first-party platform client without app-owned auth inputs', async () => {
    const client = { runtime: {} };
    mocks.createLocalFirstPartyRuntimePlatformClient.mockResolvedValue(client);

    await expect(createMomentLocalFirstPartyPlatformClient(runtimeDefaults)).resolves.toBe(client);
    expect(mocks.createLocalFirstPartyRuntimePlatformClient).toHaveBeenCalledWith({
      appId: 'nimi.moment',
      realmBaseUrl: 'http://localhost:3002',
      runtimeTransport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
    });
  });

  it('maps authenticated Runtime account projection into Moment auth user', async () => {
    const runtime = {
      account: {
        getAccountSessionStatus: vi.fn(async () => ({
          state: AccountSessionState.AUTHENTICATED,
          accountProjection: {
            accountId: 'acct-1',
            displayName: 'Ada',
            realmEnvironmentId: 'prod',
          },
        })),
      },
    };

    await expect(loadMomentRuntimeAccountUser(runtime as never)).resolves.toEqual({
      id: 'acct-1',
      displayName: 'Ada',
    });
    expect(runtime.account.getAccountSessionStatus).toHaveBeenCalledWith({
      caller: momentRuntimeAccountCaller,
    });
  });

  it('treats non-authenticated Runtime account state as anonymous', async () => {
    const runtime = {
      account: {
        getAccountSessionStatus: vi.fn(async () => ({
          state: AccountSessionState.ANONYMOUS,
        })),
      },
    };

    await expect(loadMomentRuntimeAccountUser(runtime as never)).resolves.toBeNull();
  });

  it('loads current user from Runtime account projection only', async () => {
    const runtime = {
      account: {
        getAccountSessionStatus: vi.fn(async () => ({
          state: AccountSessionState.AUTHENTICATED,
          accountProjection: {
            accountId: 'acct-2',
            displayName: 'Grace',
          },
        })),
      },
    };
    mocks.getPlatformClient.mockReturnValue({ runtime });

    await expect(loadMomentCurrentUser()).resolves.toEqual({
      id: 'acct-2',
      displayName: 'Grace',
    });
    expect(mocks.ensureMomentBootstrapReady).toHaveBeenCalledTimes(1);
  });

  it('wraps browser login with Runtime begin and complete calls', async () => {
    const runtime = {
      account: {
        beginLogin: vi.fn(async () => ({
          accepted: true,
          loginAttemptId: 'attempt-1',
          oauthAuthorizationUrl: 'https://web.example/#/login?desktop_state=state-1',
          state: 'state-1',
          nonce: 'nonce-1',
        })),
        completeLogin: vi.fn(async () => ({
          accepted: true,
          accountProjection: {
            accountId: 'acct-3',
            displayName: 'Lin',
          },
        })),
      },
    };
    mocks.getPlatformClient.mockReturnValue({ runtime });

    const broker = createMomentRuntimeAccountBrowserBroker();
    await expect(broker.begin({
      callbackUrl: 'http://127.0.0.1:35123/callback',
      baseUrl: 'https://realm.example',
      timeoutMs: 30_000,
    })).resolves.toEqual({
      loginAttemptId: 'attempt-1',
      authorizationUrl: 'launch:state-1:http://127.0.0.1:35123/callback:https://realm.example',
      state: 'state-1',
      nonce: 'nonce-1',
    });

    await expect(broker.complete({
      loginAttemptId: 'attempt-1',
      accessToken: 'browser-code',
      refreshToken: 'browser-refresh',
      state: 'state-1',
      nonce: 'nonce-1',
      callbackUrl: 'http://127.0.0.1:35123/callback',
    })).resolves.toEqual({
      user: {
        id: 'acct-3',
        displayName: 'Lin',
      },
    });
  });

  it('refuses app-local token application and persistence', async () => {
    const adapter = createMomentDesktopBrowserAuthAdapter();

    await expect(adapter.applyToken?.('access-token', 'refresh-token')).rejects.toThrow(
      'Moment auth must use Runtime account projection',
    );
    await expect(adapter.persistSession?.({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: { id: 'acct-4' },
    })).rejects.toThrow('Moment auth must use Runtime account projection');
  });

  it('keeps Moment bootstrap off the old shared auth session path', () => {
    const appRoot = process.cwd();
    const rendererRoot = path.resolve(appRoot, 'src/shell/renderer');
    const bootstrapSource = readFileSync(path.join(rendererRoot, 'infra/bootstrap/moment-bootstrap.ts'), 'utf8');
    const authAdapterSource = readFileSync(path.join(rendererRoot, 'features/auth/moment-auth-adapter.ts'), 'utf8');
    const bridgeSource = readFileSync(path.join(rendererRoot, 'bridge/index.ts'), 'utf8');
    const tauriMainSource = readFileSync(path.join(appRoot, 'src-tauri/src/main.rs'), 'utf8');
    const appShellContract = readFileSync(path.join(appRoot, 'spec/kernel/app-shell-contract.md'), 'utf8');

    expect(bootstrapSource).not.toMatch(/resolveDesktopBootstrapAuthSession|loadAuthSession|saveAuthSession|persistSharedDesktopAuthSession|sessionStore/);
    expect(authAdapterSource).not.toMatch(/persistSharedDesktopAuthSession|saveAuthSession|clearAuthSession/);
    expect(bridgeSource).not.toMatch(/loadAuthSession|saveAuthSession/);
    expect(tauriMainSource).not.toMatch(/auth_session_commands|auth_session_load|auth_session_save|auth_session_clear/);
    expect(appShellContract).toMatch(/ACCOUNT_HARDCUT_RUNTIME_ACCOUNT_PROJECTION/);
    expect(appShellContract).not.toMatch(/ACCOUNT_HARDCUT_NON_ADMITTED_APP_SLICE_FENCE|not currently admitted/);
  });

  it('keeps raw runtime config mutation out of the renderer command surface', () => {
    const appRoot = process.cwd();
    const runtimeBridgeSource = readFileSync(path.join(appRoot, 'src-tauri/src/runtime_bridge/mod.rs'), 'utf8');
    const tauriMainSource = readFileSync(path.join(appRoot, 'src-tauri/src/main.rs'), 'utf8');

    expect(runtimeBridgeSource).not.toMatch(/RuntimeBridgeConfigSetPayload|runtime_bridge_config_set/);
    expect(tauriMainSource).not.toMatch(/runtime_bridge_config_set/);
  });
});
