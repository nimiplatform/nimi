import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { build as buildVite } from 'vite';
import { labWebDevelopment, labWebOriginGuard, labCoordinationPath } from '../scripts/web-config.mjs';

const root = path.resolve(import.meta.dirname, '..');
mkdirSync(path.join(root, '.tmp'), { recursive: true });
const output = mkdtempSync(path.join(root, '.tmp', 'web-connection-'));
await build({ entryPoints: [path.join(root, 'src/web/connection.ts')], bundle: true, packages: 'external', platform: 'node', format: 'esm',
  outfile: path.join(output, 'connection.mjs'), logLevel: 'silent' });
const { createLabWebConnection } = await import(pathToFileURL(path.join(output, 'connection.mjs')).href);
test.after(() => rmSync(output, { recursive: true, force: true }));

// Controller unit fixtures are not an authenticated product journey.
function fixture(overrides = {}) {
  const values = new Map(), navigations = [], stats = { exchanges: 0, connections: 0, ends: 0, closes: 0 };
  const config = { clientId: 'lab.web', realmEnvironmentId: 'dev', realmBaseUrl: 'https://lab.example', officialWebBaseUrl: 'https://nimi.example', redirectUri: 'https://lab.example/' };
  const identity = { accountId: 'account-unit', displayName: 'Unit user', appId: 'nimi.lab', clientId: 'lab.web', contextId: 'context-unit', realmEnvironmentId: 'dev', expiresAt: new Date(Date.now() + 60000).toISOString() };
  const session = { active: true, identity, async end() { this.active = false; stats.ends++; } };
  const peer = (options, role = 'app') => ({ role, identity, primary: { displayName: 'Unit PC' }, closed: false,
    close() { if (this.closed) return; this.closed = true; stats.closes++; options?.onState?.('closed'); } });
  const platform = {
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    navigate: url => navigations.push(url), clearCallback() {}, randomId: () => 'unit-generation',
    prepare: async options => ({ authorizationUrl: 'https://nimi.example/account/connect', transaction: { applicationUserContext: options.currentUserContext() } }),
    complete: async options => { assert.equal(options.currentUserContext(), 'unit-generation'); stats.exchanges++; return session; },
    connect: async (_session, options) => { stats.connections++; return peer(options); }, ...overrides,
  };
  return { config, platform, values, stats, session, peer, navigations, create: () => createLabWebConnection(config, platform) };
}
async function signedIn(f) {
  const first = f.create(); await first.signIn(); first.dispose();
  const current = f.create(); await current.restore('https://lab.example/?code=unit&state=unit'); return current;
}

