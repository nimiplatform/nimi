import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { launchDevService, probeDevHttp, readDesktopDevEnvironment, validateRealmDevDirectory, waitForDevDependency } from './desktop-dev-dependencies.mjs';

test('HTTP readiness rejects unrelated services, errors and malformed responses', async (t) => {
  let body = '{"application":"expected"}';
  let status = 200;
  const server = createServer((_request, response) => { response.writeHead(status); response.end(body); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const accepts = (value) => value?.application === 'expected';
  assert.equal((await probeDevHttp(url, accepts)).state, 'ready');
  body = '{"application":"unrelated"}';
  assert.equal((await probeDevHttp(url, accepts)).state, 'conflict');
  body = '<html>another server</html>';
  assert.equal((await probeDevHttp(url, accepts)).state, 'conflict');
  status = 503;
  assert.deepEqual(await probeDevHttp(url, accepts), { state: 'unavailable', detail: 'HTTP 503' });
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  assert.equal((await probeDevHttp(url, accepts)).state, 'missing');
});

test('startup waiting surfaces process exit, occupied endpoints, timeout and cancellation', async () => {
  await assert.rejects(waitForDevDependency({ name: 'API', probe: async () => ({ state: 'missing' }) }, {
    failure: () => new Error('compiler exited'),
  }), /compiler exited/u);
  await assert.rejects(waitForDevDependency({ name: 'Web', probe: async () => ({ state: 'conflict' }) }), /another service/u);
  await assert.rejects(waitForDevDependency({ name: 'API', probe: async () => ({ state: 'unavailable' }) }, { timeoutMs: 1 }), /did not become ready/u);
  const abort = new AbortController();
  const waiting = waitForDevDependency({ name: 'Runtime', probe: async () => ({ state: 'starting' }) }, { signal: abort.signal });
  abort.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
});

test('Realm startup requires an explicit workspace with the guarded commands', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'desktop-deps-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => validateRealmDevDirectory(''), /NIMI_DEV_REALM_DIR/u);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'dev:api': 'node api.mjs' } }));
  assert.throws(() => validateRealmDevDirectory(root), /dev:infra/u);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: {
    'dev:infra': 'node infra.mjs', 'dev:api': 'node api.mjs', 'dev:realtime': 'node realtime.mjs',
  } }));
  assert.equal(validateRealmDevDirectory(root).toLowerCase(), root.toLowerCase());
});

test('local startup configuration is read without overwriting explicit shell settings', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'desktop-env-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'services'));
  writeFileSync(path.join(root, '.env'), 'NIMI_DEV_REALM_DIR="./services"\nNIMI_REALM_URL=http://127.0.0.1:3002\n');
  assert.equal(readDesktopDevEnvironment(root, {}).NIMI_DEV_REALM_DIR, './services');
  assert.equal(readDesktopDevEnvironment(root, { NIMI_DEV_REALM_DIR: '/explicit' }).NIMI_DEV_REALM_DIR, '/explicit');
});

test('owned development process trees are stopped while an independent service survives', { timeout: 20_000 }, async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'desktop-owned-service-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'node service.cjs' } }));
  writeFileSync(path.join(root, 'service.cjs'), `const fs=require('node:fs'); const http=require('node:http'); const server=http.createServer((_,res)=>res.end(JSON.stringify({application:'owned-test-service'}))); server.listen(0,'127.0.0.1',()=>fs.writeFileSync('port',String(server.address().port)));`);
  const independent = createServer((_request, response) => response.end('alive'));
  await new Promise((resolve) => independent.listen(0, '127.0.0.1', resolve));
  t.after(() => { independent.closeAllConnections(); independent.close(); });
  const child = launchDevService(root, { name: 'test service', script: 'dev' }, process.env, root);
  t.after(() => child.stop());
  const deadline = Date.now() + 10_000;
  while (!existsSync(path.join(root, 'port')) && Date.now() < deadline) {
    if (child.failure()) throw child.failure();
    await delay(50);
  }
  const url = `http://127.0.0.1:${readFileSync(path.join(root, 'port'), 'utf8')}`;
  const accepts = (value) => value.application === 'owned-test-service';
  assert.equal((await probeDevHttp(url, accepts)).state, 'ready');
  await child.stop();
  await child.done;
  assert.equal((await probeDevHttp(url, accepts)).state, 'missing');
  assert.equal(await (await fetch(`http://127.0.0.1:${independent.address().port}`)).text(), 'alive');
});
