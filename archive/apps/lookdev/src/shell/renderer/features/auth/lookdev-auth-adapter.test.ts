/**
 * Lookdev auth adapter regression tests (LD-SHELL-010 / LD-SHELL-011 /
 * LD-SHELL-012). Locks the RuntimeAccountService boundary:
 *
 * - `applyToken`/`persistSession` MUST throw LOOKDEV_TOKEN_PROXY_FORBIDDEN.
 *   App-owned token custody is a contract violation.
 * - `clearPersistedSession` MUST go through `runtime.account.logout`, not
 *   any persisted shared desktop auth-session bridge.
 * - `loadCurrentUser` MUST resolve from the runtime account projection
 *   (`getAccountSessionStatus`), never from `realm.services.MeService.getMe`.
 * - The browser broker `begin` MUST return the realm OAuth authorize URL
 *   minted by runtime; `complete` MUST send a code-only proof envelope with
 *   `refreshToken: ''`. R-OAUTH-008 / spec K-ACCSVC-008.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AccountSessionState,
} from '@nimiplatform/sdk/runtime/browser';

const ensureLookdevBootstrapReadyMock = vi.fn(async () => undefined);
const getAccountSessionStatusMock = vi.fn();
const beginLoginMock = vi.fn();
const completeLoginMock = vi.fn();
const logoutMock = vi.fn(async () => undefined);

vi.mock('@renderer/bridge', () => ({
  lookdevTauriOAuthBridge: { openExternalUrl: vi.fn() },
}));

vi.mock('@renderer/infra/bootstrap/lookdev-bootstrap.js', async () => {
  const browser = await import('@nimiplatform/sdk/runtime/browser');
  return {
    ensureLookdevBootstrapReady: ensureLookdevBootstrapReadyMock,
    lookdevRuntimeAccountCaller: {
      appId: 'app.nimi.lookdev',
      appInstanceId: 'app.nimi.lookdev.local-first-party',
      deviceId: 'local-first-party-device',
      mode: browser.AccountCallerMode.LOCAL_FIRST_PARTY_APP,
      scopes: [],
    },
    loadLookdevRuntimeAccountUser: async () => {
      const response = await getAccountSessionStatusMock({
        caller: {
          appId: 'app.nimi.lookdev',
          appInstanceId: 'app.nimi.lookdev.local-first-party',
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
  createLookdevDesktopBrowserAuthAdapter,
  createLookdevRuntimeAccountBrowserBroker,
  loadLookdevCurrentUser,
  logoutLookdevRuntimeAccount,
} = await import('./lookdev-auth-adapter.js');

describe('lookdev-auth-adapter (LD-SHELL-010 / LD-SHELL-011 / LD-SHELL-012)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // LD-SHELL-011: applyToken / persistSession MUST fail-close
  // -------------------------------------------------------------------------

  it('applyToken throws LOOKDEV_TOKEN_PROXY_FORBIDDEN — runtime owns custody', async () => {
    const adapter = createLookdevDesktopBrowserAuthAdapter();
    await expect(adapter.applyToken!('access-token', 'refresh-token')).rejects.toThrow(/LD-SHELL-011|K-ACCSVC-008|token custody/);
  });

  it('persistSession throws LOOKDEV_TOKEN_PROXY_FORBIDDEN', async () => {
    const adapter = createLookdevDesktopBrowserAuthAdapter();
    await expect(
      adapter.persistSession!({ accessToken: 'a', refreshToken: 'r', user: { id: 'u' } } as any),
    ).rejects.toThrow(/LD-SHELL-011|K-ACCSVC-008|token custody/);
  });

  // -------------------------------------------------------------------------
  // LD-SHELL-012 / LD-SHELL-011: every embedded auth path is unsupported
  // -------------------------------------------------------------------------

  it('every embedded login path is unsupported in desktop-browser mode', async () => {
    const adapter = createLookdevDesktopBrowserAuthAdapter();
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
  // LD-SHELL-012: loadCurrentUser comes from runtime projection
  // -------------------------------------------------------------------------

  it('loadCurrentUser projects from runtime.account.getAccountSessionStatus', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.AUTHENTICATED,
      accountProjection: { accountId: 'lookdev-user', displayName: 'Lookdev User' },
    });
    await expect(loadLookdevCurrentUser()).resolves.toEqual({
      id: 'lookdev-user',
      displayName: 'Lookdev User',
    });
    expect(ensureLookdevBootstrapReadyMock).toHaveBeenCalled();
  });

  it('loadCurrentUser returns null when runtime account is ANONYMOUS', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.ANONYMOUS,
      accountProjection: null,
    });
    await expect(loadLookdevCurrentUser()).resolves.toBeNull();
  });

  // -------------------------------------------------------------------------
  // LD-SHELL-012: clearPersistedSession routes to runtime logout
  // -------------------------------------------------------------------------

  it('clearPersistedSession calls runtime.account.logout, not a shared bridge', async () => {
    const adapter = createLookdevDesktopBrowserAuthAdapter();
    await adapter.clearPersistedSession!();
    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(logoutMock).toHaveBeenCalledWith({
      caller: expect.objectContaining({
        appId: 'app.nimi.lookdev',
        appInstanceId: 'app.nimi.lookdev.local-first-party',
      }),
      reason: 'lookdev_logout',
    });
  });

  it('logoutLookdevRuntimeAccount() invokes runtime.account.logout once', async () => {
    await logoutLookdevRuntimeAccount();
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // LD-SHELL-010: broker.begin uses the realm OAuth authorize URL from runtime
  // -------------------------------------------------------------------------

  it('broker.begin calls runtime.account.beginLogin with the fixed Lookdev caller', async () => {
    beginLoginMock.mockResolvedValue({
      accepted: true,
      loginAttemptId: 'attempt-1',
      oauthAuthorizationUrl: 'https://realm.test/api/auth/oauth/authorize?...',
      state: 'state-1',
      nonce: 'nonce-1',
    });
    const broker = createLookdevRuntimeAccountBrowserBroker();
    const result = await broker.begin({
      callbackUrl: 'http://127.0.0.1:9100/oauth/callback',
      timeoutMs: 60_000,
    });
    expect(beginLoginMock).toHaveBeenCalledTimes(1);
    const beginCall = (beginLoginMock.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(beginCall.caller).toEqual(
      expect.objectContaining({ appId: 'app.nimi.lookdev' }),
    );
    expect(beginCall.redirectUri).toBe('http://127.0.0.1:9100/oauth/callback');
    expect(beginCall.callbackOrigin).toBe('http://127.0.0.1:9100');
    expect(result).toEqual({
      loginAttemptId: 'attempt-1',
      authorizationUrl: 'https://realm.test/api/auth/oauth/authorize?...',
      state: 'state-1',
      nonce: 'nonce-1',
    });
  });

  it('broker.begin throws when runtime rejects the request', async () => {
    beginLoginMock.mockResolvedValue({ accepted: false, accountReasonCode: 'CALLER_UNAUTHORIZED' });
    const broker = createLookdevRuntimeAccountBrowserBroker();
    await expect(
      broker.begin({ callbackUrl: 'http://127.0.0.1:9100/oauth/callback', timeoutMs: 60_000 }),
    ).rejects.toThrow(/Runtime account login could not start/);
  });

  // -------------------------------------------------------------------------
  // LD-SHELL-011 / R-OAUTH-008: broker.complete is code-only, refreshToken=''
  // -------------------------------------------------------------------------

  it('broker.complete sends an empty refreshToken (R-OAUTH-008 / K-ACCSVC-008)', async () => {
    completeLoginMock.mockResolvedValue({
      accepted: true,
      accountProjection: { accountId: 'lookdev-user', displayName: 'Lookdev User' },
    });
    const broker = createLookdevRuntimeAccountBrowserBroker();
    const result = await broker.complete({
      loginAttemptId: 'attempt-1',
      code: 'raw-oauth-code',
      state: 'state-1',
      nonce: 'nonce-1',
      callbackUrl: 'http://127.0.0.1:9100/oauth/callback',
    });
    expect(completeLoginMock).toHaveBeenCalledTimes(1);
    const completeCall = (completeLoginMock.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(completeCall.refreshToken).toBe('');
    expect(completeCall.code).toBe('raw-oauth-code');
    expect(completeCall.state).toBe('state-1');
    expect(completeCall.nonce).toBe('nonce-1');
    expect(completeCall.redirectUri).toBe('http://127.0.0.1:9100/oauth/callback');
    expect(completeCall.callbackOrigin).toBe('http://127.0.0.1:9100');
    expect(result).toEqual({
      user: { id: 'lookdev-user', displayName: 'Lookdev User' },
    });
  });

  it('broker.complete throws when runtime rejects the proof envelope', async () => {
    completeLoginMock.mockResolvedValue({ accepted: false, accountReasonCode: 'PROOF_UNSUPPORTED' });
    const broker = createLookdevRuntimeAccountBrowserBroker();
    await expect(
      broker.complete({
        loginAttemptId: 'attempt-1',
        code: 'raw-code',
        state: 's',
        nonce: 'n',
        callbackUrl: 'http://127.0.0.1:9100/oauth/callback',
      }),
    ).rejects.toThrow(/Runtime account login could not complete/);
  });

  // -------------------------------------------------------------------------
  // LD-SHELL-011 source-text static lock: no legacy auth paths
  // -------------------------------------------------------------------------

  it('auth adapter module does not import legacy shared desktop auth-session helpers', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, 'lookdev-auth-adapter.ts'), 'utf8');
    expect(source).not.toMatch(/persistSharedDesktopAuthSession/);
    expect(source).not.toMatch(/resolveDesktopBootstrapAuthSession/);
    expect(source).not.toMatch(/import\b[\s\S]*\b(loadAuthSession|saveAuthSession)\b[\s\S]*from\s+['"]@renderer\/bridge/);
    expect(source).not.toMatch(/import\b[\s\S]*\bclearAuthSession\s+as\s+clearPersistedAuthSession[\s\S]*from\s+['"]@renderer\/bridge/);
    expect(source).not.toMatch(/MeService\.getMe/);
    expect(source).not.toMatch(/realm\.updateAuth/);
    expect(source).not.toMatch(/refreshTokenProvider/);
    expect(source).not.toMatch(/accessTokenProvider/);
  });
});
