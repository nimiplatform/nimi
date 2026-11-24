import assert from 'node:assert/strict';
import test from 'node:test';
import { receiveFile, uploadFile } from '../src/remote/received-file.ts';

test('open a text result directly, retain all download bytes and refuse an incomplete transfer', async () => {
  const text = '<script>literal content</script>\n' + 'result '.repeat(12000);
  const bytes = new TextEncoder().encode(text);
  const read = (sizeBytes, mediaType) => ({ asset: { sizeBytes, mediaType }, body: (async function* () {
    yield bytes.subarray(0, 523); yield bytes.subarray(523);
  })() });
  const signal = new AbortController().signal;
  const result = await receiveFile(read(bytes.length, 'text/plain; charset=utf-8'), 'id', signal);
  assert.equal(result.text, text.slice(0, 65536));
  assert.equal(result.truncated, true);
  assert.equal(await result.blob.text(), text);
  const unknown = await receiveFile(read(bytes.length, 'text/html'), 'id', signal);
  assert.equal(unknown.text, undefined);
  assert.equal(unknown.name, 'id.bin');
  await assert.rejects(receiveFile(read(bytes.length + 1, 'text/plain'), 'id', signal), /Incomplete/);
});

test('upload reports device bytes as they are pulled and stops reading on cancellation', async () => {
  const file = new Blob([new Uint8Array(1024 * 1024 + 31)]);
  const controller = new AbortController();
  const read = [];
  const chunks = uploadFile(file, controller.signal, (...entry) => read.push(entry));
  assert.equal((await chunks.next()).value.length, 1024 * 1024);
  controller.abort();
  await assert.rejects(chunks.next(), { name: 'AbortError' });
  assert.deepEqual(read, [[1024 * 1024, file.size]]);
});
