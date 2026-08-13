import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWebPublicEnvDefines,
  resolveWebPublicEnv,
  WEB_PUBLIC_ENV_KEYS,
} from '../public-env.js';

test('Web public env resolver admits only exact non-secret client keys', () => {
  const allowedCanary = 'allowed-public-canary';
  const forbiddenCanary = 'forbidden-private-canary';
  const resolved = resolveWebPublicEnv({
    source: {
      VITE_NIMI_GOOGLE_CLIENT_ID: allowedCanary,
      NIMI_FIRST_PARTY_ACCOUNT_PASSWORD: forbiddenCanary,
      NIMI_ACCESS_TOKEN: forbiddenCanary,
      VITE_NIMI_ACCESS_TOKEN: forbiddenCanary,
      VITE_PRIVATE_TOKEN: forbiddenCanary,
    },
    realmProxyTarget: 'http://localhost:3002',
    mode: 'development',
  });

  assert.equal(resolved.VITE_NIMI_REALM_BASE_URL, 'http://localhost:3002');
  assert.equal(resolved.VITE_NIMI_GOOGLE_CLIENT_ID, allowedCanary);
  assert.deepEqual(
    Object.keys(resolved).filter((key) => !WEB_PUBLIC_ENV_KEYS.includes(key as never)),
    [],
  );
  assert.doesNotMatch(JSON.stringify(resolved), new RegExp(forbiddenCanary));
  assert.doesNotMatch(JSON.stringify(createWebPublicEnvDefines(resolved)), new RegExp(forbiddenCanary));
});
