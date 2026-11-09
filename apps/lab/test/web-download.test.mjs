import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const root = path.resolve(import.meta.dirname, '..');
mkdirSync(path.join(root, '.tmp'), { recursive: true });
const directory = mkdtempSync(path.join(root, '.tmp', 'web-download-'));
await build({ entryPoints: [path.join(root, 'src/web/download.ts')], bundle: true, platform: 'node', format: 'esm',
  outfile: path.join(directory, 'download.mjs'), logLevel: 'silent' });
const { requestLabWebDownload, downloadLabWebAsset } = await import(pathToFileURL(path.join(directory, 'download.mjs')).href);
const dom = new JSDOM('<body></body>', { url: 'https://lab.example/' });
globalThis.document = dom.window.document;
test.after(() => { dom.window.close(); delete globalThis.document; rmSync(directory, { recursive: true, force: true }); });

// Capture the browser request only; these fixtures do not claim an OS file was saved.
test('text download requests the exact UTF-8 bytes without inventing a Runtime asset', async () => {
  let request;
  dom.window.HTMLAnchorElement.prototype.click = function () { request = { name: this.download, url: this.href, blob: resolveObjectURL(this.href) }; };
  const body = 'Web result · 中文\nSecond line';
  const result = requestLabWebDownload('result-中文.txt', new Blob([body], { type: 'text/plain' }));
  assert.equal(result.destination, 'browser-download');
  assert.equal('artifactPath' in result, false);
  assert.equal('revealed' in result, false);
  assert.equal(request.name, 'result-中文.txt');
  assert.equal(await request.blob.text(), body);
  assert.equal(result.byteSize, new TextEncoder().encode(body).length);
  assert.equal(document.querySelector('a'), null);
  await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(resolveObjectURL(request.url), undefined);
});

test('asset download reads the existing owned bytes and keeps only the filename', async () => {
  let request, reads = 0;
  dom.window.HTMLAnchorElement.prototype.click = function () { request = { name: this.download, blob: resolveObjectURL(this.href) }; };
  const result = await downloadLabWebAsset({ async read(input) {
    reads++; assert.deepEqual(input, { relativePath: 'generated/run/image.png' });
    return { asset: { mediaType: 'image/png' }, body: (async function* () { yield Uint8Array.of(1, 2); yield Uint8Array.of(3); })() };
  } }, 'generated/run/image.png');
  assert.equal(reads, 1); assert.equal(request.name, 'image.png');
  assert.equal(result.byteSize, 3);
  assert.equal(request.blob.type, 'image/png');
  assert.deepEqual(new Uint8Array(await request.blob.arrayBuffer()), Uint8Array.of(1, 2, 3));
});

test('failed reading or browser dispatch never reports a requested download', async () => {
  let clicks = 0, url;
  dom.window.HTMLAnchorElement.prototype.click = function () { clicks++; url = this.href; throw new Error('browser rejected request'); };
  await assert.rejects(() => downloadLabWebAsset({ read: async () => { throw new Error('access revoked'); } }, 'image.png'), /access revoked/);
  assert.equal(clicks, 0);
  assert.throws(() => requestLabWebDownload('image.png', new Blob(['data'])), /browser rejected request/);
  assert.equal(clicks, 1); assert.equal(document.querySelector('a'), null);
  await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(resolveObjectURL(url), undefined);
});
