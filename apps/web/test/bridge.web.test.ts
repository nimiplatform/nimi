import assert from 'node:assert/strict';
import test from 'node:test';
import {
  desktopBridge,
  getRuntimeDefaults,
  getRuntimeBridgeConfig,
  setRuntimeBridgeConfig,
} from '../src/desktop-adapter/bridge.web.js';

test('bridge.web rejects desktop-only runtime bridge config access', async () => {
  await assert.rejects(
    async () => getRuntimeBridgeConfig(),
    /Runtime bridge config is only available in desktop runtime/,
  );

  await assert.rejects(
    async () => desktopBridge.getRuntimeBridgeConfig(),
    /Runtime bridge config is only available in desktop runtime/,
  );

  await assert.rejects(
    async () => setRuntimeBridgeConfig('{}'),
    /Runtime bridge config updates are only available in desktop runtime/,
  );

  await assert.rejects(
    async () => desktopBridge.setRuntimeBridgeConfig('{}'),
    /Runtime bridge config updates are only available in desktop runtime/,
  );
});

test('bridge.web resolves runtime defaults without a standard shell host', async () => {
  const originalLocation = globalThis.location;
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL('http://localhost:3000/login?oauth_next=http%3A%2F%2Flocalhost%3A3002%2Fapi%2Fauth%2Foauth%2Fauthorize#/login'),
  });

  try {
    const defaults = await getRuntimeDefaults();
    assert.equal(defaults.realm.realmBaseUrl, 'http://localhost:3000');
    assert.equal(defaults.realm.accessToken, '');
    assert.equal(defaults.realm.jwksUrl, 'http://localhost:3000/api/auth/jwks');
    assert.equal(defaults.realm.revocationUrl, 'http://localhost:3000/api/auth/sessions/introspect');
    assert.equal(defaults.realm.jwtIssuer, 'http://localhost:3000');
    assert.equal(defaults.realm.jwtAudience, 'nimi-runtime');
    assert.equal(defaults.runtime.targetType, '');
    assert.equal(defaults.runtime.userConfirmedUpload, false);
  } finally {
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: originalLocation,
    });
  }
});
