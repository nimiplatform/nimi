import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, open, readFile, writeFile, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
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

test('the App files page retries a confirmed upload as a read and clears the result on a path edit', async () => {
  const uiModule = path.join(directory, 'files-ui.mjs');
  await build({
    stdin: { contents: `
      export { LabAppFilesPage } from './src/lab/lab-only/app-files-page.tsx';
      export { LabRendererProvider } from './src/renderer/context.tsx';
      export { i18n } from './src/shell/i18n/index.ts';
    `, resolveDir: root, loader: 'ts' },
    bundle: true, packages: 'external', format: 'esm', platform: 'node', jsx: 'automatic', outfile: uiModule, logLevel: 'silent',
  });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { LabAppFilesPage, LabRendererProvider, i18n } = await import(pathToFileURL(uiModule).href);
  await i18n.changeLanguage('en');
  const container = dom.window.document.getElementById('root');
  const renderer = createRoot(container);
  const stored = filesystemAsset('ui-recover.bin');
  const writes = [];
  const reads = [];
  const assets = {
    write: async (input) => { writes.push(input.relativePath); return stored.write(input); },
    read: async (input) => {
      reads.push(input.relativePath);
      if (reads.length === 1) throw new Error('read-interrupted');
      return stored.read();
    },
  };
  const click = async (label) => {
    const button = [...container.querySelectorAll('button')].find(node => node.textContent === label);
    assert.ok(button && !button.disabled, label);
    await act(async () => button.click());
  };
  const waitForText = async (expression) => {
    for (let attempt = 0; attempt < 50 && !expression.test(container.textContent); attempt += 1) {
      await act(async () => delay(10));
    }
    assert.match(container.textContent, expression);
  };
  try {
    await act(async () => renderer.render(createElement(LabRendererProvider, {
      bindings: { sdk: { localAppClient: { storage: { assets } } } },
    }, createElement(LabAppFilesPage))));
    const fileInput = container.querySelector('input[type="file"]');
    const pathInput = container.querySelector('input[aria-label="App asset path"]');
    Object.defineProperty(fileInput, 'files', { value: [original] });
    await act(async () => fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
    await click('Upload new file and verify');
    await waitForText(/Runtime confirmed the write at this path/u);
    assert.match(container.textContent, /Could not read back the complete file/u);
    assert.equal(pathInput.value, writes[0]);

    await click('Verify existing file');
    await waitForText(/The complete read-back matches the selected file/u);
    assert.deepEqual(reads, [writes[0], writes[0]]);
    assert.equal(writes.length, 1);

    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(pathInput, 'another.bin');
      pathInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    assert.doesNotMatch(container.textContent, /The complete read-back matches the selected file/u);
  } finally {
    await act(async () => renderer.unmount());
    dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
