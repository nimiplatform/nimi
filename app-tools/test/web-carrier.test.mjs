import { createNimiAppRecordStore } from '../../kit/dist/core/app-record-storage.js';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { parse as yaml, stringify as stringifyYaml } from 'yaml';
import { buildAppScaffoldSnapshot, buildAppScaffoldSnapshotFromIntent, hashScaffoldManagedContent } from '../lib/app-scaffold.mjs';
import { appScaffoldVersions, resolveAppCreatePlan } from '../lib/index.mjs';
import { readWebDevelopment, isWebCoordinationPath, nimiWebViteConfig, webOriginGuard } from '../lib/web-development.mjs';
import { handleNimiWebCoordination } from '../lib/web-coordination.mjs';
import { validateAppProjectInputs } from '../lib/app-doctor-update.mjs';
import { buildAppProject } from '../lib/app-project-lifecycle.mjs';

const versions = appScaffoldVersions();
const snapshot = () => buildAppScaffoldSnapshot({ profile: 'standalone', platform: 'web', versions,
  appId: 'unit.web', appTitle: 'Unit Web', features: ['studio-create'] });

test('Web scaffold preserves selected feature closure without native shells or dependencies', () => {
  const output = snapshot();
  const pkg = JSON.parse(output.filesByPath.get('package.json').content);
  assert.equal(output.lock.platform, 'web');
  assert.equal(output.files.some(file => /^(src-electron|src-tauri)\//u.test(file.path)), false);
  assert.equal(pkg.devDependencies.electron, undefined);
  assert.equal(pkg.devDependencies['@tauri-apps/cli'], undefined);
  assert.equal(pkg.scripts.dev, 'nimi-app dev --platform web');
  assert.equal(output.filesByPath.has('src/scaffold/generated/host-adapters.tsx'), true);
  assert.deepEqual(output.lock.features, ['studio-create']);
  const intent = JSON.parse(output.filesByPath.get('.nimi/app-scaffold/intent.json').content);
  assert.deepEqual(buildAppScaffoldSnapshotFromIntent({ intent, versions }).lock, output.lock);
  const all = buildAppScaffoldSnapshot({ profile: 'standalone', platform: 'web', versions, appId: 'unit.web', appTitle: 'Unit', features: 'all' });
  assert.deepEqual(all.features, ['studio-create']);
});

test('create rejects unavailable platforms or features before writing a project', () => {
  assert.throws(() => resolveAppCreatePlan(os.tmpdir(), { appId: 'unit.unavailable', platform: 'mobile' }), /Unsupported App platform/u);
  assert.throws(() => buildAppScaffoldSnapshot({ profile: 'standalone', platform: 'web', versions, appId: 'unit.web', appTitle: 'Unit', features: ['studio-vision'] }), /feature|carrier/iu);
});

test('Web source config binds HTTPS callback and prevents credential-cookie sharing', () => {
  const manifest = yaml(snapshot().filesByPath.get('nimi.app.yaml').content);
  assert.throws(() => readWebDevelopment(manifest), /Configure the exact registered official/);
  Object.assign(manifest.local_development.web, { origin: 'https://127.0.0.1:4499', redirect_uri: 'https://127.0.0.1:4499/', client_id: 'unit.web' });
  const web = readWebDevelopment(manifest);
  assert.equal(web.config.appId, 'unit.web');
  assert.equal(web.config.realmBaseUrl, web.site.origin);
  assert.throws(() => readWebDevelopment({ ...manifest, local_development: { web: { ...manifest.local_development.web, redirect_uri: 'https://other.example/' } } }), /callback/u);
  assert.throws(() => readWebDevelopment({ ...manifest, local_development: { web: { ...manifest.local_development.web, origin: 'https://nimi.ai', redirect_uri: 'https://nimi.ai/callback' } } }), /different hostnames/u);
  assert.equal(isWebCoordinationPath('GET', '/api/runtime-access/context'), true);
  assert.equal(isWebCoordinationPath('POST', '/api/runtime-access/context/end'), true);
  assert.equal(isWebCoordinationPath('GET', '/api/auth/runtime-clients/unit.web'), true);
  assert.equal(isWebCoordinationPath('GET', '/api/runtime-access/context/ai'), false);
  assert.equal(isWebCoordinationPath('POST', '/api/runtime-access/context'), false);
  let code, next = 0;
  webOriginGuard(web.site)({ method: 'POST', headers: { host: web.site.host }, url: '/api/auth/runtime-clients/authorize' }, { writeHead(value) { code = value; }, end() {} }, () => next++);
  assert.equal(code, 404); assert.equal(next, 0);
});

test('Web release builds require an explicit deployed source and embed its same-origin coordination URL', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nimi-web-release-'));
  try {
    writeFileSync(path.join(root, 'nimi.app.yaml'), snapshot().filesByPath.get('nimi.app.yaml').content);
    const options = { root, serve: false, release: true };
    const env = {
      NIMI_WEB_ORIGIN: 'https://app.example',
      NIMI_WEB_REDIRECT_URI: 'https://app.example/callback',
      NIMI_WEB_CLIENT_ID: 'unit.web.release',
      NIMI_WEB_REALM_ENVIRONMENT_ID: 'production',
      NIMI_WEB_OFFICIAL_WEB_URL: 'https://account.example',
    };
    assert.throws(() => nimiWebViteConfig({ ...options, env: {} }), /NIMI_WEB_ORIGIN/u);
    assert.throws(() => nimiWebViteConfig({ ...options, env, serve: true }), /requires a build/u);
    assert.throws(() => nimiWebViteConfig({ ...options, env: { ...env, NIMI_WEB_OFFICIAL_WEB_URL: 'http://localhost:3000' } }), /HTTPS/u);
    assert.throws(() => nimiWebViteConfig({ ...options, env: { ...env, NIMI_WEB_REDIRECT_URI: 'https://other.example/callback' } }), /callback/u);
    assert.deepEqual(JSON.parse(nimiWebViteConfig({ ...options, env }).define.__NIMI_APP_WEB_CONFIG__), {
      appId: 'unit.web', clientId: 'unit.web.release', realmEnvironmentId: 'production',
      officialWebBaseUrl: 'https://account.example', realmBaseUrl: 'https://app.example', redirectUri: 'https://app.example/callback',
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Pages coordination forwards only same-origin allowlisted calls without cookies or upstream redirects', async t => {
  const env = { NIMI_WEB_ORIGIN: 'https://app.example', NIMI_REALM_URL: 'https://realm.example' };
  const upstream = t.mock.method(globalThis, 'fetch', async () => new Response('{"ok":true}', {
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'account=example' },
  }));
  const invoke = (path, options) => handleNimiWebCoordination({ request: new Request(new URL(path, env.NIMI_WEB_ORIGIN), options), env });
  assert.equal((await invoke('/api/runtime-access/context', { headers: { Origin: 'https://other.example' } })).status, 403);
  assert.equal((await invoke('/api/auth/login', { method: 'POST' })).status, 404);
  assert.equal(upstream.mock.callCount(), 0);
  const result = await invoke('/api/runtime-access/context?current=1', {
    headers: { Authorization: 'Bearer context', Cookie: 'account=example', Origin: env.NIMI_WEB_ORIGIN },
  });
  assert.equal(await result.text(), '{"ok":true}');
  assert.equal(result.headers.get('set-cookie'), null);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  const [target, options] = upstream.mock.calls[0].arguments;
  assert.equal(target.href, 'https://realm.example/api/runtime-access/context?current=1');
  assert.equal(options.redirect, 'manual');
  assert.equal(options.headers.get('authorization'), 'Bearer context');
  assert.equal(options.headers.get('cookie'), null);
  upstream.mock.mockImplementation(async () => Response.redirect('https://other.example/'));
  assert.equal((await invoke('/api/runtime-access/context')).status, 502);
});

test('Web lifecycle validates its real command and delegates build to its declared owner', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nimi-web-unit-'));
  try {
    const output = snapshot();
    for (const file of output.files) { const target = path.join(root, file.path); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, file.content); }
    const manifest = yaml(readFileSync(path.join(root, 'nimi.app.yaml'), 'utf8'));
    Object.assign(manifest.local_development.web, { origin: 'https://app.example', redirect_uri: 'https://app.example/callback', client_id: 'unit.web' });
    writeFileSync(path.join(root, 'nimi.app.yaml'), stringifyYaml(manifest));
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    validateAppProjectInputs(root, manifest, pkg, true);
    let calls = 0;
    const result = buildAppProject(root, { json: true }, { runAppCommand(target, command) {
      calls++; assert.equal(target, root); assert.equal(command, 'pnpm run build');
      mkdirSync(path.join(root, 'dist')); writeFileSync(path.join(root, 'dist/index.html'), '<html>unit fixture</html>');
      return { status: 0 };
    } });
    assert.equal(result.target, 'web'); assert.equal(calls, 1);
    assert.throws(() => buildAppProject(root, { production: true }, {}), /Web release/u);
  } finally { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); rmSync(root, { recursive: true, force: true }); }
});

