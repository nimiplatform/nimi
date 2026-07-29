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

test('electron chat ai store persists the existing thread/message/draft schema', async (t) => {
  const dataRoot = await temporaryDataRoot('roundtrip');
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const firstHost = createDesktopElectronChatAiStoreHost({
    resolveSelectedDataRoot: () => dataRoot,
    workerUrl: CHAT_AI_STORE_WORKER_URL,
  });
  t.after(() => firstHost.close());
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

  const secondHost = createDesktopElectronChatAiStoreHost({
    resolveSelectedDataRoot: async () => dataRoot,
    workerUrl: CHAT_AI_STORE_WORKER_URL,
  });
  t.after(() => secondHost.close());
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
    assert.equal(version.user_version, 2);
  } finally {
    database.close();
  }
});

test('electron chat ai store fails closed on malformed payloads and orphan messages', async (t) => {
  const dataRoot = await temporaryDataRoot('invalid');
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const host = createDesktopElectronChatAiStoreHost({
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
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  let resolveFirstDataRoot: (() => void) | undefined;
  let resolverCalls = 0;
  const host = createDesktopElectronChatAiStoreHost({
    resolveSelectedDataRoot: () => {
      resolverCalls += 1;
      if (resolverCalls !== 1) return dataRoot;
      return new Promise<string>((resolve) => {
        resolveFirstDataRoot = () => resolve(dataRoot);
      });
    },
    workerUrl: CHAT_AI_STORE_WORKER_URL,
  });
  t.after(() => host.close());

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
      PRAGMA user_version = 2;
    `);
  } finally {
    database.close();
  }
  const host = createDesktopElectronChatAiStoreHost({
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
  const host = createDesktopElectronChatAiStoreHost({
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
  database.exec('PRAGMA user_version = 3;');
  database.close();

  await assert.rejects(
    invoke(host, 'chat_ai_list_threads', { payload: {} }),
    /CHAT_AI_SCHEMA_MISMATCH: expected_version=2 observed_version=3/u,
  );
  const unchanged = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = unchanged.prepare('PRAGMA user_version').get() as { user_version: number };
    assert.equal(row.user_version, 3);
  } finally {
    unchanged.close();
  }
});

test('electron chat ai store does not recreate a missing ready data root', async (t) => {
  const parentRoot = await temporaryDataRoot('missing-parent');
  t.after(() => rm(parentRoot, { recursive: true, force: true }));
  const missingDataRoot = path.join(parentRoot, 'missing-ready-root');
  const host = createDesktopElectronChatAiStoreHost({
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
  const host = createDesktopElectronChatAiStoreHost({
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
  const host = createDesktopElectronChatAiStoreHost({
    resolveSelectedDataRoot: () => dataRoot,
    workerUrl: CHAT_AI_STORE_WORKER_URL,
  });
  t.after(() => host.close());
  await assert.rejects(
    invoke(host, 'chat_ai_list_threads', { payload: {} }),
    /chat-ai-data-root-escape/,
  );
});
