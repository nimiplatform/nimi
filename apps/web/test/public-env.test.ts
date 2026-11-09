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
      VITE_NIMI_REALM_ENVIRONMENT_ID: 'realm-local',
      VITE_NIMI_RUNTIME_MANAGER_CLIENT_ID: 'nimi.manager.web',
      VITE_LANDING_DOCS_SOURCE_URL: 'https://github.com/example/project/tree/main/docs',
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
  assert.equal(resolved.VITE_NIMI_REALM_ENVIRONMENT_ID, 'realm-local');
  assert.equal(resolved.VITE_NIMI_RUNTIME_MANAGER_CLIENT_ID, 'nimi.manager.web');
  assert.equal(
    createWebPublicEnvDefines(resolved)['import.meta.env.VITE_LANDING_DOCS_SOURCE_URL'],
    JSON.stringify('https://github.com/example/project/tree/main/docs'),
  );
  assert.deepEqual(
    Object.keys(resolved).filter((key) => !WEB_PUBLIC_ENV_KEYS.includes(key as never)),
    [],
  );
  assert.doesNotMatch(JSON.stringify(resolved), new RegExp(forbiddenCanary));
  assert.doesNotMatch(JSON.stringify(createWebPublicEnvDefines(resolved)), new RegExp(forbiddenCanary));
});

test('HTTPS development uses the existing same-origin Realm proxy without exposing TLS paths', () => {
  const source = { NIMI_WEB_DEV_TLS_CERT: '/private/dev.crt', NIMI_WEB_DEV_TLS_KEY: '/private/dev.key' };
  const development = resolveWebPublicEnv({ source, realmProxyTarget: 'http://localhost:3002', mode: 'development' });
  assert.equal(development.VITE_NIMI_REALM_BASE_URL, undefined);
  assert.doesNotMatch(JSON.stringify(createWebPublicEnvDefines(development)), /private\/dev/);
  const production = resolveWebPublicEnv({ source, realmProxyTarget: 'https://realm.nimi.example', mode: 'production' });
  assert.equal(production.VITE_NIMI_REALM_BASE_URL, 'https://realm.nimi.example');
});
