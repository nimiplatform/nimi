import assert from 'node:assert/strict';
import {
  lstat,
  mkdtemp,
  mkdir,
  readdir,
  rm,
  symlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  createDesktopElectronChatAiStoreHost,
  type DesktopElectronChatAiStoreHost,
} from '../src-electron/chat-ai-store-host.js';
import type {
  ChatAiMessageContent,
} from '../src/shell/shared/chat-ai-store-types.js';

const CHAT_AI_STORE_WORKER_URL = new URL(
  '../src-electron/chat-ai-store-worker.ts',
  import.meta.url,
);

function createTestHost(input: Parameters<typeof createDesktopElectronChatAiStoreHost>[0]) {
  const signal = new AbortController().signal;
  return createDesktopElectronChatAiStoreHost({ resolveTurnScope: async () => ({ signal, revision: 'active', accountKey: 'account' }), ...input });
}

function content(text: string): ChatAiMessageContent {
  return {
    parts: [{ type: 'text', text }],
    toolCalls: [],
    attachments: [],
    metadata: {},
  };
}

async function temporaryDataRoot(label: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), `nimi-electron-chat-${label}-`));
}

function invoke(
  host: DesktopElectronChatAiStoreHost,
  command: keyof DesktopElectronChatAiStoreHost['commandHandlers'],
  payload: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  return host.commandHandlers[command]({ command, payload });
}

test('failed quit replaces the closed chat worker and preserves durable drafts through existing handlers', async (t) => {
  const dataRoot = await temporaryDataRoot('quit-recovery');
  const host = createTestHost({ resolveSelectedDataRoot: () => dataRoot, workerUrl: CHAT_AI_STORE_WORKER_URL });
  t.after(async () => { await host.close(); await rm(dataRoot, { recursive: true, force: true }); });
  assert.equal(await host.resumeAfterFailedShutdown(), false);
  await invoke(host, 'chat_ai_create_thread', { payload: { id: 'recovery-thread', title: 'Recovery', createdAtMs: 100, updatedAtMs: 100, lastMessageAtMs: null } });
  await invoke(host, 'chat_ai_put_draft', { payload: { threadId: 'recovery-thread', text: 'preserved draft', attachments: [], updatedAtMs: 120 } });
  await host.close();
  await assert.rejects(invoke(host, 'chat_ai_get_thread_bundle', { payload: { threadId: 'recovery-thread' } }), /chat-ai-store-worker-unavailable/);
  assert.equal(await host.resumeAfterFailedShutdown(), true);
  const bundle = await invoke(host, 'chat_ai_get_thread_bundle', { payload: { threadId: 'recovery-thread' } }) as { draft: { text: string } };
  assert.equal(bundle.draft.text, 'preserved draft');
  await invoke(host, 'chat_ai_put_draft', { payload: { threadId: 'recovery-thread', text: 'new draft', attachments: [], updatedAtMs: 130 } });
  assert.equal(await host.resumeAfterFailedShutdown(), false);
});