test('callback is consumed once; disconnect reconnects the same scope without another login', async () => {
  const f = fixture(), controller = await signedIn(f);
  assert.equal(controller.getSnapshot().phase, 'connected');
  await controller.restore('https://lab.example/?code=unit&state=unit');
  assert.equal(f.stats.exchanges, 1); assert.equal(f.values.size, 0);
  controller.disconnect(); assert.equal(controller.getSnapshot().phase, 'disconnected');
  await controller.connect(); assert.equal(f.stats.connections, 2); assert.equal(f.stats.ends, 0);
  await controller.signOut(); assert.equal(f.stats.ends, 1); assert.equal(controller.getSnapshot().identity, null);
  controller.dispose();
});
test('a canceled pending connection cannot mount a stale workbench', async () => {
  let finish, delayConnection = false;
  const f = fixture({ connect: async (_session, options) => delayConnection
    ? new Promise(resolve => { finish = () => resolve(f.peer(options)); }) : f.peer(options) });
  const controller = await signedIn(f); controller.disconnect(); delayConnection = true;
  const pending = controller.connect(); controller.disconnect(); finish(); await pending;
  assert.equal(controller.getSnapshot().connection, null); assert.equal(controller.getSnapshot().phase, 'disconnected');
  assert.equal(f.stats.closes, 2); controller.dispose();
});
test('Lab refuses an official-manager connection instead of treating it as an App', async () => {
  const f = fixture(); f.platform.connect = async (_session, options) => f.peer(options, 'official_manager');
  const controller = await signedIn(f);
  assert.equal(controller.getSnapshot().connection, null);
  assert.equal(controller.getSnapshot().error.reasonCode, 'KIT_REMOTE_APP_SOURCE_REQUIRED');
  assert.equal(f.stats.closes, 1); controller.dispose();
});
test('failed logout ends local use and retains explicit revocation retry', async () => {
  const f = fixture(), controller = await signedIn(f);
  f.session.end = async () => { f.session.active = false; if (++f.stats.ends === 1) throw new Error('offline'); };
  await controller.signOut();
  assert.equal(controller.getSnapshot().connection, null); assert.equal(controller.getSnapshot().pendingRevocation, true);
  await controller.signOut(); assert.equal(controller.getSnapshot().pendingRevocation, false); assert.equal(f.stats.ends, 2);
  controller.dispose();
});
test('signing in again does not hide a failed revocation of the prior context', async () => {
  const f = fixture(), controller = await signedIn(f);
  f.session.end = async () => { f.session.active = false; throw new Error('offline'); };
  await controller.signIn();
  assert.equal(controller.getSnapshot().phase, 'signed-out');
  assert.equal(controller.getSnapshot().connection, null);
  assert.equal(controller.getSnapshot().identity, null);
  assert.equal(controller.getSnapshot().pendingRevocation, true);
  assert.equal(f.navigations.length, 1);
  controller.dispose();
});
test('web development exposes only exact source identity and coordination paths', () => {
  const env = { NIMI_LAB_WEB_TLS_KEY: 'key', NIMI_LAB_WEB_TLS_CERT: 'cert', VITE_NIMI_OFFICIAL_WEB_URL: 'http://localhost:3000' };
  const config = labWebDevelopment(env, value => Buffer.from(value));
  assert.equal(config.server.host, '127.0.0.1'); assert.equal(config.server.port, 4468);
  assert.throws(() => labWebDevelopment({ ...env, VITE_NIMI_OFFICIAL_WEB_URL: 'https://127.0.0.1:3443' }, () => Buffer.alloc(0)), /different hostnames/);
  assert.throws(() => labWebDevelopment({}), /TLS_KEY/);
  assert.equal(labCoordinationPath('/api/runtime-access/context/end'), true);
  assert.equal(labCoordinationPath('/api/auth/runtime-clients/lab.web'), true);
  for (const url of ['/api/auth/login', '/api/runtime-access/../../admin', '/api/runtime-access/connections/a/b', '/api/runtime/ai']) assert.equal(labCoordinationPath(url), false);
  const guard = labWebOriginGuard(config.origin); let forwarded = false, code;
  const response = { writeHead(value) { code = value; }, end() {} };
  guard({ headers: { ':authority': config.origin.host }, url: '/api/runtime-access/context' }, response, () => { forwarded = true; });
  assert.equal(forwarded, true);
  guard({ headers: { ':authority': config.origin.host, host: 'other.example' }, url: '/' }, response, () => assert.fail()); assert.equal(code, 421);
  guard({ headers: { host: config.origin.host }, url: '/api/auth/login' }, response, () => assert.fail()); assert.equal(code, 404);
});

test('the actual Vite config selects Web bootstrap before compiling HTML, preserving the native entry', async () => {
  const fixtureRoot = path.join(output, 'entry-fixture');
  mkdirSync(path.join(fixtureRoot, 'src', 'web'), { recursive: true });
  writeFileSync(path.join(fixtureRoot, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
  writeFileSync(path.join(fixtureRoot, 'src/main.tsx'), 'globalThis.__labEntrySelection = "native";');
  writeFileSync(path.join(fixtureRoot, 'src/web/main.tsx'), 'globalThis.__labEntrySelection = "web";');
  for (const mode of ['web', 'production']) {
    const outDir = path.join(fixtureRoot, mode);
    const built = await buildVite({ configFile: path.join(root, 'vite.config.ts'), root: fixtureRoot, mode, logLevel: 'silent',
      build: { outDir, modulePreload: false, minify: false } });
    const output = Array.isArray(built) ? built.flatMap(item => item.output) : built.output;
    const entry = output.find(item => item.type === 'chunk' && item.isEntry);
    assert.ok(entry);
    try {
      await import(pathToFileURL(path.join(outDir, entry.fileName)).href);
      assert.equal(globalThis.__labEntrySelection, mode === 'web' ? 'web' : 'native');
    } finally { delete globalThis.__labEntrySelection; }
  }
});
