import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const authAdapterSource = readFileSync(
  new URL('../src/shell/renderer/features/auth/desktop-auth-adapter.ts', import.meta.url),
  'utf8',
);
const loginPageSource = readFileSync(
  new URL('../src/shell/renderer/features/auth/login-page.tsx', import.meta.url),
  'utf8',
);
const webAuthMenuSource = readFileSync(
  new URL('../src/shell/renderer/features/auth/web-auth-menu.tsx', import.meta.url),
  'utf8',
);

test('desktop auth adapter guards Runtime-backed auth API calls behind bootstrap readiness', () => {
  assert.ok(
    authAdapterSource.includes('export async function ensureAuthApiReady(): Promise<void>'),
    'desktop auth adapter must expose ensureAuthApiReady()',
  );
  assert.ok(
    authAdapterSource.includes('supportsPasswordLogin: false'),
    'password login must not be exposed by the Desktop renderer',
  );
  assert.doesNotMatch(authAdapterSource, /isRealmAuthSurfaceEnabled/);

  assert.match(
    authAdapterSource,
    /throw new Error\(`Desktop \$\{route\} is owned by RuntimeAccountService`\)/,
  );
  for (const handlerName of [
    'checkEmail',
    'passwordLogin',
    'requestEmailOtp',
    'verifyEmailOtp',
    'verifyTwoFactor',
    'walletChallenge',
    'walletLogin',
    'oauthLogin',
  ]) {
    const start = authAdapterSource.indexOf(`${handlerName}:`);
    assert.notEqual(start, -1, `${handlerName} handler must exist`);
    assert.match(
      authAdapterSource.slice(start, authAdapterSource.indexOf('\n\n', start)),
      /runtimeAccountOwned/,
      `${handlerName} must fail closed to RuntimeAccountService ownership`,
    );
  }
  assert.match(authAdapterSource, /updatePassword: async \(\) => runtimeAccountOwned\('updatePassword'\)/);
  assert.match(authAdapterSource, /loadCurrentUser: async \(\) => \{\s*await ensureAuthApiReady\(\);\s*return loadDesktopRuntimeAccountUser\(\);/s);
  assert.match(authAdapterSource, /desktopBridge\.getRuntimeAccountSessionStatus\(\)/);
  assert.doesNotMatch(authAdapterSource, /getDesktopAccountRuntime\(\)\.account\.getAccountSessionStatus/);
  assert.doesNotMatch(authAdapterSource, /getAccessToken|refreshAccountSession/);
  assert.doesNotMatch(authAdapterSource, /isWebShellMode|accessToken|refreshToken|@nimiplatform\/sdk\/realm/);
});

test('desktop auth adapter delegates post-login sync to query invalidation (no direct dataSync calls)', () => {
  const syncAfterLoginStart = authAdapterSource.indexOf('syncAfterLogin: async () => {');
  assert.notEqual(syncAfterLoginStart, -1, 'syncAfterLogin handler must exist');

  assert.equal(authAdapterSource.indexOf('if (isWebShellMode()) {', syncAfterLoginStart), -1);

  // syncAfterLogin must not call dataSync directly — query invalidation handles refetches
  const directLoadChats = authAdapterSource.indexOf('realm data chat loads', syncAfterLoginStart);
  assert.equal(directLoadChats, -1, 'syncAfterLogin must not call realm data chat loads directly');
  const directLoadContacts = authAdapterSource.indexOf('realmSocialData.loadContacts()', syncAfterLoginStart);
  assert.equal(directLoadContacts, -1, 'syncAfterLogin must not call realmSocialData.loadContacts() directly');
});

test('desktop runtime account browser broker waits for bootstrap before RuntimeAccountService calls', () => {
  assert.match(authAdapterSource, /createRuntimeAccountBrowserBroker\(\{\s*caller: desktopRuntimeAccountCaller,\s*beforeRequest: ensureAuthApiReady,/s);
});

test('desktop runtime account browser broker does not mutate Runtime account custody while starting login', () => {
  assert.doesNotMatch(authAdapterSource, /runtime\.account\.logout/);
  assert.doesNotMatch(authAdapterSource, /clearRuntimeAccountForReauth/);
  assert.doesNotMatch(authAdapterSource, /desktop_login_reauth/);
});

test('desktop Electron login uses RuntimeAccountService desktop-browser auth, not Realm fallback', () => {
  assert.doesNotMatch(loginPageSource, /isDesktopRuntimeAccountSessionReady/);
  assert.match(
    loginPageSource,
    /const authMode = bindings\.app\.projection\.loginMode\(\)/,
  );
  assert.doesNotMatch(loginPageSource, /getShellFeatureFlags|window\./);
  assert.match(loginPageSource, /<WebAuthMenu mode=\{authMode\} \/>/);
  assert.match(webAuthMenuSource, /runtimeAccountBroker: auth\.runtimeAccountBroker/);
  assert.match(authAdapterSource, /runtimeAccountBroker: createDesktopRuntimeAccountBrowserBroker\(\)/);
  assert.doesNotMatch(webAuthMenuSource, /desktop-auth-adapter|desktopBridge/);
});
