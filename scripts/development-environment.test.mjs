import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveDevelopmentRealm } from '../app-tools/lib/development-environment.mjs';
import { desktopHttpDependencies, desktopWebRealmOrigin } from './lib/desktop-dev-dependencies.mjs';
import { parseRealmArguments } from './lib/development-realm.mjs';
import { readWebDevelopment } from '../app-tools/lib/web-development.mjs';

test('official defaults ignore old local Realm variables and need no private checkout', () => {
  const realm = resolveDevelopmentRealm(undefined, { NIMI_REALM_URL: 'http://localhost:3002', NIMI_DEV_REALM_DIR: '/unavailable' });
  assert.equal(realm.name, 'official');
  assert.equal(realm.apiOrigin, 'https://realm.nimi.ai');
  assert.equal(realm.environmentId, 'production');
  assert.deepEqual(desktopHttpDependencies('/not-a-realm-workspace', realm), []);
});

test('local selection is explicit, validated and does not redirect to official', () => {
  assert.equal(resolveDevelopmentRealm('local', {}).apiOrigin, 'http://127.0.0.1:3002');
  assert.throws(() => resolveDevelopmentRealm('other', {}));
  assert.throws(() => resolveDevelopmentRealm('local', { NIMI_DEV_REALM_URL: 'https://realm.nimi.ai' }));
  assert.throws(() => resolveDevelopmentRealm('local', { NIMI_DEV_REALM_URL: 'https://user@localhost' }));
  assert.throws(() => resolveDevelopmentRealm('local', { NIMI_DEV_REALM_URL: 'http://example.com' }));
  assert.deepEqual(parseRealmArguments(['--realm', 'local', '--no-cdp']), { realm: 'local', rest: ['--no-cdp'] });
  assert.throws(() => parseRealmArguments(['--realm', 'local', '--realm', 'official']));
});

test('local Web browser cookies use one loopback hostname while Runtime keeps its origin', () => {
  const local = resolveDevelopmentRealm('local', {});
  assert.equal(desktopWebRealmOrigin(local), 'http://localhost:3002');
  assert.equal(local.apiOrigin, 'http://127.0.0.1:3002');
  assert.equal(desktopWebRealmOrigin(resolveDevelopmentRealm('official', {})), 'https://realm.nimi.ai');
});

test('public dev CLI keeps Realm selection at the owning boundary', () => {
  const cli = fileURLToPath(new URL('../app-tools/bin/nimi-app.mjs', import.meta.url));
  const project = fileURLToPath(new URL('../apps/lab/', import.meta.url));
  const native = spawnSync(process.execPath, [cli, 'dev', '--dir', project, '--realm', 'local'], { encoding: 'utf8', windowsHide: true });
  assert.equal(native.status, 1);
  assert.match(native.stderr, /Native Apps use the active Nimi Home/);
  const web = spawnSync(process.execPath, [cli, 'dev', '--dir', project, '--platform', 'web', '--realm', 'unknown'], { encoding: 'utf8', windowsHide: true });
  assert.equal(web.status, 1);
  assert.match(web.stderr, /--realm official or --realm local/);
});

test('Web configuration requires a declared source and selects local separately', () => {
  const web = { command: 'pnpm run dev:web', origin: 'https://app.example', redirect_uri: 'https://app.example/callback', client_id: 'example.web' };
  const manifest = { app_id: 'example.app', local_development: { web } };
  assert.equal(readWebDevelopment(manifest, { env: {} }).realm.origin, 'https://realm.nimi.ai');
  assert.throws(() => readWebDevelopment(manifest, { realm: 'local', env: {} }), /web.local/);
  web.local = { ...web, client_id: 'example.web.local' };
  assert.equal(readWebDevelopment(manifest, { realm: 'local', env: {} }).realm.origin, 'http://127.0.0.1:3002');
  assert.throws(() => readWebDevelopment({ ...manifest, local_development: { web: { ...web, client_id: '' } } }, { env: {} }), /registered official/);
});
