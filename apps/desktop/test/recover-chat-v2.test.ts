import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { listRecoverableThreads, recoverChatV2 } from '../scripts/recover-chat-v2.ts';
import { createDesktopChatAiStoreSession, openChatAiDatabase } from '../src-electron/chat-ai-store-database.ts';

// The v2 draft table has no account key.
function seedV2(file: string) {
  const db = openChatAiDatabase(file);
  db.exec(`
    DROP TABLE ai_thread_drafts;
    CREATE TABLE ai_thread_drafts (
      thread_id TEXT PRIMARY KEY REFERENCES ai_threads(id) ON DELETE CASCADE,
      draft_text TEXT NOT NULL, draft_attachments_json TEXT, updated_at_ms INTEGER NOT NULL
    );
    PRAGMA user_version=2;
    UPDATE ai_store_meta SET value_json='{"version":2}' WHERE key='schemaVersion';
    INSERT INTO ai_threads VALUES('h47','Handoff',1,4,4,NULL);
    INSERT INTO ai_messages VALUES('q','h47','user','complete','Delivery time?','{"parts":[],"toolCalls":[],"attachments":[],"metadata":{}}',NULL,NULL,NULL,NULL,2,2);
    INSERT INTO ai_messages VALUES('a','h47','assistant','complete','17:10','{"parts":[],"toolCalls":[],"attachments":[],"metadata":{}}',NULL,NULL,'trace','q',3,3);
    INSERT INTO ai_thread_drafts VALUES('h47','UNATTRIBUTED_DRAFT_ONLY_1930',NULL,4);
  `);
  return db;
}

test('recover a committed WAL snapshot; keep every sent row and leave unowned drafts only in the source', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nimi-chat-recovery-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const specialCharacters = process.platform === 'win32' ? '#%' : '#%?';
  const input = path.join(dir, `source ${specialCharacters}.db`);
  const snapshot = path.join(dir, `standalone ${specialCharacters}.db`);
  const output = path.join(dir, 'recovered.db');
  const source = seedV2(input);
  try {
    const sourceRows = source.prepare('SELECT * FROM ai_messages ORDER BY created_at_ms, id').all();
    const sourceThreads = source.prepare('SELECT * FROM ai_threads').all();
    source.exec('BEGIN IMMEDIATE');
    source.prepare("UPDATE ai_threads SET title='Not committed' WHERE id='h47'").run();
    await assert.rejects(recoverChatV2(input, output), /standalone SQLite backup/);
    const reader = new DatabaseSync(input, { readOnly: true });
    try {
      await backup(reader, snapshot);
    } finally {
      reader.close();
    }
    const snapshotBytes = await readFile(snapshot);
    assert.deepEqual(await recoverChatV2(snapshot, output), { threads: 1, messages: 2, draftsRetainedInSource: 1 });
    source.exec('ROLLBACK');
    assert.equal(source.prepare('PRAGMA user_version').get()?.user_version, 2);
    assert.equal(source.prepare('SELECT draft_text FROM ai_thread_drafts').get()?.draft_text, 'UNATTRIBUTED_DRAFT_ONLY_1930');
    assert.equal((await readFile(output)).includes(Buffer.from('UNATTRIBUTED_DRAFT_ONLY_1930')), false);
    const recovered = openChatAiDatabase(output);
    try {
      assert.deepEqual(recovered.prepare('SELECT * FROM ai_threads').all(), sourceThreads);
      assert.deepEqual(recovered.prepare('SELECT * FROM ai_messages ORDER BY created_at_ms, id').all(), sourceRows);
      assert.equal(recovered.prepare('SELECT COUNT(*) AS n FROM ai_thread_drafts').get()?.n, 0);
    } finally {
      recovered.close();
    }
    const before = await readFile(output);
    await assert.rejects(recoverChatV2(snapshot, output), { code: 'EEXIST' });
    assert.deepEqual(await readFile(output), before);
    assert.deepEqual(await readFile(snapshot), snapshotBytes);
    assert.deepEqual((await readdir(dir)).filter(name => name.startsWith(path.basename(snapshot))), [path.basename(snapshot)]);
  } finally {
    source.close();
  }
});

