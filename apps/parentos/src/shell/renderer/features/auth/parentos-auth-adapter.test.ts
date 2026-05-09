/**
 * ParentOS auth adapter + runtime account broker regression tests
 * (PO-SHELL-008 / spec K-ACCSVC-008 / R-OAUTH-*).
 *
 * Locks:
 * - The adapter rejects every app-owned token surface (`applyToken`,
 *   `persistSession`) with PARENTOS_TOKEN_PROXY_FORBIDDEN — Runtime is the
 *   sole owner of access/refresh token custody.
 * - `loadCurrentUser` derives the user from the runtime account projection
 *   via `runtime.account.getAccountSessionStatus`, never via legacy
 *   `realm.MeService.getMe()`.
 * - The runtime broker `complete()` proof envelope is code-only — no
 *   accessToken / refreshToken / idToken on the wire (R-OAUTH-008).
 * - The runtime broker `begin()` returns the realm OAuth authorize URL
 *   constructed by runtime verbatim — no kit-side `desktop_callback`/
 *   `#/login` rebuild (Wave A1/A2 invariant).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AccountCallerMode,
  AccountSessionState,
} from '@nimiplatform/sdk/runtime/browser';

const mockGetAccountSessionStatus = vi.fn();
const mockBeginLogin = vi.fn();
const mockCompleteLogin = vi.fn();
const mockLogout = vi.fn();
const mockEnsureBootstrap = vi.fn(async () => undefined);

vi.mock('../../bridge/index.js', () => ({
  parentosTauriOAuthBridge: { openExternalUrl: vi.fn() },
}));

vi.mock('../../infra/parentos-bootstrap.js', async () => {
  const actual = await import('../../infra/parentos-bootstrap.js');
  return {
    ...actual,
    ensureParentOSBootstrapReady: mockEnsureBootstrap,
  };
});

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    runtime: {
      account: {
        getAccountSessionStatus: mockGetAccountSessionStatus,
        beginLogin: mockBeginLogin,
        completeLogin: mockCompleteLogin,
        logout: mockLogout,
      },
    },
  }),
}));

const {
  createParentOSDesktopBrowserAuthAdapter,
  createParentOSRuntimeAccountBrowserBroker,
  loadCurrentUser,
  logoutParentOSRuntimeAccount,
} = await import('./parentos-auth-adapter.js');

const PARENTOS_CALLER = {
  appId: 'app.nimi.parentos',
  appInstanceId: 'app.nimi.parentos.local-first-party',
  deviceId: 'local-first-party-device',
  mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
  scopes: [],
};

describe('parentos-auth-adapter (PO-SHELL-008)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applyToken fails-close — ParentOS does not own access/refresh token custody', async () => {
    const adapter = createParentOSDesktopBrowserAuthAdapter();
    await expect(adapter.applyToken('access-token', 'refresh-token')).rejects.toThrow(
      /does not own.*token custody/i,
    );
  });

  it('persistSession fails-close — Runtime owns custody, not ParentOS', async () => {
    const adapter = createParentOSDesktopBrowserAuthAdapter();
    await expect(
      adapter.persistSession?.({
        accessToken: 'access',
        refreshToken: 'refresh',
        user: { id: 'u' },
      }),
    ).rejects.toThrow(/does not own.*token custody/i);
  });

  it('loadCurrentUser derives the user from runtime.account.getAccountSessionStatus', async () => {
    mockGetAccountSessionStatus.mockResolvedValue({
      state: AccountSessionState.AUTHENTICATED,
      accountProjection: { accountId: 'acct-7', displayName: 'Seven' },
    });

    const user = await loadCurrentUser();

    expect(mockEnsureBootstrap).toHaveBeenCalledTimes(1);
    expect(mockGetAccountSessionStatus).toHaveBeenCalledWith({ caller: PARENTOS_CALLER });
    expect(user).toEqual({ id: 'acct-7', displayName: 'Seven' });
  });

  it('loadCurrentUser returns null when runtime account state is not AUTHENTICATED', async () => {
    mockGetAccountSessionStatus.mockResolvedValue({
      state: AccountSessionState.ANONYMOUS,
      accountProjection: null,
    });
    await expect(loadCurrentUser()).resolves.toBeNull();
  });

  it('logoutParentOSRuntimeAccount routes through runtime.account.logout with the parentos caller', async () => {
    mockLogout.mockResolvedValue({ accepted: true });
    await logoutParentOSRuntimeAccount();
    expect(mockLogout).toHaveBeenCalledWith({
      caller: PARENTOS_CALLER,
      reason: 'parentos_logout',
    });
  });
});

describe('createParentOSRuntimeAccountBrowserBroker (R-OAUTH-* / K-ACCSVC-008)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('begin returns the realm OAuth authorize URL constructed by runtime verbatim', async () => {
    const REALM_AUTHORIZE_URL =
      'https://realm.test/api/auth/oauth/authorize'
      + '?response_type=code&client_id=nimi-desktop'
      + '&redirect_uri=http%3A%2F%2F127.0.0.1%3A55501%2Foauth%2Fcallback'
      + '&code_challenge=runtime-challenge&code_challenge_method=S256'
      + '&state=runtime-state';
    mockBeginLogin.mockResolvedValue({
      accepted: true,
      loginAttemptId: 'attempt-x',
      oauthAuthorizationUrl: REALM_AUTHORIZE_URL,
      state: 'runtime-state',
      nonce: 'runtime-nonce',
    });

    const broker = createParentOSRuntimeAccountBrowserBroker();
    const result = await broker.begin({
      callbackUrl: 'http://127.0.0.1:55501/oauth/callback',
      timeoutMs: 60_000,
    });

    expect(result.authorizationUrl).toBe(REALM_AUTHORIZE_URL);
    expect(result.authorizationUrl).not.toContain('#/login');
    expect(result.authorizationUrl).not.toContain('desktop_callback=');
    expect(result.authorizationUrl).not.toContain('desktop_state=');
    expect(mockBeginLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        caller: PARENTOS_CALLER,
        redirectUri: 'http://127.0.0.1:55501/oauth/callback',
      }),
    );
  });

  it('begin fails-close when runtime omits authorization URL or attempt id', async () => {
    mockBeginLogin.mockResolvedValue({
      accepted: true,
      loginAttemptId: 'attempt-x',
      oauthAuthorizationUrl: '',
      state: 's',
      nonce: 'n',
    });
    const broker = createParentOSRuntimeAccountBrowserBroker();
    await expect(
      broker.begin({ callbackUrl: 'http://127.0.0.1:1234/oauth/callback', timeoutMs: 60_000 }),
    ).rejects.toThrow(/could not start/i);
  });

  it('complete sends a code-only proof envelope with empty refreshToken', async () => {
    mockCompleteLogin.mockResolvedValue({
      accepted: true,
      accountProjection: { accountId: 'acct-c', displayName: 'C' },
    });

    const broker = createParentOSRuntimeAccountBrowserBroker();
    const result = await broker.complete({
      loginAttemptId: 'attempt-x',
      code: 'oauth-code-abc',
      state: 'runtime-state',
      nonce: 'runtime-nonce',
      callbackUrl: 'http://127.0.0.1:55501/oauth/callback',
    });

    expect(result.user).toEqual({ id: 'acct-c', displayName: 'C' });
    expect(mockCompleteLogin).toHaveBeenCalledTimes(1);
    const completeArgs = mockCompleteLogin.mock.calls[0]![0] as Record<string, unknown>;
    // R-OAUTH-008: explicit empty refreshToken (runtime fail-closes any
    // non-empty value with PROOF_UNSUPPORTED).
    expect(completeArgs.refreshToken).toBe('');
    expect(completeArgs.code).toBe('oauth-code-abc');
    // R-OAUTH-009: code-only proof envelope; no token material on the wire.
    expect(completeArgs).not.toHaveProperty('accessToken');
    expect(completeArgs).not.toHaveProperty('idToken');
    expect(completeArgs).not.toHaveProperty('bearer');
    expect(completeArgs.caller).toEqual(PARENTOS_CALLER);
  });

  it('complete fails-close when runtime rejects (e.g. PROOF_UNSUPPORTED)', async () => {
    mockCompleteLogin.mockResolvedValue({
      accepted: false,
      accountReasonCode: 8, // PROOF_UNSUPPORTED
    });
    const broker = createParentOSRuntimeAccountBrowserBroker();
    await expect(
      broker.complete({
        loginAttemptId: 'attempt-x',
        code: 'c',
        state: 's',
        nonce: 'n',
        callbackUrl: 'http://127.0.0.1:1234/oauth/callback',
      }),
    ).rejects.toThrow(/could not complete/i);
  });
});

describe('parentos-login-page wiring (PO-SHELL-008)', () => {
  it('login page passes runtimeAccountBroker to DesktopShellAuthPage', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, 'parentos-login-page.tsx'), 'utf8');

    expect(source).toMatch(/createParentOSRuntimeAccountBrowserBroker\(\)/);
    expect(source).toMatch(/runtimeAccountBroker[,\s}]/);
    // PO-SHELL-008: legacy `desktop_callback` redirect block is dead.
    expect(source).not.toMatch(/buildDesktopWebAuthLaunchUrl/);
    expect(source).not.toMatch(/resolveDesktopCallbackRequestFromLocation/);
    // The kit's setAuthSession is invoked with no token material.
    expect(source).not.toMatch(/setAuthSession\([^,]+,[\s\S]+token[\s\S]+refreshToken/);
  });
});
