import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const clientModule = `data:text/javascript;base64,${Buffer.from('export const getLabLocalAppClient = () => globalThis.__EXPORT_STORAGE_CLIENT__;').toString('base64')}`;
const output = ts.transpileModule(readFileSync(path.join(root, 'src/lab/lab-export.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/from ['"]\.\.\/shell\/local-app-runtime-platform\.js['"]/u, `from ${JSON.stringify(clientModule)}`);
const { saveLabExport } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

test('export preserves text or binary bytes through admitted assets.write/reveal', async () => {
  const writes = [], reveals = [];
  globalThis.__EXPORT_STORAGE_CLIENT__ = { storage: { assets: {
    async write(input) {
      const bytes = Buffer.from(await input.body.arrayBuffer());
      writes.push({ ...input, bytes });
      return { relativePath: input.relativePath, mediaType: input.mediaType, sizeBytes: bytes.length,
        sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
    },
    async reveal(path) { reveals.push(path); return { revealed: true }; },
  } } };
  try {
    const text = await saveLabExport({ filename: 'result.txt', body: '真实结果 · no new inference' });
    assert.equal(writes[0].bytes.toString('utf8'), '真实结果 · no new inference');
    assert.equal(text.byteSize, writes[0].bytes.length);
    assert.equal(text.revealed, true);
    assert.equal(writes[0].mediaType, 'text/plain');
    const bytes = new Uint8Array([0, 255, 7, 9]);
    const binary = await saveLabExport({ filename: 'audio.wav', mimeType: 'audio/wav', body: new Blob([bytes]) });
    assert.deepEqual([...writes[1].bytes], [...bytes]);
    assert.match(binary.artifactPath, /^exports\/[0-9a-f-]+\/audio\.wav$/u);
    assert.equal(binary.mimeType, 'audio/wav');
    assert.equal(writes[1].overwrite, false);
    assert.deepEqual(reveals, [text.artifactPath, binary.artifactPath]);
  } finally { delete globalThis.__EXPORT_STORAGE_CLIENT__; }
});

test('a reveal rejection preserves the successfully saved file and never repeats its write', async () => {
  let writes = 0;
  globalThis.__EXPORT_STORAGE_CLIENT__ = { storage: { assets: {
    async write(input) { writes++; return { relativePath: input.relativePath, sizeBytes: 9, mediaType: input.mediaType }; },
    async reveal() { throw Error('host unavailable'); },
  } } };
  try {
    const saved = await saveLabExport({ filename: 'result.txt', body: 'persisted' });
    assert.equal(saved.revealed, false);
    assert.equal(saved.byteSize, 9);
    assert.match(saved.artifactPath, /\/result.txt$/u);
    assert.equal(writes, 1);
  } finally { delete globalThis.__EXPORT_STORAGE_CLIENT__; }
});

test('a failed export write never reveals or returns a successful saved file', async () => {
  let revealed = false;
  globalThis.__EXPORT_STORAGE_CLIENT__ = { storage: { assets: {
    async write() { throw Error('asset write failed'); },
    async reveal() { revealed = true; },
  } } };
  try {
    await assert.rejects(saveLabExport({ filename: 'result.txt', body: 'not saved' }), /asset write failed/);
    assert.equal(revealed, false);
  } finally { delete globalThis.__EXPORT_STORAGE_CLIENT__; }
});
