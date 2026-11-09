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
test.after(() => rmSync(output, { recursive: true, force: true }));

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
