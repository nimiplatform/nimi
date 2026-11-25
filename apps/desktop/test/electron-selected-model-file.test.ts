import assert from 'node:assert/strict';
import test from 'node:test';
import { importPickedModelFile } from '../src-electron/model-file-import.js';

test('the native selection controls which file the importer receives', async () => {
  const opened: string[] = [];
  const selected = '/Users/test/Downloads/community.gguf_file';
  const submitted = await importPickedModelFile(async (options) => {
    assert.equal(options.kind, 'file');
    assert.equal(options.filters?.[0]?.name, 'Asset Files');
    assert.ok(options.filters?.[0]?.extensions.includes('gguf_file'));
    return { canceled: false, paths: [selected] };
  }, async (path) => { opened.push(path); });
  assert.equal(submitted, true);
  assert.deepEqual(opened, [selected]);
  const importUnexpected = async () => { assert.fail('unexpected import'); };
  assert.equal(await importPickedModelFile(async () => ({ canceled: true, paths: [] }), importUnexpected), false);
  await assert.rejects(importPickedModelFile(async () => ({ canceled: false, paths: [selected, 'sibling'] }), importUnexpected));
});
