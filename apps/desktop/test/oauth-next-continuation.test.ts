/**
 * Wave A-fix: R-OAUTH-011 split UI/API topology.
 *
 * The web shell `/login` page receives `?oauth_next=<absolute-API-URL>`
 * from the realm API authorize endpoint when /authorize is hit unauth.
 * After login, the web shell navigates the user agent BACK to the API
 * authorize URL via `window.location.assign(oauth_next)`.
 *
 * The web shell is a UI continuation only:
 * - it does NOT parse the OAuth `code`
 * - it does NOT receive a refresh token
 * - it does NOT call the token exchange endpoint
 * - it does NOT relay tokens
 *
 * `oauth_next` MUST be allowlisted against the realm/API origin known to
 * the web shell (`VITE_NIMI_REALM_BASE_URL` or `NIMI_REALM_URL` build-time
 * env). URLs that do not match the allowlisted origin are silently dropped
 * to prevent open-redirect abuse.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// In Node `node:test` runtime, the helper falls back to `process.env` for
// the realm-origin allowlist (Vite supplies `import.meta.env` at build time;
// Node has no equivalent here). Set BEFORE importing the helper.
process.env['VITE_NIMI_REALM_BASE_URL'] = 'https://api.example.test';

const {
  readValidatedOauthNext,
  readFreshOauthLoginState,
  continueOauthNextIfPresent,
} = await import('../src/shell/renderer/features/auth/oauth-next-continuation.js');

// ---------------------------------------------------------------------------
// readValidatedOauthNext - validation behavior
// ---------------------------------------------------------------------------

test('readValidatedOauthNext returns the URL when oauth_next matches the realm origin allowlist', () => {
  const search = '?oauth_next=' + encodeURIComponent(
    'https://api.example.test/api/auth/oauth/authorize?client_id=nimi-desktop',
  );
  const next = readValidatedOauthNext(search);
  assert.equal(
    next,
    'https://api.example.test/api/auth/oauth/authorize?client_id=nimi-desktop',
  );
});

test('readValidatedOauthNext rejects oauth_next on a different origin (open-redirect defense)', () => {
  const search = '?oauth_next=' + encodeURIComponent('https://attacker.example/path?steal=1');
  assert.equal(readValidatedOauthNext(search), null);
});

test('readValidatedOauthNext rejects relative oauth_next (must be absolute)', () => {
  const search = '?oauth_next=' + encodeURIComponent('/api/auth/oauth/authorize?x=1');
  assert.equal(readValidatedOauthNext(search), null);
});

test('readValidatedOauthNext rejects non-http(s) protocols', () => {
  const search = '?oauth_next=' + encodeURIComponent('javascript:alert(1)');
  assert.equal(readValidatedOauthNext(search), null);
});

test('readValidatedOauthNext returns null when oauth_next is absent', () => {
  assert.equal(readValidatedOauthNext(''), null);
  assert.equal(readValidatedOauthNext('?other=value'), null);
});

test('readValidatedOauthNext does NOT honour generic `next` param (only `oauth_next`)', () => {
  const search = '?next=' + encodeURIComponent('https://api.example.test/api/auth/oauth/authorize');
  assert.equal(readValidatedOauthNext(search), null);
});

test('readFreshOauthLoginState detects prompt=login OAuth continuation only when fresh_oauth is explicit', () => {
  const oauthNext = 'https://api.example.test/api/auth/oauth/authorize?client_id=nimi-desktop&prompt=login&state=state-123';
  const search = '?fresh_oauth=1&oauth_next=' + encodeURIComponent(oauthNext);
  assert.equal(readFreshOauthLoginState(search), 'state-123');
  assert.equal(readFreshOauthLoginState('?oauth_next=' + encodeURIComponent(oauthNext)), null);
  assert.equal(
    readFreshOauthLoginState('?fresh_oauth=1&oauth_next=' + encodeURIComponent(
      'https://api.example.test/api/auth/oauth/authorize?client_id=nimi-desktop&state=state-123',
    )),
    null,
  );
});

// ---------------------------------------------------------------------------
// continueOauthNextIfPresent - navigation behavior
// ---------------------------------------------------------------------------

function withMockedWindow<T>(fn: (assignSpy: { calls: unknown[][] }) => T): T {
  const calls: unknown[][] = [];
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    location: {
      assign: (...args: unknown[]) => {
        calls.push(args);
      },
      search: '',
    },
  };
  try {
    return fn({ calls });
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
  }
}

test('continueOauthNextIfPresent issues window.location.assign(oauth_next) when oauth_next is allowlisted', () => {
  withMockedWindow(({ calls }) => {
    const search = '?oauth_next=' + encodeURIComponent(
      'https://api.example.test/api/auth/oauth/authorize?client_id=nimi-desktop&state=abc',
    );
    const continued = continueOauthNextIfPresent(search);
    assert.equal(continued, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], [
      'https://api.example.test/api/auth/oauth/authorize?client_id=nimi-desktop&state=abc',
    ]);
  });
});

test('continueOauthNextIfPresent does not navigate when oauth_next is on a different origin', () => {
  withMockedWindow(({ calls }) => {
    const search = '?oauth_next=' + encodeURIComponent('https://attacker.example/');
    const continued = continueOauthNextIfPresent(search);
    assert.equal(continued, false);
    assert.equal(calls.length, 0);
  });
});

test('continueOauthNextIfPresent does not navigate when oauth_next is missing', () => {
  withMockedWindow(({ calls }) => {
    const continued = continueOauthNextIfPresent('?something=else');
    assert.equal(continued, false);
    assert.equal(calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Regression locks - web shell is UI continuation only.
// ---------------------------------------------------------------------------

test('helper module does NOT parse OAuth code, refresh tokens, or token exchange (web is UI continuation only)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const moduleSrc = readFileSync(
    path.resolve(here, '../src/shell/renderer/features/auth/oauth-next-continuation.ts'),
    'utf8',
  );
  // R-OAUTH-011: the web continuation MUST NOT touch any OAuth code/token
  // surface. These tokens are searched against the helper source so a
  // future regression that pulls token-handling into the helper trips
  // immediately.
  assert.equal(/[?&]code=/.test(moduleSrc), false, 'must not read OAuth code from query');
  assert.equal(/\bcode_verifier\b/.test(moduleSrc), false, 'must not handle code_verifier');
  assert.equal(/\boauth\/token\b/.test(moduleSrc), false, 'must not call /oauth/token');
  assert.equal(/\boauthTokenExchange\b/.test(moduleSrc), false, 'must not invoke token exchange');
  assert.equal(/\brefresh_token\b/.test(moduleSrc), false, 'must not handle refresh_token');
  assert.equal(/\brefreshToken\b/.test(moduleSrc), false, 'must not handle refreshToken');
  assert.equal(/\baccessToken\b/.test(moduleSrc), false, 'must not handle accessToken');
  assert.equal(/Authorization:\s*Bearer\b/.test(moduleSrc), false, 'must not send Bearer auth');
  // Wave C web-relay was retired; helper MUST NOT introduce desktop_callback.
  assert.equal(/\bdesktop_callback\b/.test(moduleSrc), false, 'must not reintroduce desktop_callback');
});
