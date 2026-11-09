import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
mkdirSync(path.join(root, '.tmp'), { recursive: true });
const directory = mkdtempSync(path.join(root, '.tmp', 'web-asset-media-'));
await build({ entryPoints: [path.join(root, '../../kit/core/src/app-asset-media.ts')], bundle: true, platform: 'node', format: 'esm',
  outfile: path.join(directory, 'media.mjs'), logLevel: 'silent' });
const { openNimiAppAssetMediaUrl: openLabWebAssetMediaUrl } = await import(pathToFileURL(path.join(directory, 'media.mjs')).href);
test.after(() => rmSync(directory, { recursive: true, force: true }));

// Browser presentation adapter tests; the public reader is a fixture, not Runtime acceptance.
test('Web media consumes the owned reader and exposes a revocable Blob URL', async () => {
  let closed = 0;
  const assets = { async read(input) {
    assert.deepEqual(input, { relativePath: 'images/result.png' });
    return { asset: { mediaType: 'image/png' }, body: (async function* () {
      try { yield Uint8Array.of(1, 2); yield Uint8Array.of(3, 4); } finally { closed++; }
    })() };
  } };
  const handle = await openLabWebAssetMediaUrl(assets, 'images/result.png');
  assert.match(handle.url, /^blob:/);
  const response = await fetch(handle.url);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), Uint8Array.of(1, 2, 3, 4));
  assert.equal(closed, 1);
  await handle.revoke(); await handle.revoke();
  await assert.rejects(() => fetch(handle.url));
});

test('Web media preserves reader errors and never returns a partial preview', async () => {
  let closed = 0;
  const failure = new Error('owned read failed');
  await assert.rejects(() => openLabWebAssetMediaUrl({ read: async () => ({ asset: { mediaType: 'image/png' },
    body: (async function* () { try { yield Uint8Array.of(1); throw failure; } finally { closed++; } })(),
  }) }, 'images/result.png'), error => error === failure);
  assert.equal(closed, 1);
});

test('leaving a preview cancels a pending asset reader', async () => {
  const controller = new AbortController();
  const entered = Promise.withResolvers(), next = Promise.withResolvers();
  let closed = 0;
  const opening = openLabWebAssetMediaUrl({ read: async () => ({ asset: { mediaType: 'image/png' },
    body: { [Symbol.asyncIterator]() { return {
      next() { entered.resolve(); return next.promise; },
      async return() { closed++; next.reject(controller.signal.reason); return { done: true }; },
    }; } },
  }) }, 'images/result.png', controller.signal);
  await entered.promise;
  controller.abort();
  await assert.rejects(opening, error => error.name === 'AbortError');
  assert.equal(closed, 1);
});
