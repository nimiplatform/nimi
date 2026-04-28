import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const authAdapterSource = readFileSync(
  new URL('../src/shell/renderer/features/auth/desktop-auth-adapter.ts', import.meta.url),
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
  const dataSyncCallIndex = authAdapterSource.indexOf('dataSync.updatePassword', start);
  const guardedIndex = [runtimeProjectionIndex, dataSyncCallIndex]
    .filter((index) => index !== -1 && index < searchEnd)
    .at(0);
  assert.notEqual(guardedIndex, undefined, `${handlerName} must call a guarded Runtime/DataSync auth surface`);
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
});

test('desktop auth adapter delegates post-login sync to query invalidation (no direct dataSync calls)', () => {
  const syncAfterLoginStart = authAdapterSource.indexOf('syncAfterLogin: async () => {');
  assert.notEqual(syncAfterLoginStart, -1, 'syncAfterLogin handler must exist');

  const webShellGuardIndex = authAdapterSource.indexOf('if (isWebShellMode()) {', syncAfterLoginStart);
  assert.notEqual(webShellGuardIndex, -1, 'syncAfterLogin must guard web shell warmup');

  // syncAfterLogin must not call dataSync directly — query invalidation handles refetches
  const directLoadChats = authAdapterSource.indexOf('dataSync.loadChats()', syncAfterLoginStart);
  assert.equal(directLoadChats, -1, 'syncAfterLogin must not call dataSync.loadChats() directly');
  const directLoadContacts = authAdapterSource.indexOf('dataSync.loadContacts()', syncAfterLoginStart);
  assert.equal(directLoadContacts, -1, 'syncAfterLogin must not call dataSync.loadContacts() directly');
});
