/**
 * Overtone auth adapter regression tests.
 *
 * Locks the RuntimeAccountService boundary (spec K-ACCSVC-008,
 * apps/overtone/spec/architecture.md §"Auth & Runtime Account"):
 *
 * - `applyToken`/`persistSession` MUST throw OVERTONE_TOKEN_PROXY_FORBIDDEN.
 *   App-owned token custody is a contract violation.
 * - Every embedded login path MUST be unsupported.
 * - `clearPersistedSession` MUST go through `runtime.account.logout`.
 * - `loadCurrentUser` MUST resolve from the runtime account projection
 *   (`getAccountSessionStatus`), never from `domains.auth.getCurrentUser`
 *   or `MeService.getMe`.
 * - The browser broker `complete` MUST send a code-only proof envelope with
 *   `refreshToken: ''` (R-OAUTH-008).
 * - Source-text static lock: the adapter MUST NOT read the legacy
 *   `VITE_NIMI_REALM_ACCESS_TOKEN` env-token shortcut, and MUST NOT call
 *   the deleted `ensureOvertonePlatformClient` / `currentAccessToken`
 *   helpers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AccountSessionState,
} from '@nimiplatform/sdk/runtime/browser';

const ensureOvertoneBootstrapReadyMock = vi.fn(async () => undefined);
const getAccountSessionStatusMock = vi.fn();
const beginLoginMock = vi.fn();
const completeLoginMock = vi.fn();
const logoutMock = vi.fn(async () => undefined);

vi.mock('@renderer/bridge/oauth.js', () => ({
  overtoneTauriOAuthBridge: { openExternalUrl: vi.fn() },
}));

vi.mock('@renderer/infra/bootstrap/overtone-bootstrap.js', async () => {
  const browser = await import('@nimiplatform/sdk/runtime/browser');
  return {
    ensureOvertoneBootstrapReady: ensureOvertoneBootstrapReadyMock,
    overtoneRuntimeAccountCaller: {
      appId: 'app.nimi.overtone',
      appInstanceId: 'app.nimi.overtone.local-first-party',
      deviceId: 'local-first-party-device',
      mode: browser.AccountCallerMode.LOCAL_FIRST_PARTY_APP,
      scopes: [],
    },
    loadOvertoneRuntimeAccountUser: async () => {
      const response = await getAccountSessionStatusMock({
        caller: {
          appId: 'app.nimi.overtone',
          appInstanceId: 'app.nimi.overtone.local-first-party',
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
      },
    },
  }),
}));

const {
  createOvertoneDesktopBrowserAuthAdapter,
  createOvertoneRuntimeAccountBrowserBroker,
  loadOvertoneCurrentUser,
  logoutOvertoneRuntimeAccount,
} = await import('./overtone-auth-adapter.js');

describe('overtone-auth-adapter (RuntimeAccountService boundary)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // applyToken / persistSession MUST fail-close
  // -------------------------------------------------------------------------

  it('applyToken throws OVERTONE_TOKEN_PROXY_FORBIDDEN — runtime owns custody', async () => {
    const adapter = createOvertoneDesktopBrowserAuthAdapter();
    await expect(adapter.applyToken!('access-token', 'refresh-token')).rejects.toThrow(/K-ACCSVC-008|token custody/);
  });

  it('persistSession throws OVERTONE_TOKEN_PROXY_FORBIDDEN', async () => {
    const adapter = createOvertoneDesktopBrowserAuthAdapter();
    await expect(
      adapter.persistSession!({ accessToken: 'a', refreshToken: 'r', user: { id: 'u' } } as any),
    ).rejects.toThrow(/K-ACCSVC-008|token custody/);
  });

  // -------------------------------------------------------------------------
  // Every embedded auth path is unsupported
  // -------------------------------------------------------------------------

  it('every embedded login path is unsupported in desktop-browser mode', async () => {
    const adapter = createOvertoneDesktopBrowserAuthAdapter();
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
  // loadCurrentUser comes from runtime projection
  // -------------------------------------------------------------------------

  it('loadCurrentUser projects from runtime.account.getAccountSessionStatus', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.AUTHENTICATED,
      accountProjection: { accountId: 'overtone-user', displayName: 'Overtone User' },
    });
    await expect(loadOvertoneCurrentUser()).resolves.toEqual({
      id: 'overtone-user',
      displayName: 'Overtone User',
    });
    expect(ensureOvertoneBootstrapReadyMock).toHaveBeenCalled();
  });

  it('loadCurrentUser returns null when runtime account is ANONYMOUS', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.ANONYMOUS,
      accountProjection: null,
    });
    await expect(loadOvertoneCurrentUser()).resolves.toBeNull();
  });

  // -------------------------------------------------------------------------
  // clearPersistedSession routes to runtime logout
  // -------------------------------------------------------------------------

  it('clearPersistedSession calls runtime.account.logout', async () => {
    const adapter = createOvertoneDesktopBrowserAuthAdapter();
    await adapter.clearPersistedSession!();
    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(logoutMock).toHaveBeenCalledWith({
      caller: expect.objectContaining({
        appId: 'app.nimi.overtone',
        appInstanceId: 'app.nimi.overtone.local-first-party',
      }),
      reason: 'overtone_logout',
    });
  });

  it('logoutOvertoneRuntimeAccount() invokes runtime.account.logout once', async () => {
    await logoutOvertoneRuntimeAccount();
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // broker.begin uses the realm OAuth authorize URL from runtime
  // -------------------------------------------------------------------------

  it('broker.begin calls runtime.account.beginLogin with the fixed Overtone caller', async () => {
    beginLoginMock.mockResolvedValue({
      accepted: true,
      loginAttemptId: 'attempt-1',
      oauthAuthorizationUrl: 'https://realm.test/api/auth/oauth/authorize?...',
      state: 'state-1',
      nonce: 'nonce-1',
    });
    const broker = createOvertoneRuntimeAccountBrowserBroker();
    const result = await broker.begin({
      callbackUrl: 'http://127.0.0.1:9400/oauth/callback',
      timeoutMs: 60_000,
    });
    expect(beginLoginMock).toHaveBeenCalledTimes(1);
    const beginCall = (beginLoginMock.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(beginCall.caller).toEqual(
      expect.objectContaining({ appId: 'app.nimi.overtone' }),
    );
    expect(beginCall.redirectUri).toBe('http://127.0.0.1:9400/oauth/callback');
    expect(beginCall.callbackOrigin).toBe('http://127.0.0.1:9400');
    expect(result).toEqual({
      loginAttemptId: 'attempt-1',
      authorizationUrl: 'https://realm.test/api/auth/oauth/authorize?...',
      state: 'state-1',
      nonce: 'nonce-1',
    });
  });

  it('broker.begin throws when runtime rejects the request', async () => {
    beginLoginMock.mockResolvedValue({ accepted: false, accountReasonCode: 'CALLER_UNAUTHORIZED' });
    const broker = createOvertoneRuntimeAccountBrowserBroker();
    await expect(
      broker.begin({ callbackUrl: 'http://127.0.0.1:9400/oauth/callback', timeoutMs: 60_000 }),
    ).rejects.toThrow(/Runtime account login could not start/);
  });

  // -------------------------------------------------------------------------
  // R-OAUTH-008: broker.complete is code-only, refreshToken=''
  // -------------------------------------------------------------------------

  it('broker.complete sends an empty refreshToken (R-OAUTH-008 / K-ACCSVC-008)', async () => {
    completeLoginMock.mockResolvedValue({
      accepted: true,
      accountProjection: { accountId: 'overtone-user', displayName: 'Overtone User' },
    });
    const broker = createOvertoneRuntimeAccountBrowserBroker();
    const result = await broker.complete({
      loginAttemptId: 'attempt-1',
      code: 'raw-oauth-code',
      state: 'state-1',
      nonce: 'nonce-1',
      callbackUrl: 'http://127.0.0.1:9400/oauth/callback',
    });
    expect(completeLoginMock).toHaveBeenCalledTimes(1);
    const completeCall = (completeLoginMock.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(completeCall.refreshToken).toBe('');
    expect(completeCall.code).toBe('raw-oauth-code');
    expect(completeCall.state).toBe('state-1');
    expect(completeCall.nonce).toBe('nonce-1');
    expect(completeCall.redirectUri).toBe('http://127.0.0.1:9400/oauth/callback');
    expect(completeCall.callbackOrigin).toBe('http://127.0.0.1:9400');
    expect(result).toEqual({
      user: { id: 'overtone-user', displayName: 'Overtone User' },
    });
  });

  it('broker.complete throws when runtime rejects the proof envelope', async () => {
    completeLoginMock.mockResolvedValue({ accepted: false, accountReasonCode: 'PROOF_UNSUPPORTED' });
    const broker = createOvertoneRuntimeAccountBrowserBroker();
    await expect(
      broker.complete({
        loginAttemptId: 'attempt-1',
        code: 'raw-code',
        state: 's',
        nonce: 'n',
        callbackUrl: 'http://127.0.0.1:9400/oauth/callback',
      }),
    ).rejects.toThrow(/Runtime account login could not complete/);
  });

  // -------------------------------------------------------------------------
  // Source-text static lock: no legacy auth paths, no env-token shortcut
  // -------------------------------------------------------------------------

  it('auth adapter module does not import legacy shared desktop auth-session helpers', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, 'overtone-auth-adapter.ts'), 'utf8');
    expect(source).not.toMatch(/persistSharedDesktopAuthSession/);
    expect(source).not.toMatch(/resolveDesktopBootstrapAuthSession/);
    expect(source).not.toMatch(/import\b[\s\S]*\b(loadAuthSession|saveAuthSession)\b[\s\S]*from\s+['"]@renderer\/bridge/);
    expect(source).not.toMatch(/MeService\.getMe/);
    expect(source).not.toMatch(/domains\.auth\.getCurrentUser/);
    expect(source).not.toMatch(/realm\.updateAuth/);
    expect(source).not.toMatch(/realm\.config\.auth/);
    expect(source).not.toMatch(/refreshTokenProvider/);
    expect(source).not.toMatch(/accessTokenProvider/);
    // The adapter MUST NOT carry a module-level token cache or re-construct
    // the platform client on every call (legacy ensureOvertonePlatformClient
    // pattern).
    expect(source).not.toMatch(/\bcurrentAccessToken\b/);
    expect(source).not.toMatch(/\bensureOvertonePlatformClient\b/);
    expect(source).not.toMatch(/\bclearOvertonePlatformClient\b/);
    // Wave A-fix constraint: VITE_NIMI_REALM_ACCESS_TOKEN env-token shortcut
    // is forbidden in renderer code. The bearer-token "dev convenience" path
    // is removed; no new path may bypass the runtime broker login.
    expect(source).not.toMatch(/VITE_NIMI_REALM_ACCESS_TOKEN/);
    // The adapter MUST use the SDK helper, not the legacy createPlatformClient
    // constructor.
    expect(source).not.toMatch(/\bcreatePlatformClient\s*\(/);
  });
});
