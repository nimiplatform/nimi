/**
 * The Kit/Desktop boundary must not exchange OAuth
 * provider tokens or persist a session in the desktop login path. The realm
 * RuntimeAccountService owns the code → token exchange and refresh-token custody; Kit only
 * delivers the user agent to the realm authorize URL and waits for the realm
 * to redirect directly to the desktop loopback.
 *
 * Any future refactor that re-introduces a web bearer relay, applyToken on
 * desktop_callback, persistSession of refresh tokens, or a fallback authorize
 * URL constructed from the kit must fail this test.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  performDesktopBrowserAuth,
  validateRuntimeOAuthAuthorizationUrl,
} from '../auth/src/logic/desktop-browser-auth.js';

// ---------------------------------------------------------------------------
// Desktop browser auth must use the Realm
// OAuth authorize URL constructed by runtime BeginLogin verbatim, must NOT
// fall back to a kit-built `desktop_callback`/`#/login` URL, and the runtime
// broker.complete proof envelope must be code-only.
// ---------------------------------------------------------------------------

describe('performDesktopBrowserAuth direct-to-loopback flow', () => {
  function buildBridge(callbackResponse: { code?: string; state?: string; error?: string }) {
    const opens: string[] = [];
    return {
      bridge: {
        hasShellHostInvoke: () => true,
        openExternalUrl: async (url: string) => {
          opens.push(url);
          return { opened: true };
        },
        oauthListenForCode: async () => ({
          callbackUrl: '',
          code: callbackResponse.code || '',
          state: callbackResponse.state || '',
          error: callbackResponse.error || '',
        }),
        focusMainWindow: async () => undefined,
      },
      opens,
    };
  }

  it('opens the runtime-supplied authorize URL verbatim and never builds a #/login fallback', async () => {
    const REALM_AUTHORIZE_URL =
      'https://realm.nimi.test/api/auth/oauth/authorize'
      + '?response_type=code'
      + '&client_id=nimi-desktop'
      + '&redirect_uri=http%3A%2F%2F127.0.0.1%3A55501%2Foauth%2Fcallback'
      + '&code_challenge=runtime-challenge'
      + '&code_challenge_method=S256'
      + '&state=runtime-state-001';

    const { bridge, opens } = buildBridge({ code: 'oauth-code-001', state: 'runtime-state-001' });
    const completeSpy = vi.fn(async () => ({ user: { id: 'acct-1', displayName: 'Acct 1' } }));

    const result = await performDesktopBrowserAuth(bridge, {
      runtimeAccountBroker: {
        begin: async () => ({
          loginAttemptId: 'attempt-1',
          authorizationUrl: REALM_AUTHORIZE_URL,
          state: 'runtime-state-001',
          nonce: 'nonce-001',
        }),
        complete: completeSpy,
      },
    });

    // Authorize URL is delivered verbatim — no fragment, no desktop_callback,
    // no #/login.
    expect(opens.length).toBe(1);
    expect(opens[0]).toBe(REALM_AUTHORIZE_URL);
    expect(opens[0]).not.toContain('#/login');
    expect(opens[0]).not.toContain('desktop_callback=');
    expect(opens[0]).not.toContain('desktop_state=');

    // runtime broker.complete is called with code-only proof envelope.
    expect(completeSpy).toHaveBeenCalledTimes(1);
    const completeCall = (completeSpy.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(Object.keys(completeCall).sort()).toEqual(
      ['callbackUrl', 'code', 'loginAttemptId', 'nonce', 'state'].sort(),
    );
    expect(completeCall['code']).toBe('oauth-code-001');
    expect(completeCall).not.toHaveProperty('accessToken');
    expect(completeCall).not.toHaveProperty('refreshToken');
    expect(completeCall).not.toHaveProperty('idToken');

    expect(result.user).toEqual({ id: 'acct-1', displayName: 'Acct 1' });
  });

  it('validates runtime-supplied authorize URLs as the shared Kit shell primitive', () => {
    expect(validateRuntimeOAuthAuthorizationUrl(
      'https://realm.nimi.test/api/auth/oauth/authorize?response_type=code&client_id=nimi-desktop',
    )).toBe('https://realm.nimi.test/api/auth/oauth/authorize?response_type=code&client_id=nimi-desktop');
    expect(validateRuntimeOAuthAuthorizationUrl(
      'http://127.0.0.1:3002/api/auth/oauth/authorize?response_type=code&client_id=nimi-desktop',
    )).toBe('http://127.0.0.1:3002/api/auth/oauth/authorize?response_type=code&client_id=nimi-desktop');
    for (const value of [
      '',
      'not a url',
      'file:///tmp/login',
      'http://realm.nimi.test/api/auth/oauth/authorize?state=s',
      'https://realm.nimi.test/relay/oauth/authorize?state=s',
      'https://auth.nimi.invalid/oauth/authorize?state=s&challenge=c',
      'https://realm.nimi.test/api/auth/oauth/token',
      'https://realm.nimi.test/api/auth/oauth/authorize#/login',
      'https://realm.nimi.test/api/auth/oauth/authorize?desktop_callback=http%3A%2F%2Flocalhost',
      'https://realm.nimi.test/api/auth/oauth/authorize?desktop_state=state',
    ]) {
      expect(() => validateRuntimeOAuthAuthorizationUrl(value)).toThrow(/Runtime account login/);
    }
  });

  it('fails-close when runtime broker omits the authorization URL (no fallback)', async () => {
    const { bridge } = buildBridge({});
    await expect(
      performDesktopBrowserAuth(bridge, {
        runtimeAccountBroker: {
          begin: async () => ({
            loginAttemptId: 'attempt-2',
            authorizationUrl: '',
            state: 'state-2',
            nonce: 'nonce-2',
          }),
          complete: async () => ({ user: null }),
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects state mismatch from loopback callback', async () => {
    const { bridge } = buildBridge({ code: 'c', state: 'WRONG-STATE' });
    await expect(
      performDesktopBrowserAuth(bridge, {
        runtimeAccountBroker: {
          begin: async () => ({
            loginAttemptId: 'attempt-3',
            authorizationUrl: 'https://realm.nimi.test/api/auth/oauth/authorize',
            state: 'expected-state',
            nonce: 'n',
          }),
          complete: async () => ({ user: null }),
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects empty code from loopback callback', async () => {
    const { bridge } = buildBridge({ code: '', state: 's' });
    await expect(
      performDesktopBrowserAuth(bridge, {
        runtimeAccountBroker: {
          begin: async () => ({
            loginAttemptId: 'attempt-4',
            authorizationUrl: 'https://realm.nimi.test/api/auth/oauth/authorize',
            state: 's',
            nonce: 'n',
          }),
          complete: async () => ({ user: null }),
        },
      }),
    ).rejects.toThrow();
  });
});
