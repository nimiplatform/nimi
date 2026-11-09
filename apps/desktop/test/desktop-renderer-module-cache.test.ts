import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'vite';
import { publishBuildOutput } from '../../../scripts/lib/build-output-publisher.mjs';
import desktopViteConfig, { desktopRendererModuleCache } from '../vite.config';

test('Home resolves narrow SDK subpaths without treating a barrel file as a directory', async () => {
  const config = typeof desktopViteConfig === 'function'
    ? await desktopViteConfig({ command: 'serve', mode: 'development' }) : await desktopViteConfig;
  const server = await createServer({ configFile: false, root: path.resolve(import.meta.dirname, '..'),
    resolve: config.resolve, logLevel: 'silent', server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const importer = path.resolve(import.meta.dirname, '../../../kit/core/src/sdk-contract.ts');
    for (const [specifier, suffix] of [
      ['@nimiplatform/sdk/runtime/remote', '/runtime/remote.js'],
      ['@nimiplatform/sdk/realm/runtime-client', '/realm/runtime-client.js'],
    ]) {
      const resolved = await server.environments.client.pluginContainer.resolveId(specifier!, importer);
      assert.ok(resolved?.id.replaceAll('\\', '/').endsWith(suffix!));
    }
  } finally { await server.close(); }
});

test('renderer serves fresh SDK exports at the same URL after atomic dist replacement with HMR disabled', async () => {
  const workspace = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-renderer-cache-')));
  const rendererRoot = path.join(workspace, 'renderer');
  const dist = path.join(workspace, 'sdk', 'dist');
  await mkdir(rendererRoot, { recursive: true });
  await mkdir(dist, { recursive: true });
  await writeFile(path.join(dist, 'index.js'), 'export const original = 1;');
  const server = await createServer({
    configFile: false,
    root: rendererRoot,
    logLevel: 'silent',
    plugins: [desktopRendererModuleCache(dist)],
    server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [workspace] } },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/@fs/${path.join(dist, 'index.js').replaceAll('\\', '/')}`;
    assert.match(await (await fetch(url)).text(), /export const original = 1/);
    // Let Vite finish attaching its watcher to the dependency outside its root.
    await new Promise((resolve) => setTimeout(resolve, 250));
    for (const revision of [2, 3]) {
      const staging = path.join(workspace, `staging-${revision}`);
      await mkdir(staging);
      await writeFile(path.join(staging, 'index.js'), `export const added = ${revision};`);
      publishBuildOutput(staging, dist);
      const deadline = Date.now() + 5000;
      let body = '';
      do {
        await new Promise((resolve) => setTimeout(resolve, 100));
        body = await (await fetch(url)).text();
      } while (!body.includes(`export const added = ${revision}`) && Date.now() < deadline);
      assert.match(body, new RegExp(`export const added = ${revision}`));
      assert.doesNotMatch(body, /export const original/);
    }
  } finally {
    await server.close();
    await rm(workspace, { recursive: true, force: true });
  }
});
