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

function assertGuardedCall(handlerName: string): void {
  const start = authAdapterSource.indexOf(`${handlerName}:`);
  assert.notEqual(start, -1, `${handlerName} handler must exist`);
  const guardIndex = authAdapterSource.indexOf('await ensureAuthApiReady();', start);
  assert.notEqual(guardIndex, -1, `${handlerName} must await ensureAuthApiReady()`);
  const nextHandlerIndex = authAdapterSource.indexOf('\n\n', start);
  const searchEnd = nextHandlerIndex === -1 ? authAdapterSource.length : nextHandlerIndex;
  const runtimeProjectionIndex = authAdapterSource.indexOf('runtime.account.getAccountSessionStatus', start);
  const realmSecurityProjectionIndex = authAdapterSource.indexOf('updateNimiRealmPassword', start);
  const sharedRuntimeProjectionIndex = authAdapterSource.indexOf('loadDesktopRuntimeAccountUser()', start);
  const guardedIndex = [runtimeProjectionIndex, realmSecurityProjectionIndex]
    .filter((index) => index !== -1 && index < searchEnd)
    .at(0) ?? (sharedRuntimeProjectionIndex !== -1 && sharedRuntimeProjectionIndex < searchEnd
      ? sharedRuntimeProjectionIndex
      : undefined);
  assert.notEqual(guardedIndex, undefined, `${handlerName} must call a guarded Runtime/SDK auth surface`);
  assert.ok(guardIndex < guardedIndex!, `${handlerName} must guard before the auth surface call`);
}

test('desktop auth adapter guards Runtime-backed auth API calls behind bootstrap readiness', () => {
  assert.ok(
    authAdapterSource.includes('export async function ensureAuthApiReady(): Promise<void>'),
    'desktop auth adapter must expose ensureAuthApiReady()',
  );
  assert.ok(
    authAdapterSource.includes('supportsPasswordLogin: isWebShellMode()'),
    'password login may only be exposed by the explicit Web/cloud shell mode',
  );
  assert.doesNotMatch(authAdapterSource, /isRealmAuthSurfaceEnabled/);

  assert.match(
    authAdapterSource,
    /throw new Error\(`Desktop local first-party \$\{route\} is owned by RuntimeAccountService`\)/,
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
      /localFirstPartyBlocked/,
      `${handlerName} must fail closed to RuntimeAccountService ownership`,
    );
  }
  assertGuardedCall('updatePassword');
  assertGuardedCall('loadCurrentUser');
  assert.match(authAdapterSource, /runtime\.account\.getAccountSessionStatus\(\{\s*caller:/s);
  assert.match(authAdapterSource, /runtime\.account\.getAccessToken\(\{\s*caller: desktopRuntimeAccountCaller,\s*requestedScopes: \[\],\s*\}\)/s);
});

test('desktop auth adapter delegates post-login sync to query invalidation (no direct dataSync calls)', () => {
  const syncAfterLoginStart = authAdapterSource.indexOf('syncAfterLogin: async () => {');
  assert.notEqual(syncAfterLoginStart, -1, 'syncAfterLogin handler must exist');

  const webShellGuardIndex = authAdapterSource.indexOf('if (isWebShellMode()) {', syncAfterLoginStart);
  assert.notEqual(webShellGuardIndex, -1, 'syncAfterLogin must guard web shell warmup');

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
    /const authMode = flags\.mode === 'web'\s*\?\s*'embedded'\s*:\s*'desktop-browser'/s,
  );
  assert.match(loginPageSource, /<WebAuthMenu mode=\{authMode\} \/>/);
  assert.match(webAuthMenuSource, /mode === 'desktop-browser'\s*\?\s*createDesktopRuntimeAccountBrowserBroker\(\)\s*:\s*null/s);
});
