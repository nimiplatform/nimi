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
  buildDesktopWebAuthLaunchUrl: vi.fn(),
}));

vi.mock('@nimiplatform/sdk', () => ({
  createLocalFirstPartyRuntimePlatformClient: mocks.createLocalFirstPartyRuntimePlatformClient,
  getPlatformClient: mocks.getPlatformClient,
}));

vi.mock('@nimiplatform/nimi-kit/auth', () => ({
  buildDesktopWebAuthLaunchUrl: mocks.buildDesktopWebAuthLaunchUrl,
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
    mocks.buildDesktopWebAuthLaunchUrl.mockImplementation((input: { callbackUrl: string; state: string; baseUrl?: string }) =>
      `launch:${input.state}:${input.callbackUrl}:${input.baseUrl ?? ''}`);
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

  it('wraps browser login with Runtime begin and complete calls', async () => {
    const runtime = {
      account: {
        beginLogin: vi.fn(async () => ({
          accepted: true,
          loginAttemptId: 'attempt-1',
          state: 'state-1',
          nonce: 'nonce-1',
        })),
        completeLogin: vi.fn(async () => ({
          accepted: true,
          accountProjection: {
            accountId: 'acct-2',
            displayName: 'Grace',
            realmEnvironmentId: 'prod',
          },
        })),
      },
    };
    mocks.getPlatformClient.mockReturnValue({ runtime });

    const broker = createPolyinfoRuntimeAccountBrowserBroker();
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
        id: 'acct-2',
        displayName: 'Grace',
      },
    });
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
