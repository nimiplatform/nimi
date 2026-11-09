import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, open, readFile, writeFile, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname, '..');
const local = path.join(root, '.nimi/local'); await mkdir(local, { recursive: true });
const directory = await mkdtemp(path.join(local, 'app-files-test-'));
const outfile = path.join(directory, 'files.mjs');
await build({ entryPoints: [path.join(root, 'src/lab/lab-only/app-files.ts')], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
const { writeLabFile, verifyLabFile, LAB_FILE_MISMATCH } = await import(pathToFileURL(outfile).href);
test.after(async () => { assert.equal(path.dirname(directory), local); await rm(directory, { recursive: true, force: true }); });

// Actual temporary-file IO tests the Lab byte probe, not Runtime authorization,
// atomic commit or WebRTC. Those require the supported Lab product journey.
function filesystemAsset(name) {
  const target = path.join(directory, name); let meta; let reads = 0, closed = 0, opens = 0;
  return {
    target, get closed() { return closed; }, get reads() { return reads; }, get opens() { return opens; },
    async write(input) {
      const file = await open(target, 'w'); let size = 0; const hash = createHash('sha256');
      try { for await (const chunk of input.body) { await file.writeFile(chunk); hash.update(chunk); size += chunk.length; } }
      finally { await file.close(); }
      meta = { relativePath: input.relativePath, sizeBytes: size, sha256: `sha256:${hash.digest('hex')}` }; return meta;
    },
    async read() {
      reads++; const stream = createReadStream(target, { highWaterMark: 4096 }); let used = false;
      return { asset: meta, body: { [Symbol.asyncIterator]() {
        assert.equal(used, false, 'one reader per result'); used = true; opens++;
        const inner = stream[Symbol.asyncIterator]();
        return { next: () => inner.next(), async return() { closed++; stream.destroy(); return inner.return(); } };
      } } };
    },
  };
}
const original = new File([new Uint8Array(100_000).map((_, index) => index % 251)], 'input.bin');
test('upload and streamed read-back compare the selected file without saving an AI result', async () => {
  const assets = filesystemAsset('matching.bin'); const signal = new AbortController().signal; let written = 0, compared = 0;
  const meta = await writeLabFile(assets, original, 'lab-transfer-tests/matching.bin', signal, n => { written = n; });
  assert.equal(written, original.size);
  assert.equal((await readFile(assets.target)).length, original.size);
  assert.equal((await verifyLabFile(assets, original, meta.relativePath, signal, n => { compared = n; })).sha256, meta.sha256);
  assert.equal(compared, original.size); assert.equal(assets.closed, 1); assert.equal(assets.opens, 1);
});
test('a corrupted read-back fails and closes its single-use reader', async () => {
  const assets = filesystemAsset('corrupt.bin'); const signal = new AbortController().signal;
  const meta = await writeLabFile(assets, original, 'lab-transfer-tests/corrupt.bin', signal, () => {});
  const content = await readFile(assets.target); content[0] = 255; await writeFile(assets.target, content);
  await assert.rejects(verifyLabFile(assets, original, meta.relativePath, signal, () => {}), { message: LAB_FILE_MISMATCH });
  assert.equal(assets.closed, 1); assert.equal(assets.opens, 1);
});
test('metadata mismatch closes before reading and never starts another upload', async () => {
  const assets = filesystemAsset('size.bin'); const signal = new AbortController().signal;
  const meta = await writeLabFile(assets, original, 'lab-transfer-tests/size.bin', signal, () => {});
  await assert.rejects(verifyLabFile(assets, new File(['short'], 'other.bin'), meta.relativePath, signal, () => {}), { message: LAB_FILE_MISMATCH });
  assert.equal(assets.closed, 1); assert.equal(assets.opens, 1);
  assert.equal((await readFile(assets.target)).length, original.size);
});
