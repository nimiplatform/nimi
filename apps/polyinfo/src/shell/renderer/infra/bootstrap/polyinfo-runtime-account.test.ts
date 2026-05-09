import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountCallerMode, AccountSessionState } from '@nimiplatform/sdk/runtime/browser';
import {
  POLYINFO_RUNTIME_APP_ID,
  createPolyinfoLocalFirstPartyPlatformClient,
  createPolyinfoRuntimeAccountBrowserBroker,
  loadPolyinfoRuntimeAccountUser,
  logoutPolyinfoRuntimeAccount,
  normalizePolyinfoAccountProjection,
  polyinfoRuntimeAccountCaller,
} from './polyinfo-runtime-account.js';
import type { RuntimeDefaults } from '@renderer/bridge';

const mocks = vi.hoisted(() => ({
  createLocalFirstPartyRuntimePlatformClient: vi.fn(),
  getPlatformClient: vi.fn(),
}));

vi.mock('@nimiplatform/sdk', () => ({
  createLocalFirstPartyRuntimePlatformClient: mocks.createLocalFirstPartyRuntimePlatformClient,
  getPlatformClient: mocks.getPlatformClient,
}));

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

describe('polyinfo runtime account flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses Polyinfo as a local first-party Runtime caller', () => {
    expect(polyinfoRuntimeAccountCaller).toMatchObject({
      appId: POLYINFO_RUNTIME_APP_ID,
      appInstanceId: 'nimi.polyinfo.local-first-party',
      deviceId: 'local-first-party-device',
      mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
    });
  });

  it('creates a local first-party platform client without app-owned auth inputs', async () => {
    const client = { runtime: {} };
    mocks.createLocalFirstPartyRuntimePlatformClient.mockResolvedValue(client);

    await expect(createPolyinfoLocalFirstPartyPlatformClient(runtimeDefaults)).resolves.toBe(client);
    expect(mocks.createLocalFirstPartyRuntimePlatformClient).toHaveBeenCalledWith({
      appId: 'nimi.polyinfo',
      realmBaseUrl: 'http://localhost:3002',
      runtimeTransport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
    });
  });

  it('maps authenticated Runtime account projection into Polyinfo auth user', async () => {
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

    await expect(loadPolyinfoRuntimeAccountUser(runtime as never)).resolves.toEqual({
      id: 'acct-1',
      displayName: 'Ada',
    });
    expect(runtime.account.getAccountSessionStatus).toHaveBeenCalledWith({
      caller: polyinfoRuntimeAccountCaller,
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

    await expect(loadPolyinfoRuntimeAccountUser(runtime as never)).resolves.toBeNull();
    expect(normalizePolyinfoAccountProjection(null)).toBeNull();
  });

  it('logs out through Runtime account service', async () => {
    const runtime = {
      account: {
        logout: vi.fn(async () => ({ accepted: true })),
      },
    };

    await logoutPolyinfoRuntimeAccount(runtime as never);
    expect(runtime.account.logout).toHaveBeenCalledWith({
      caller: polyinfoRuntimeAccountCaller,
      reason: 'polyinfo_logout',
    });
  });

  it('wraps browser login with Runtime begin and complete calls (R-OAUTH-* / K-ACCSVC-008)', async () => {
    const REALM_AUTHORIZE_URL =
      'https://realm.example/api/auth/oauth/authorize'
      + '?response_type=code&client_id=nimi-desktop'
      + '&redirect_uri=http%3A%2F%2F127.0.0.1%3A35123%2Fcallback'
      + '&code_challenge=runtime-challenge&code_challenge_method=S256'
      + '&state=state-1';
    const completeLoginMock = vi.fn(async () => ({
      accepted: true,
      accountProjection: {
        accountId: 'acct-2',
        displayName: 'Grace',
        realmEnvironmentId: 'prod',
      },
    }));
    const runtime = {
      account: {
        beginLogin: vi.fn(async () => ({
          accepted: true,
          loginAttemptId: 'attempt-1',
          oauthAuthorizationUrl: REALM_AUTHORIZE_URL,
          state: 'state-1',
          nonce: 'nonce-1',
        })),
        completeLogin: completeLoginMock,
      },
    };
    mocks.getPlatformClient.mockReturnValue({ runtime });

    const broker = createPolyinfoRuntimeAccountBrowserBroker();
    // begin returns the realm authorize URL verbatim — no kit-side rebuild.
    await expect(broker.begin({
      callbackUrl: 'http://127.0.0.1:35123/callback',
      baseUrl: 'https://realm.example',
      timeoutMs: 30_000,
    })).resolves.toEqual({
      loginAttemptId: 'attempt-1',
      authorizationUrl: REALM_AUTHORIZE_URL,
      state: 'state-1',
      nonce: 'nonce-1',
    });

    // complete sends a code-only proof envelope (R-OAUTH-008).
    await expect(broker.complete({
      loginAttemptId: 'attempt-1',
      code: 'oauth-code-abc',
      state: 'state-1',
      nonce: 'nonce-1',
      callbackUrl: 'http://127.0.0.1:35123/callback',
    })).resolves.toEqual({
      user: {
        id: 'acct-2',
        displayName: 'Grace',
      },
    });

    expect(completeLoginMock).toHaveBeenCalledTimes(1);
    const completeArgs = (completeLoginMock.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(completeArgs.code).toBe('oauth-code-abc');
    expect(completeArgs.refreshToken).toBe('');
    expect(completeArgs).not.toHaveProperty('accessToken');
    expect(completeArgs).not.toHaveProperty('idToken');
  });

  it('keeps Polyinfo bootstrap off the old shared auth session path', () => {
    const appRoot = process.cwd();
    const rendererRoot = path.resolve(appRoot, 'src/shell/renderer');
    const bootstrapSource = readFileSync(path.join(rendererRoot, 'infra/bootstrap/polyinfo-bootstrap.ts'), 'utf8');
    const settingsSource = readFileSync(path.join(rendererRoot, 'features/settings/settings-page.tsx'), 'utf8');
    const tauriMainSource = readFileSync(path.join(appRoot, 'src-tauri/src/main.rs'), 'utf8');
    const packageSource = readFileSync(path.join(appRoot, 'package.json'), 'utf8');
    expect(bootstrapSource).not.toMatch(/loadAuthSession|saveAuthSession|auth_session_load|auth_session_save|sessionStore/);
    expect(settingsSource).not.toMatch(/passwordLogin|verifyTwoFactor|persistSharedDesktopAuthSession|saveAuthSession/);
    expect(tauriMainSource).not.toMatch(/auth_session_commands|auth_session_load|auth_session_save|auth_session_clear/);
    expect(packageSource).toContain('NIMI_RUNTIME_BRIDGE_MODE=RUNTIME');
  });
});
