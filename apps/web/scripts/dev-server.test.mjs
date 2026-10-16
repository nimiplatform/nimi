import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startWebDevServer } from './dev-server.mjs';

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
