import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveReferenceNetwork } from './server-network.ts';

test('reference remains loopback by default and supports an explicit LAN listener', () => {
  const local = resolveReferenceNetwork({ officialWebOrigin: 'http://localhost:3000' });
  assert.equal(local.origin.origin, 'https://127.0.0.1:4443');
  assert.equal(local.bindHost, '127.0.0.1');
  const lan = resolveReferenceNetwork({ websiteOrigin: 'https://writer.test:4444',
    officialWebOrigin: 'https://192.168.1.10:3444', bindHost: '192.168.1.10' });
  assert.equal(lan.origin.host, 'writer.test:4444');
  assert.equal(lan.bindHost, '192.168.1.10');
  assert.equal(lan.officialWebBaseUrl, 'https://192.168.1.10:3444');
});

test('different ports cannot make the official login and ecosystem website cookie-isolated', () => {
  assert.throws(() => resolveReferenceNetwork({ websiteOrigin: 'https://HOST.test:4444',
    officialWebOrigin: 'https://host.test:3444' }), /different hostnames/);
});

test('network setup rejects insecure or non-origin URLs and ambiguous listeners', () => {
  for (const websiteOrigin of ['http://writer.test', 'https://user:password@writer.test', 'https://writer.test/path', 'https://writer.test/?query=1']) {
    assert.throws(() => resolveReferenceNetwork({ websiteOrigin, officialWebOrigin: 'https://nimi.test' }));
  }
  assert.throws(() => resolveReferenceNetwork({ officialWebOrigin: 'http://nimi.test' }));
  assert.throws(() => resolveReferenceNetwork({ officialWebOrigin: 'https://nimi.test', bindHost: 'writer.test' }), /explicit local IP/);
});
