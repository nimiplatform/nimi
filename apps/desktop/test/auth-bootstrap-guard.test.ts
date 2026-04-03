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
  const callIndex = authAdapterSource.indexOf('dataSync.callApi(', start);
  assert.notEqual(callIndex, -1, `${handlerName} must call dataSync.callApi()`);
  assert.ok(
    guardIndex < callIndex,
    `${handlerName} must guard API bootstrap before dataSync.callApi()`,
  );
}

test('desktop auth adapter guards auth API calls behind bootstrap readiness', () => {
  assert.ok(
    authAdapterSource.includes('export async function ensureAuthApiReady(): Promise<void>'),
    'desktop auth adapter must expose ensureAuthApiReady()',
  );
  assert.ok(
    authAdapterSource.includes('supportsPasswordLogin: true'),
    'desktop auth adapter must expose password login for existing password accounts',
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
    assertGuardedCall(handlerName);
  }
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