test('Web connection inputs are authored by the App while the App identity remains managed', () => {
  const output = snapshot();
  const source = output.filesByPath.get('nimi.app.yaml').content;
  const manifest = yaml(source);
  manifest.local_development.web.origin = 'https://work.example';
  manifest.local_development.web.redirect_uri = 'https://work.example/callback';
  manifest.local_development.web.client_id = 'unit.web.reviewed';
  readWebDevelopment(manifest);
  assert.equal(hashScaffoldManagedContent('nimi.app.yaml', stringifyYaml(manifest)), hashScaffoldManagedContent('nimi.app.yaml', source));
  manifest.app_id = 'another.app';
  assert.notEqual(hashScaffoldManagedContent('nimi.app.yaml', stringifyYaml(manifest)), hashScaffoldManagedContent('nimi.app.yaml', source));
});

test('generated Web Runtime projection reports a disconnected client as unavailable', async () => {
  const source = snapshot().filesByPath.get('src/shell/auth/runtime-platform.ts').content
    .replace(/^import .*;$/gmu, '').replace(/^export \{.*;$/gmu, '').replace('export async function', 'async function');
  const load = new Function('getNimiLocalAppClient', stripTypeScriptTypes(source, { mode: 'transform' }) + '; return getRuntimePlatformProjection;');
  const connected = load(() => ({ identity: { displayName: 'verified fixture' } }));
  assert.equal((await connected()).status, 'ready');
  const disconnected = load(() => { throw new Error('connection ended'); });
  assert.deepEqual(await disconnected(), { status: 'unavailable', mode: 'remote-app', message: 'connection ended' });
});

test('generated services keep an already queued save on its original connection', async () => {
  const source = snapshot().filesByPath.get('src/scaffold/generated/host-adapters.tsx').content;
  const parsed = ts.createSourceFile('host.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const factory = parsed.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'createGeneratedServices');
  assert.ok(factory);
  let finishRead, currentClient;
  const written = [];
  const assets = name => ({
    async list() { return { assets: [], nextCursor: '' }; },
    async read() { return { asset: { sha256: 'sha256:' + '0'.repeat(64) }, body: (async function* () { yield new TextEncoder().encode(JSON.stringify({ id: name, capabilityId: 'text.generate', createdAt: '2026-11-09' })); })() }; },
    async remove() { written.push(name); return { removed: true }; },
  });
  const a = { identity: { realmEnvironmentId: 'unit', accountId: 'A', appId: 'unit.web', clientId: 'unit.client' }, primary: { bindingId: 'primary-A' },
    storage: { assets: { ...assets('A'), list: () => new Promise(resolve => { finishRead = resolve; }) } } };
  const b = { identity: { ...a.identity, accountId: 'B' }, primary: { bindingId: 'primary-B' }, storage: { assets: assets('B') } };
  currentClient = a;
  // Only the history-policy port is replaced: this tests generated lifetime
  // binding, not Runtime authorization or the policy owner's merge algorithm.
  const create = vm.runInNewContext(stripTypeScriptTypes(factory.getText(parsed), { mode: 'transform' }) + '; createGeneratedServices;', {
    getNimiLocalAppClient: () => currentClient,
    appId: 'unit.app', appTitle: 'unit', translate: value => value, generatedLocale: 'en', HISTORY_PATH: 'history.json', PROMPT_DRAFT_STORAGE_KEY: 'drafts',
    createNimiAppRecordStore, parseStudioRunHistoryRecord: value => value,
    createStudioPromptDraftRepository: () => ({ load: async () => ({ prompt: null }), save: async () => {} }),
    studioHistoryFromRecords: records => ({ 'text.generate': records }),
    createStudioRunTargetSummary: () => ({}), openAssetMediaUrl: async () => { throw new Error('not selected'); },
    clearStudioHistoryWithPolicy: async ({ commit }) => { await commit({}); return {}; },
  });
  const servicesA = create(a);
  assert.equal(servicesA.hostValue.sdk.storage, a.storage);
  const pending = servicesA.historyRepository.clear(null, false);
  await new Promise(resolve => setImmediate(resolve));
  currentClient = b;
  const servicesB = create(b);
  assert.equal(servicesB.hostValue.sdk.storage, b.storage);
  finishRead({ assets: [{ relativePath: 'ai-studio/history/A.json' }], nextCursor: '' }); await pending;
  assert.deepEqual(written, ['A']);
});

test('two generated Web clients retain independently saved runs in the same owner', async () => {
  const source = snapshot().filesByPath.get('src/scaffold/generated/host-adapters.tsx').content;
  const parsed = ts.createSourceFile('host.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const factory = parsed.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'createGeneratedServices');
  const records = new Map();
  const client = { identity: { realmEnvironmentId: 'unit', accountId: 'A', appId: 'unit.web', clientId: 'unit.client' }, primary: { bindingId: 'primary-A' }, storage: { assets: {
    async write({ relativePath, body }) { await Promise.resolve(); records.set(relativePath, body); },
    async read({ relativePath }) { const bytes = records.get(relativePath); return { asset: { sha256: 'sha256:' + '0'.repeat(64) }, body: (async function* () { yield bytes; })() }; },
    async list() { return { assets: [...records.keys()].sort().map(relativePath => ({ relativePath })), nextCursor: '' }; },
  } } };
  const create = vm.runInNewContext(stripTypeScriptTypes(factory.getText(parsed), { mode: 'transform' }) + '; createGeneratedServices;', {
    appId: 'unit.app', appTitle: 'unit', translate: value => value, generatedLocale: 'en',
    createNimiAppRecordStore, parseStudioRunHistoryRecord: value => value,
    createStudioPromptDraftRepository: () => ({ load: async () => ({ prompt: null }), save: async () => {} }),
    studioHistoryFromRecords: rows => ({ 'text.generate': rows }),
    projectStudioManagedHistory: ({ runHistory }) => runHistory,
    createStudioRunTargetSummary: () => ({}), openAssetMediaUrl: async () => { throw new Error('not selected'); },
  });
  const a = create(client), b = create(client);
  await Promise.all([
    a.historyRepository.appendRecord({ id: 'A', capabilityId: 'text.generate', createdAt: '2026-11-09T00:00:00Z' }),
    b.historyRepository.appendRecord({ id: 'B', capabilityId: 'text.generate', createdAt: '2026-11-09T00:00:01Z' }),
  ]);
  assert.deepEqual(Array.from((await a.historyRepository.load())['text.generate'], row => row.id), ['B', 'A']);
});
