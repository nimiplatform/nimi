/**
 * Realm Drift auth adapter regression tests (RD-SHELL-009 / RD-SHELL-010 /
 * RD-SHELL-004). Locks the RuntimeAccountService boundary:
 *
 * - `applyToken`/`persistSession` MUST throw DRIFT_TOKEN_PROXY_FORBIDDEN.
 *   App-owned token custody is a contract violation.
 * - Inline `passwordLogin` / `verifyTwoFactor` paths MUST be unsupported.
 * - `clearPersistedSession` MUST go through `runtime.account.logout`.
 * - `loadCurrentUser` MUST resolve from the runtime account projection.
 * - The browser broker `complete` MUST send a code-only proof envelope with
 *   `refreshToken: ''`. R-OAUTH-008 / spec K-ACCSVC-008.
 * - `projectDriftRealtimeAccessToken` projects via runtime.account.getAccessToken.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AccountSessionState,
} from '@nimiplatform/sdk/runtime/browser';

const ensureDriftBootstrapReadyMock = vi.fn(async () => undefined);
const getAccountSessionStatusMock = vi.fn();
const beginLoginMock = vi.fn();
const completeLoginMock = vi.fn();
const logoutMock = vi.fn(async () => undefined);
const getAccessTokenMock = vi.fn();

vi.mock('@renderer/bridge', () => ({
  driftTauriOAuthBridge: { openExternalUrl: vi.fn() },
}));

vi.mock('@renderer/infra/bootstrap/drift-bootstrap.js', async () => {
  const browser = await import('@nimiplatform/sdk/runtime/browser');
  return {
    ensureDriftBootstrapReady: ensureDriftBootstrapReadyMock,
    driftRuntimeAccountCaller: {
      appId: 'app.nimi.realm-drift',
      appInstanceId: 'app.nimi.realm-drift.local-first-party',
      deviceId: 'local-first-party-device',
      mode: browser.AccountCallerMode.LOCAL_FIRST_PARTY_APP,
      scopes: [],
    },
    loadDriftRuntimeAccountUser: async () => {
      const response = await getAccountSessionStatusMock({
        caller: {
          appId: 'app.nimi.realm-drift',
          appInstanceId: 'app.nimi.realm-drift.local-first-party',
          deviceId: 'local-first-party-device',
          mode: browser.AccountCallerMode.LOCAL_FIRST_PARTY_APP,
          scopes: [],
        },
      });
      if (response?.state !== browser.AccountSessionState.AUTHENTICATED) {
        return null;
      }
      const accountId = String(response.accountProjection?.accountId || '').trim();
      if (!accountId) return null;
      return {
        id: accountId,
        displayName: String(response.accountProjection?.displayName || '').trim(),
      };
    },
  };
});

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    runtime: {
      account: {
        getAccountSessionStatus: getAccountSessionStatusMock,
        beginLogin: beginLoginMock,
        completeLogin: completeLoginMock,
        logout: logoutMock,
        getAccessToken: getAccessTokenMock,
      },
    },
  }),
}));

const {
  createDriftDesktopBrowserAuthAdapter,
  createDriftRuntimeAccountBrowserBroker,
  loadDriftCurrentUser,
  logoutDriftRuntimeAccount,
  projectDriftRealtimeAccessToken,
} = await import('./drift-auth-adapter.js');

describe('drift-auth-adapter (RD-SHELL-009 / RD-SHELL-010 / RD-SHELL-004)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // RD-SHELL-010: applyToken / persistSession MUST fail-close
  // -------------------------------------------------------------------------

  it('applyToken throws DRIFT_TOKEN_PROXY_FORBIDDEN — runtime owns custody', async () => {
    const adapter = createDriftDesktopBrowserAuthAdapter();
    await expect(adapter.applyToken!('access-token', 'refresh-token')).rejects.toThrow(/RD-SHELL-010|K-ACCSVC-008|token custody/);
  });

  it('persistSession throws DRIFT_TOKEN_PROXY_FORBIDDEN', async () => {
    const adapter = createDriftDesktopBrowserAuthAdapter();
    await expect(
      adapter.persistSession!({ accessToken: 'a', refreshToken: 'r', user: { id: 'u' } } as any),
    ).rejects.toThrow(/RD-SHELL-010|K-ACCSVC-008|token custody/);
  });

  // -------------------------------------------------------------------------
  // RD-SHELL-004 step 4: inline passwordLogin / verifyTwoFactor unsupported
  // -------------------------------------------------------------------------

  it('every embedded login path is unsupported in desktop-browser mode', async () => {
    const adapter = createDriftDesktopBrowserAuthAdapter();
    const unsupported = [
      adapter.checkEmail('a@b.com'),
      adapter.passwordLogin!('x', 'y'),
      adapter.requestEmailOtp('x'),
      adapter.verifyEmailOtp('x', '1'),
      adapter.verifyTwoFactor('t', '1'),
      adapter.walletChallenge({ walletAddress: 'a', chainId: 1, walletType: 'metamask' }),
      adapter.walletLogin({ walletAddress: 'a', chainId: 1, nonce: 'n', message: 'm', signature: 's', walletType: 'metamask' }),
      adapter.oauthLogin('google', 'access-token'),
      adapter.updatePassword('new-password'),
    ];
    for (const promise of unsupported) {
      await expect(promise).rejects.toThrow(/Embedded auth flow is not supported/);
    }
  });

  // -------------------------------------------------------------------------
  // RD-SHELL-004 step 2: loadCurrentUser comes from runtime projection
  // -------------------------------------------------------------------------

  it('loadCurrentUser projects from runtime.account.getAccountSessionStatus', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.AUTHENTICATED,
      accountProjection: { accountId: 'drift-user', displayName: 'Drift User' },
    });
    await expect(loadDriftCurrentUser()).resolves.toEqual({
      id: 'drift-user',
      displayName: 'Drift User',
    });
    expect(ensureDriftBootstrapReadyMock).toHaveBeenCalled();
  });

  it('loadCurrentUser returns null when runtime account is ANONYMOUS', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.ANONYMOUS,
      accountProjection: null,
    });
    await expect(loadDriftCurrentUser()).resolves.toBeNull();
  });

  // -------------------------------------------------------------------------
  // RD-SHELL-004 step 8: clearPersistedSession routes to runtime logout
  // -------------------------------------------------------------------------

  it('clearPersistedSession calls runtime.account.logout, not a shared bridge', async () => {
    const adapter = createDriftDesktopBrowserAuthAdapter();
    await adapter.clearPersistedSession!();
    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(logoutMock).toHaveBeenCalledWith({
      caller: expect.objectContaining({
        appId: 'app.nimi.realm-drift',
        appInstanceId: 'app.nimi.realm-drift.local-first-party',
      }),
      reason: 'realm_drift_logout',
    });
  });

  it('logoutDriftRuntimeAccount() invokes runtime.account.logout once', async () => {
    await logoutDriftRuntimeAccount();
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // RD-SHELL-009: broker.begin uses the realm OAuth authorize URL from runtime
  // -------------------------------------------------------------------------

  it('broker.begin calls runtime.account.beginLogin with the fixed Realm Drift caller', async () => {
    beginLoginMock.mockResolvedValue({
      accepted: true,
      loginAttemptId: 'attempt-1',
      oauthAuthorizationUrl: 'https://realm.test/api/auth/oauth/authorize?...',
      state: 'state-1',
      nonce: 'nonce-1',
    });
    const broker = createDriftRuntimeAccountBrowserBroker();
    const result = await broker.begin({
      callbackUrl: 'http://127.0.0.1:9300/oauth/callback',
      timeoutMs: 60_000,
    });
    expect(beginLoginMock).toHaveBeenCalledTimes(1);
    const beginCall = (beginLoginMock.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(beginCall.caller).toEqual(
      expect.objectContaining({ appId: 'app.nimi.realm-drift' }),
    );
    expect(beginCall.redirectUri).toBe('http://127.0.0.1:9300/oauth/callback');
    expect(beginCall.callbackOrigin).toBe('http://127.0.0.1:9300');
    expect(result).toEqual({
      loginAttemptId: 'attempt-1',
      authorizationUrl: 'https://realm.test/api/auth/oauth/authorize?...',
      state: 'state-1',
      nonce: 'nonce-1',
    });
  });

  it('broker.begin throws when runtime rejects the request', async () => {
    beginLoginMock.mockResolvedValue({ accepted: false, accountReasonCode: 'CALLER_UNAUTHORIZED' });
    const broker = createDriftRuntimeAccountBrowserBroker();
    await expect(
      broker.begin({ callbackUrl: 'http://127.0.0.1:9300/oauth/callback', timeoutMs: 60_000 }),
    ).rejects.toThrow(/Runtime account login could not start/);
  });

  // -------------------------------------------------------------------------
  // RD-SHELL-010 / R-OAUTH-008: broker.complete is code-only, refreshToken=''
  // -------------------------------------------------------------------------

  it('broker.complete sends an empty refreshToken (R-OAUTH-008 / K-ACCSVC-008)', async () => {
    completeLoginMock.mockResolvedValue({
      accepted: true,
      accountProjection: { accountId: 'drift-user', displayName: 'Drift User' },
    });
    const broker = createDriftRuntimeAccountBrowserBroker();
    const result = await broker.complete({
      loginAttemptId: 'attempt-1',
      code: 'raw-oauth-code',
      state: 'state-1',
      nonce: 'nonce-1',
      callbackUrl: 'http://127.0.0.1:9300/oauth/callback',
    });
    expect(completeLoginMock).toHaveBeenCalledTimes(1);
    const completeCall = (completeLoginMock.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(completeCall.refreshToken).toBe('');
    expect(completeCall.code).toBe('raw-oauth-code');
    expect(completeCall.state).toBe('state-1');
    expect(completeCall.nonce).toBe('nonce-1');
    expect(completeCall.redirectUri).toBe('http://127.0.0.1:9300/oauth/callback');
    expect(completeCall.callbackOrigin).toBe('http://127.0.0.1:9300');
    expect(result).toEqual({
      user: { id: 'drift-user', displayName: 'Drift User' },
    });
  });

  it('broker.complete throws when runtime rejects the proof envelope', async () => {
    completeLoginMock.mockResolvedValue({ accepted: false, accountReasonCode: 'PROOF_UNSUPPORTED' });
    const broker = createDriftRuntimeAccountBrowserBroker();
    await expect(
      broker.complete({
        loginAttemptId: 'attempt-1',
        code: 'raw-code',
        state: 's',
        nonce: 'n',
        callbackUrl: 'http://127.0.0.1:9300/oauth/callback',
      }),
    ).rejects.toThrow(/Runtime account login could not complete/);
  });

  // -------------------------------------------------------------------------
  // RD-SHELL-004: realtime token projection via runtime.account.getAccessToken
  // -------------------------------------------------------------------------

  it('projectDriftRealtimeAccessToken returns the runtime-projected access token', async () => {
    getAccessTokenMock.mockResolvedValue({
      accepted: true,
      accessToken: 'short-lived-token',
      reasonCode: 0,
      accountReasonCode: 0,
    });
    const token = await projectDriftRealtimeAccessToken();
    expect(token).toBe('short-lived-token');
    expect(getAccessTokenMock).toHaveBeenCalledTimes(1);
    const call = (getAccessTokenMock.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(call.caller).toEqual(
      expect.objectContaining({ appId: 'app.nimi.realm-drift' }),
    );
  });

  it('projectDriftRealtimeAccessToken throws when runtime returns no token', async () => {
    getAccessTokenMock.mockResolvedValue({
      accepted: false,
      accessToken: '',
      accountReasonCode: 'ACCOUNT_UNAVAILABLE',
    });
    await expect(projectDriftRealtimeAccessToken()).rejects.toThrow(/Runtime account access token unavailable/);
  });

  // -------------------------------------------------------------------------
  // RD-SHELL-010 source-text static lock: no legacy auth paths
  // -------------------------------------------------------------------------

  it('auth adapter module does not import legacy shared desktop auth-session helpers', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, 'drift-auth-adapter.ts'), 'utf8');
    expect(source).not.toMatch(/persistSharedDesktopAuthSession/);
    expect(source).not.toMatch(/resolveDesktopBootstrapAuthSession/);
    expect(source).not.toMatch(/import\b[\s\S]*\b(loadAuthSession|saveAuthSession)\b[\s\S]*from\s+['"]@renderer\/bridge/);
    expect(source).not.toMatch(/import\b[\s\S]*\bclearAuthSession\s+as\s+clearPersistedAuthSession[\s\S]*from\s+['"]@renderer\/bridge/);
    expect(source).not.toMatch(/MeService\.getMe/);
    expect(source).not.toMatch(/realm\.updateAuth/);
    expect(source).not.toMatch(/realm\.config\.auth/);
    expect(source).not.toMatch(/refreshTokenProvider/);
    expect(source).not.toMatch(/accessTokenProvider/);
  });
});
