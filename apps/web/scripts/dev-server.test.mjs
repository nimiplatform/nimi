import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, request as requestHttp } from 'node:http';
import { createServer as createHttp2Server, connect as connectHttp2 } from 'node:http2';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { officialOriginGuard, startWebDevServer } from './dev-server.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'nimi-web-dev-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'index.html'), '<h1>Web startup fixture</h1>');
  return { root, configFile: false, logLevel: 'silent', server: { host: '127.0.0.1', port: 0, watch: null }, optimizeDeps: { noDiscovery: true } };
}

test('starts real Vite, reuses the same workspace, and leaves its server running', async (t) => {
  const options = await fixture(t);
  const first = await startWebDevServer(options);
  t.after(() => first.server.close());
  const port = first.server.httpServer.address().port;
  const duplicate = await startWebDevServer({ ...options, server: { ...options.server, port } });
  assert.equal(first.reused, false);
  assert.equal(duplicate.reused, true);
  assert.equal(duplicate.server, null);
  assert.match(await (await fetch(first.url)).text(), /Web startup fixture/);
});

test('loads configured Vite plugins only once into the running server', async (t) => {
  const options = await fixture(t);
  const configFile = path.join(options.root, 'vite.config.mjs');
  await writeFile(configFile, 'export default { plugins: [{ name: "configured-plugin" }] };');
  const result = await startWebDevServer({ ...options, configFile });
  t.after(() => result.server.close());
  assert.equal(result.server.config.plugins.filter(plugin => plugin.name === 'configured-plugin').length, 1);
});

test('rejects another workspace or mode without stopping its server', async (t) => {
  const options = await fixture(t);
  const first = await startWebDevServer(options);
  t.after(() => first.server.close());
  const port = first.server.httpServer.address().port;
  const other = await fixture(t);
  await assert.rejects(startWebDevServer({ ...other, server: { ...other.server, port } }), /not a matching Web server/);
  await assert.rejects(startWebDevServer({ ...options, mode: 'other-mode', server: { ...options.server, port } }), /not a matching Web server/);
  assert.equal((await fetch(first.url)).status, 200);
});

test('rejects an unrelated HTTP service without killing it or moving ports', async (t) => {
  const options = await fixture(t);
  const unrelated = createHttpServer((_request, response) => response.end('unrelated'));
  await new Promise((resolve) => unrelated.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => unrelated.close(resolve)));
  const port = unrelated.address().port;
  await assert.rejects(startWebDevServer({ ...options, server: { ...options.server, port } }), /not a matching Web server/);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'unrelated');
});

test('simultaneous starts converge on one real Vite server', async (t) => {
  const options = await fixture(t);
  const reservation = createHttpServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const concurrent = { ...options, server: { ...options.server, port } };
  const results = await Promise.all([startWebDevServer(concurrent), startWebDevServer(concurrent)]);
  for (const result of results) if (result.server) t.after(() => result.server.close());
  assert.equal(results.filter((result) => result.reused).length, 1);
  assert.equal((await fetch(`http://127.0.0.1:${port}`)).status, 200);
});

test('official development origin rejects alternate Host headers before serving login content', async (t) => {
  const options = await fixture(t);
  const reservation = createHttpServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const trustedOrigin = `http://127.0.0.1:${port}`;
  const input = { ...options, trustedOrigin, server: { ...options.server, port } };
  const server = await startWebDevServer(input);
  t.after(() => server.server.close());
  assert.match(await (await fetch(server.url)).text(), /Web startup fixture/);
  const wrongHost = await new Promise((resolve, reject) => {
    const request = requestHttp(server.url, { headers: { Host: `localhost:${port}` } }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('error', reject);
    request.end();
  });
  assert.equal(wrongHost.status, 421);
  assert.doesNotMatch(wrongHost.body, /Web startup fixture/);
  assert.equal((await startWebDevServer(input)).reused, true);
  await assert.rejects(startWebDevServer({ ...input, trustedOrigin: `http://localhost:${port}` }), /not a matching Web server/);
});

test('LAN startup needs an explicit official origin and rejects a mismatched listening port', async (t) => {
  const options = await fixture(t);
  await assert.rejects(startWebDevServer({ ...options, server: { ...options.server, host: '0.0.0.0' } }), /requires NIMI_WEB_DEV_ORIGIN/);
  await assert.rejects(startWebDevServer({ ...options, trustedOrigin: 'http://127.0.0.1:3444' }), /listening port/);
});

test('HTTP/2 admits its actual authority and rejects another or conflicting Host', async (t) => {
  const server = createHttp2Server((request, response) => {
    const origin = new URL(`http://127.0.0.1:${server.address().port}`);
    officialOriginGuard(origin)(request, response, () => response.end('admitted'));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const authority = `127.0.0.1:${server.address().port}`;
  const client = connectHttp2(`http://${authority}`);
  t.after(async () => { client.destroy(); await new Promise((resolve) => server.close(resolve)); });
  const status = (headers) => new Promise((resolve, reject) => {
    const request = client.request({ ':path': '/', ...headers });
    let statusCode;
    request.on('response', (response) => { statusCode = response[':status']; });
    request.on('error', reject);
    request.resume(); request.on('end', () => resolve(statusCode)); request.end();
  });
  assert.equal(await status({}), 200);
  assert.equal(await status({ ':authority': 'another.example' }), 421);
  assert.equal(await status({ ':authority': authority, host: 'another.example' }), 421);
});