test('electron chat ai store persists the existing thread/message/draft schema', async (t) => {
  const dataRoot = await temporaryDataRoot('roundtrip');
  const firstHost = createTestHost({
    resolveSelectedDataRoot: () => dataRoot,
    workerUrl: CHAT_AI_STORE_WORKER_URL,
  });
  const hosts = [firstHost];
  t.after(async () => {
    for (const host of hosts.reverse()) await host.close();
    await rm(dataRoot, { recursive: true, force: true });
  });
  const thread = await invoke(firstHost, 'chat_ai_create_thread', {
    payload: {
      id: 'thread-1',
      title: 'Alpha',
      createdAtMs: 100,
      updatedAtMs: 100,
      lastMessageAtMs: null,
    },
  }) as { id: string };
  assert.equal(thread.id, 'thread-1');
  assert.deepEqual(
    await invoke(firstHost, 'chat_ai_list_threads', { payload: {} }),
    [],
  );

  await invoke(firstHost, 'chat_ai_create_message', {
    payload: {
      id: 'message-1',
      threadId: 'thread-1',
      role: 'user',
      status: 'complete',
      contentText: 'hello',
      content: content('hello'),
      error: null,
      traceId: 'trace-1',
      parentMessageId: null,
      createdAtMs: 110,
      updatedAtMs: 110,
    },
  });
  await invoke(firstHost, 'chat_ai_update_thread_metadata', {
    payload: {
      id: 'thread-1',
      title: 'Alpha',
      updatedAtMs: 110,
      lastMessageAtMs: 110,
    },
  });
  await invoke(firstHost, 'chat_ai_put_draft', {
    payload: {
      threadId: 'thread-1',
      text: 'draft',
      attachments: [{
        attachmentId: 'attachment-1',
        name: 'note.txt',
        mimeType: 'text/plain',
        sizeBytes: 12,
      }],
      updatedAtMs: 120,
    },
  });

  const secondHost = createTestHost({
    resolveSelectedDataRoot: async () => dataRoot,
    workerUrl: CHAT_AI_STORE_WORKER_URL,
  });
  hosts.push(secondHost);
  const bundle = await invoke(secondHost, 'chat_ai_get_thread_bundle', {
    payload: { threadId: 'thread-1' },
  }) as {
    thread: { lastMessageAtMs: number };
    messages: Array<{ id: string; contentText: string }>;
    draft: { text: string; attachments: unknown[] };
  };
  assert.equal(bundle.thread.lastMessageAtMs, 110);
  assert.deepEqual(bundle.messages.map((message) => message.id), ['message-1']);
  assert.equal(bundle.messages[0]?.contentText, 'hello');
  assert.equal(bundle.draft.text, 'draft');
  assert.equal(bundle.draft.attachments.length, 1);

  await invoke(secondHost, 'chat_ai_update_message', {
    payload: {
      id: 'message-1',
      status: 'complete',
      contentText: 'hello again',
      content: content('hello again'),
      error: null,
      traceId: 'trace-2',
      updatedAtMs: 130,
    },
  });
  await invoke(secondHost, 'chat_ai_delete_draft', {
    payload: { threadId: 'thread-1' },
  });
  const persisted = await invoke(firstHost, 'chat_ai_get_thread_bundle', {
    payload: { threadId: 'thread-1' },
  }) as {
    messages: Array<{ contentText: string; traceId: string }>;
    draft: null;
  };
  assert.equal(persisted.messages[0]?.contentText, 'hello again');
  assert.equal(persisted.messages[0]?.traceId, 'trace-2');
  assert.equal(persisted.draft, null);

  const database = new DatabaseSync(path.join(
    dataRoot,
    'apps',
    'nimi.desktop',
    'data',
    'chat-ai',
    'main.db',
  ), {
    readOnly: true,
  });
  try {
    const version = database.prepare('PRAGMA user_version').get() as { user_version: number };
    assert.equal(version.user_version, 3);
  } finally {
    database.close();
  }
});

test('electron chat ai store fails closed on malformed payloads and orphan messages', async (t) => {
  const dataRoot = await temporaryDataRoot('invalid');
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const host = createTestHost({
    resolveSelectedDataRoot: () => dataRoot,
    workerUrl: CHAT_AI_STORE_WORKER_URL,
  });
  t.after(() => host.close());
  await assert.rejects(
    invoke(host, 'chat_ai_create_thread', {
      payload: {
        id: 'thread-1',
        title: 'Alpha',
        createdAtMs: -1,
        updatedAtMs: 1,
        lastMessageAtMs: null,
      },
    }),
    /createdAtMs must be a non-negative safe integer/,
  );
  await assert.rejects(
    invoke(host, 'chat_ai_create_message', {
      payload: {
        id: 'message-1',
        threadId: 'missing-thread',
        role: 'user',
        status: 'complete',
        contentText: 'hello',
        content: content('hello'),
        error: null,
        traceId: null,
        parentMessageId: null,
        createdAtMs: 10,
        updatedAtMs: 10,
      },
    }),
    /missing referenced thread/,
  );
  await assert.rejects(
    invoke(host, 'chat_ai_create_thread', {
      payload: {
        id: 'thread-coerced-time',
        title: 'Alpha',
        createdAtMs: false,
        updatedAtMs: 1,
        lastMessageAtMs: null,
      },
    }),
    /createdAtMs must be an integer/,
  );
  await assert.rejects(
    invoke(host, 'chat_ai_create_thread', {
      payload: {
        id: {},
        title: 'Alpha',
        createdAtMs: 1,
        updatedAtMs: 1,
        lastMessageAtMs: null,
      },
    }),
    /id must be a string/,
  );
  await assert.rejects(
    invoke(host, 'chat_ai_list_threads', {
      payload: {},
      dataRoot: '/tmp/renderer-controlled',
    }),
    /chat-ai-store-payload-invalid/,
  );
});

