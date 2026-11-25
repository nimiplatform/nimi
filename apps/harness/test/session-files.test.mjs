import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { sessionFilePath, sessionFileTools } from '../dist-electron/session-files.js';

test('import and share preserve bytes, require a session reference, and refuse a link outside the workspace', async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'harness-session-files-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const bytes = Buffer.alloc(1400321, 69);
  const sha256 = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
  const sent = new Map();
  const id = randomUUID();
  const tools = sessionFileTools({
    async read({ relativePath }) {
      assert.equal(relativePath, 'sessions/main/in/' + id);
      return { asset: { mediaType: 'application/pdf', sha256 }, body: (async function* () { yield bytes; })() };
    },
    async write({ relativePath, mediaType, body }) {
      const parts = [];
      for await (const part of body) parts.push(part);
      sent.set(relativePath, { bytes: Buffer.concat(parts), mediaType });
      return { sha256 };
    },
  }, 'main', new AbortController().signal,
    (name, data) => writeFile(join(workspace, name), data, { flag: 'wx' }),
    async name => {
      assert.ok((await lstat(join(workspace, name))).isFile(), 'Choose a regular file.');
      return readFile(join(workspace, name));
    }).tools;
  const run = (name, input) => tools.find(t => t.name === name).execute(input, {}, {});
  const input = await run('open_attachment', { id });
  const name = input.output[0].text;
  assert.match(name, /^attachment-.*\.pdf$/);
  assert.deepEqual(await readFile(join(workspace, name)), bytes);
  const result = await run('share_result_file', { filename: name });
  const published = sent.get('sessions/main/out/' + result.details.id);
  assert.deepEqual(published.bytes, bytes);
  assert.equal(published.mediaType, 'application/pdf');
  assert.throws(() => sessionFilePath('../other', 'in', id));
  assert.throws(() => sessionFilePath('main', 'out', '../in/' + id));
  if (process.platform !== 'win32') {
    await symlink(join(workspace, name), join(workspace, 'alias.pdf'));
    await assert.rejects(run('share_result_file', { filename: 'alias.pdf' }), /regular file/);
  }
  await writeFile(join(workspace, 'empty'), '');
  await assert.rejects(run('share_result_file', { filename: 'empty' }), /nonempty/);
  await assert.rejects(run('share_result_file', { filename: '../outside' }), /top level/);
  assert.equal(sent.size, 1);
});