test('reject incompatible metadata or destination sidecars without publishing a partial candidate', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nimi-chat-invalid-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'source.db');
  const output = path.join(dir, 'candidate.db');
  const source = seedV2(input);
  source.exec(`UPDATE ai_store_meta SET value_json='{"version":1}'`);
  source.close();
  await assert.rejects(recoverChatV2(input, output), /metadata/);
  assert.deepEqual(await readdir(dir), ['source.db']);
  await writeFile(output + '-wal', 'unrelated contents');
  await assert.rejects(recoverChatV2(input, output), /sidecar/);
  assert.equal(await readFile(output + '-wal', 'utf8'), 'unrelated contents');
});

test('export one selected v2 thread to Harness without copying other messages or the old draft', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nimi-chat-handoff-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'source.db');
  const output = path.join(dir, 'one.nimi-chat.json');
  const source = seedV2(input);
  source.exec(`INSERT INTO ai_threads VALUES('other','Other',1,5,5,NULL);
    INSERT INTO ai_messages VALUES('another','other','user','complete','Other session','{"parts":[],"toolCalls":[],"attachments":[],"metadata":{}}',NULL,NULL,NULL,NULL,5,5);`);
  source.close();
  assert.deepEqual((await listRecoverableThreads(input)).map(row => ({ ...row })), [
    { id: 'other', title: 'Other' }, { id: 'h47', title: 'Handoff' },
  ]);
  assert.deepEqual(await recoverChatV2(input, output, 'h47'), { threads: 1, messages: 2, draftsRetainedInSource: 1 });
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), {
    format: 'nimi.home-chat.v1', threadId: 'h47', title: 'Handoff',
    messages: [{ role: 'user', text: 'Delivery time?' }, { role: 'assistant', text: '17:10' }], draft: '',
  });
  const missing = path.join(dir, 'missing.json');
  await assert.rejects(recoverChatV2(input, missing, 'absent'), /not found/);
  await assert.rejects(readFile(missing), { code: 'ENOENT' });
});

test('Home reads the recovered history for both accounts and partitions newly written drafts', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nimi-chat-scoped-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'original.db');
  seedV2(source).close();
  const folder = path.join(dir, 'apps', 'nimi.desktop', 'data', 'chat-ai');
  await mkdir(folder, { recursive: true });
  await recoverChatV2(source, path.join(folder, 'main.db'));
  const store = createDesktopChatAiStoreSession();
  try {
    const scope = { selectedDataRoot: dir, turnFence: new SharedArrayBuffer(4) };
    const readDraft = (accountKey: string) => store.run({ ...scope, command: 'chat_ai_get_draft', accountKey, payload: { payload: { threadId: 'h47' } } });
    const bundle = await store.run({ ...scope, accountKey: 'test-a', command: 'chat_ai_get_thread_bundle', payload: { payload: { threadId: 'h47' } } });
    assert.ok(bundle && typeof bundle === 'object' && 'messages' in bundle && Array.isArray(bundle.messages));
    assert.deepEqual(bundle.messages.map(m => [m.id, m.parentMessageId]), [['q', null], ['a', 'q']]);
    assert.equal(await readDraft('test-a'), null);
    await store.run({ ...scope, accountKey: 'test-a', command: 'chat_ai_put_draft', payload: { payload: {
      threadId: 'h47', text: 'A newly authored note', attachments: [], updatedAtMs: 7,
    } } });
    assert.deepEqual(await readDraft('test-a'), { threadId: 'h47', text: 'A newly authored note', attachments: [], updatedAtMs: 7 });
    assert.equal(await readDraft('test-b'), null);
  } finally {
    store.close();
  }
});
