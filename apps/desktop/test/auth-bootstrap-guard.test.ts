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