test('electron chat ai store preserves invocation order across data-root resolution', async (t) => {
  const dataRoot = await temporaryDataRoot('ordered');
  let resolveFirstDataRoot: (() => void) | undefined;
  let resolverCalls = 0;
  const host = createTestHost({
    resolveSelectedDataRoot: () => {
      resolverCalls += 1;
      if (resolverCalls !== 1) return dataRoot;
      return new Promise<string>((resolve) => {
        resolveFirstDataRoot = () => resolve(dataRoot);
      });
    },
    workerUrl: CHAT_AI_STORE_WORKER_URL,
  });
  t.after(async () => {
    await host.close();
    await rm(dataRoot, { recursive: true, force: true });
  });

  const createThread = invoke(host, 'chat_ai_create_thread', {
    payload: {
      id: 'ordered-thread',
      title: 'Ordered',
      createdAtMs: 1,
      updatedAtMs: 1,
      lastMessageAtMs: null,
    },
  });
  const createMessage = invoke(host, 'chat_ai_create_message', {
    payload: {
      id: 'ordered-message',
      threadId: 'ordered-thread',
      role: 'user',
      status: 'complete',
      contentText: 'ordered',
      content: content('ordered'),
      error: null,
      traceId: null,
      parentMessageId: null,
      createdAtMs: 2,
      updatedAtMs: 2,
    },
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(resolverCalls, 1);
  assert.ok(resolveFirstDataRoot);
  resolveFirstDataRoot();
  await Promise.all([createThread, createMessage]);
  assert.equal(resolverCalls, 2);
});

test('electron chat ai store rejects the retired route-bound schema', async (t) => {
  const dataRoot = await temporaryDataRoot('legacy');
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const chatDirectory = path.join(
    dataRoot,
    'apps',
    'nimi.desktop',
    'data',
    'chat-ai',
  );
  await mkdir(chatDirectory, { recursive: true });
  const database = new DatabaseSync(path.join(chatDirectory, 'main.db'));
  try {
    database.exec(`
      CREATE TABLE ai_threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        last_message_at_ms INTEGER,
        archived_at_ms INTEGER,
        route_kind TEXT NOT NULL
      );
      PRAGMA user_version = 3;
    `);
  } finally {
    database.close();
  }
  const host = createTestHost({
    resolveSelectedDataRoot: () => dataRoot,
    workerUrl: CHAT_AI_STORE_WORKER_URL,
  });
  t.after(() => host.close());
  await assert.rejects(
    invoke(host, 'chat_ai_list_threads', { payload: {} }),
    /CHAT_AI_SCHEMA_MISMATCH.*forbidden_legacy_columns=route_kind/,
  );
});

test('electron chat ai store rejects an unknown existing schema version without rewriting it', async (t) => {
  const dataRoot = await temporaryDataRoot('future-schema');
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const host = createTestHost({
    resolveSelectedDataRoot: () => dataRoot,
    workerUrl: CHAT_AI_STORE_WORKER_URL,
  });
  t.after(() => host.close());
  await invoke(host, 'chat_ai_list_threads', { payload: {} });
  const databasePath = path.join(
    dataRoot,
    'apps',
    'nimi.desktop',
    'data',
    'chat-ai',
    'main.db',
  );
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA user_version = 4;');
  database.close();

  await assert.rejects(
    invoke(host, 'chat_ai_list_threads', { payload: {} }),
    /CHAT_AI_SCHEMA_MISMATCH: expected_version=3 observed_version=4/u,
  );
  const unchanged = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = unchanged.prepare('PRAGMA user_version').get() as { user_version: number };
    assert.equal(row.user_version, 4);
  } finally {
    unchanged.close();
  }
});

test('electron chat ai store does not recreate a missing ready data root', async (t) => {
  const parentRoot = await temporaryDataRoot('missing-parent');
  t.after(() => rm(parentRoot, { recursive: true, force: true }));
  const missingDataRoot = path.join(parentRoot, 'missing-ready-root');
  const host = createTestHost({
    resolveSelectedDataRoot: () => missingDataRoot,
    workerUrl: CHAT_AI_STORE_WORKER_URL,
  });
  t.after(() => host.close());

  await assert.rejects(
    invoke(host, 'chat_ai_list_threads', { payload: {} }),
    /chat-ai-data-root-unavailable/u,
  );
  await assert.rejects(
    lstat(missingDataRoot),
    (error: unknown) => Boolean(
      error
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'ENOENT',
    ),
  );
});

test('electron chat ai store rejects an intermediate symlink before writing descendants', {
  skip: process.platform === 'win32',
}, async (t) => {
  const dataRoot = await temporaryDataRoot('intermediate-symlink');
  const outsideRoot = await temporaryDataRoot('intermediate-outside');
  t.after(() => Promise.all([
    rm(dataRoot, { recursive: true, force: true }),
    rm(outsideRoot, { recursive: true, force: true }),
  ]));
  await symlink(outsideRoot, path.join(dataRoot, 'apps'), 'dir');
  const host = createTestHost({
    resolveSelectedDataRoot: () => dataRoot,
    workerUrl: CHAT_AI_STORE_WORKER_URL,
  });
  t.after(() => host.close());

  await assert.rejects(
    invoke(host, 'chat_ai_list_threads', { payload: {} }),
    /chat-ai-data-root-escape/u,
  );
  assert.deepEqual(await readdir(outsideRoot), []);
});

test('electron chat ai store rejects a sibling symlinked chat database directory', {
  skip: process.platform === 'win32',
}, async (t) => {
  const dataRoot = await temporaryDataRoot('symlink-root');
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const durableDataRoot = path.join(dataRoot, 'apps', 'nimi.desktop', 'data');
  await mkdir(durableDataRoot, { recursive: true });
  const siblingDirectory = path.join(durableDataRoot, 'other-chat');
  await mkdir(siblingDirectory);
  await symlink(siblingDirectory, path.join(durableDataRoot, 'chat-ai'), 'dir');
  const host = createTestHost({
    resolveSelectedDataRoot: () => dataRoot,
    workerUrl: CHAT_AI_STORE_WORKER_URL,
  });
  t.after(() => host.close());
  await assert.rejects(
    invoke(host, 'chat_ai_list_threads', { payload: {} }),
    /chat-ai-data-root-escape/,
  );
});

test('whole Chat turn commits once, preserves a later draft, and rejects an old queued scope', async (t) => {
  const dataRoot = await temporaryDataRoot('commit-turn');
  let releaseRoot: (() => void) | undefined;
  let enteredRoot: (() => void) | undefined;
  const session = new AbortController();
  const host = createTestHost({
    resolveSelectedDataRoot: async () => {
      if (enteredRoot) await new Promise<void>(resolve => { releaseRoot = resolve; enteredRoot?.(); });
      return dataRoot;
    },
    resolveTurnScope: async () => ({ signal: session.signal, revision: 'account-a', accountKey: 'realm/account-a' }),
    workerUrl: CHAT_AI_STORE_WORKER_URL,
  });
  t.after(async () => { await host.close(); await rm(dataRoot, { recursive: true, force: true }); });
  const thread = { id: 'thread', title: 'History', createdAtMs: 100, updatedAtMs: 100, lastMessageAtMs: null };
  const draft = { threadId: thread.id, text: 'old draft', attachments: [], updatedAtMs: 111 };
  await invoke(host, 'chat_ai_create_thread', { payload: thread });
  await invoke(host, 'chat_ai_put_draft', { payload: { ...draft, text: 'new draft', updatedAtMs: 120 } });
  const message = (id: string, role: 'user' | 'assistant', parentMessageId: string | null) => ({
    id, threadId: thread.id, role, status: 'complete', contentText: id,
    content: content(id), parentMessageId, traceId: null, error: null, createdAtMs: 200, updatedAtMs: 200,
  });
  const scopeId = await invoke(host, 'chat_ai_begin_turn', {});
  const payload = { scopeId, thread, user: message('user', 'user', null), assistant: message('assistant', 'assistant', 'user'), consumedDraft: draft };
  const saved = await invoke(host, 'chat_ai_commit_turn', { payload });
  const repeated = await invoke(host, 'chat_ai_commit_turn', { payload });
  assert.deepEqual(repeated, saved);
  const before = await invoke(host, 'chat_ai_get_thread_bundle', { payload: { threadId: thread.id } }) as { draft: typeof draft; messages: unknown[] };
  assert.equal(before.messages.length, 2);
  assert.equal(before.draft.text, 'new draft');

  const queued = new Promise<void>(resolve => { enteredRoot = resolve; });
  const late = invoke(host, 'chat_ai_commit_turn', { payload: { ...payload, user: message('late-user', 'user', null), assistant: message('late-reply', 'assistant', 'late-user') } });
  const refused = assert.rejects(late, /chat-ai-turn-scope-ended/);
  await queued;
  host.observeAccountRevision('');
  host.observeAccountRevision('account-a');
  enteredRoot = undefined;
  releaseRoot?.();
  await refused;
  assert.deepEqual(await invoke(host, 'chat_ai_get_thread_bundle', { payload: { threadId: thread.id } }), before);

  // A uniqueness violation on the second message must roll back the first.
  const other = { ...thread, id: 'other-thread' };
  await invoke(host, 'chat_ai_create_thread', { payload: other });
  await invoke(host, 'chat_ai_create_message', { payload: { ...message('existing-reply', 'assistant', null), threadId: other.id } });
  const nextScope = await invoke(host, 'chat_ai_begin_turn', {});
  await assert.rejects(invoke(host, 'chat_ai_commit_turn', { payload: {
    ...payload, scopeId: nextScope, user: message('rollback-user', 'user', null), assistant: message('existing-reply', 'assistant', 'rollback-user'),
  } }));
  await host.close();
  assert.equal(await host.resumeAfterFailedShutdown(), true);
  assert.deepEqual(await invoke(host, 'chat_ai_get_thread_bundle', { payload: { threadId: thread.id } }), before);
});

test('same root and thread restore only the current account draft and refuse a queued old write', async t => {
  const root = await temporaryDataRoot('scoped-drafts');
  let account = 'A';
  const signal = new AbortController().signal;
  let hold: { entered: () => void; released: Promise<void> } | undefined;
  const host = createTestHost({
    workerUrl: CHAT_AI_STORE_WORKER_URL,
    resolveSelectedDataRoot: async () => { if (hold) { hold.entered(); await hold.released; } return root; },
    resolveTurnScope: async () => ({ signal, revision: account, accountKey: account }),
  });
  t.after(async () => { await host.close(); await rm(root, { recursive: true, force: true }); });
  const select = (owner: string) => { account = owner; host.observeAccountRevision(owner); };
  const read = () => invoke(host, 'chat_ai_get_draft', { payload: { threadId: 'shared' } }) as Promise<{ text: string } | null>;
  const put = (text: string) => invoke(host, 'chat_ai_put_draft', { payload: { threadId: 'shared', text, attachments: [], updatedAtMs: 3 } });
  select('A');
  await invoke(host, 'chat_ai_create_thread', { payload: { id: 'shared', title: 'Shared key', createdAtMs: 1, updatedAtMs: 1, lastMessageAtMs: null } });
  await put('first owner');
  select('B');
  assert.equal(await read(), null);
  await put('second owner');
  select('A');
  assert.equal((await read())?.text, 'first owner');
  let releaseWrite!: () => void;
  const released = new Promise<void>(resolve => { releaseWrite = resolve; });
  const entered = new Promise<void>(resolve => { hold = { entered: resolve, released }; });
  const late = assert.rejects(put('late overwrite'), /scope-ended/);
  await entered;
  select('B');
  hold = undefined;
  releaseWrite();
  await late;
  const bundle = await invoke(host, 'chat_ai_get_thread_bundle', { payload: { threadId: 'shared' } }) as { draft: { text: string } };
  assert.equal(bundle.draft.text, 'second owner');
  await invoke(host, 'chat_ai_delete_draft', { payload: { threadId: 'shared' } });
  select('A');
  assert.equal((await read())?.text, 'first owner');
});

test('bounded turn context reads complete parent pairs at 100, 1000 and 10000 turns', async t => {
  const dataRoot = await temporaryDataRoot('bounded-context');
  const host = createTestHost({ resolveSelectedDataRoot: () => dataRoot, workerUrl: CHAT_AI_STORE_WORKER_URL });
  t.after(async () => { await host.close(); await rm(dataRoot, { recursive: true, force: true }); });
  const thread = { id: 'long', title: 'Long', createdAtMs: 1, updatedAtMs: 1, lastMessageAtMs: null };
  await invoke(host, 'chat_ai_create_thread', { payload: thread });
  const db = new DatabaseSync(path.join(dataRoot, 'apps', 'nimi.desktop', 'data', 'chat-ai', 'main.db'));
  const insert = db.prepare(`INSERT INTO ai_messages(id,thread_id,role,status,content_text,content_json,parent_message_id,created_at_ms,updated_at_ms)
    VALUES(?,'long',?,?,?,?,?,?,?)`);
  const add = (id: string, role: string, state: string, text: string, parent: string | null, time: number) =>
    insert.run(id, role, state, text, JSON.stringify(content(text)), parent, time, time);
  const query = async () => (await invoke(host, 'chat_ai_get_turn_context', { payload: {threadId:'long'} }) as {
    messages: { id: string }[];
  }).messages.map(message => message.id);
  try {
    let from = 0;
    for (const size of [100, 1000, 10000]) {
      db.exec('BEGIN');
      for (let i = from; i < size; i++) {
        add('u'+i, 'user', 'complete', 'question', null, i*2);
        add('a'+i, 'assistant', 'complete', 'answer', 'u'+i, i*2+1);
      }
      db.exec('COMMIT');
      const start = performance.now();
      const ids = await query();
      t.diagnostic(`${size} turns, read ${(performance.now()-start).toFixed(2)} ms`);
      assert.equal(ids.length, 32);
      assert.deepEqual(ids.slice(0,2), ['u'+(size-16),'a'+(size-16)]);
      assert.deepEqual(ids.slice(-2), ['u'+(size-1),'a'+(size-1)]);
      from = size;
    }
    add('latest-reply', 'assistant', 'complete', 'amended', 'u9999', 20001);
    for (let i=0; i<36; i++) add('failed'+i, 'assistant', 'failed', 'failed', 'u9999', 20002+i);
    const ids = await query();
    assert.equal(ids.length,32);
    assert.deepEqual(ids.slice(-2), ['u9999','latest-reply']);
    assert.ok(!ids.includes('a9999'));
    add('oversized', 'assistant', 'complete', 'x'.repeat(512*1024), 'u9999', 20040);
    assert.deepEqual(await query(), []);
  } finally {
    db.close();
  }
});
