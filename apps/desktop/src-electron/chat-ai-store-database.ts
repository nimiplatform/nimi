import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import {
  parseChatAiCreateMessageInput,
  parseChatAiCreateThreadInput,
  parseChatAiDraftRecord,
  parseChatAiMessageRecord,
  parseChatAiPutDraftInput,
  parseChatAiThreadBundle,
  parseChatAiThreadRecord,
  parseChatAiThreadSummaries,
  parseChatAiUpdateMessageInput,
  parseChatAiUpdateThreadMetadataInput,
} from '../src/shell/shared/chat-ai-store-parsers.ts';
import type {
  ChatAiAttachment,
  ChatAiCreateMessageInput,
  ChatAiCreateThreadInput,
  ChatAiDraftRecord,
  ChatAiMessageContent,
  ChatAiMessageError,
  ChatAiMessageRecord,
  ChatAiPutDraftInput,
  ChatAiThreadBundle,
  ChatAiThreadRecord,
  ChatAiThreadSummary,
  ChatAiUpdateMessageInput,
  ChatAiUpdateThreadMetadataInput,
} from '../src/shell/shared/chat-ai-store-types.js';
import type { ChatAiCommand } from './chat-ai-store-worker-protocol.js';

const CHAT_AI_SCHEMA_VERSION = 2;
const DESKTOP_APP_ID = 'nimi.desktop';
const APPS_DIRECTORY = 'apps';
const APP_DATA_DIRECTORY = 'data';
const CHAT_AI_DIRECTORY = 'chat-ai';
const CHAT_AI_DATABASE = 'main.db';
type ChatAiDatabaseOperation = (database: DatabaseSync) => unknown;

export async function runDesktopChatAiStoreOperation(input: {
  readonly command: ChatAiCommand;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly selectedDataRoot: string;
}): Promise<unknown> {
  const operation = prepareChatAiOperation(input.command, input.payload);
  const databasePath = await resolveChatAiDatabasePath(input.selectedDataRoot);
  const database = openDatabase(databasePath);
  try {
    return operation(database);
  } finally {
    database.close();
  }
}

function prepareChatAiOperation(
  command: ChatAiCommand,
  payload: Readonly<Record<string, unknown>>,
): ChatAiDatabaseOperation {
  switch (command) {
    case 'chat_ai_list_threads':
      requireNestedPayload(payload, []);
      return listThreads;
    case 'chat_ai_get_thread_bundle': {
      const threadId = requiredThreadId(requireNestedPayload(payload, ['threadId']));
      return (database) => getThreadBundle(database, threadId);
    }
    case 'chat_ai_create_thread': {
      const input = checkedCreateThreadInput(requireNestedPayload(payload, [
        'id',
        'title',
        'createdAtMs',
        'updatedAtMs',
        'lastMessageAtMs',
      ]));
      return (database) => createThread(database, input);
    }
    case 'chat_ai_update_thread_metadata': {
      const input = checkedUpdateThreadInput(requireNestedPayload(payload, [
        'id',
        'title',
        'updatedAtMs',
        'lastMessageAtMs',
      ]));
      return (database) => updateThreadMetadata(database, input);
    }
    case 'chat_ai_create_message': {
      const input = checkedCreateMessageInput(requireNestedPayload(payload, [
        'id',
        'threadId',
        'role',
        'status',
        'contentText',
        'content',
        'error',
        'traceId',
        'parentMessageId',
        'createdAtMs',
        'updatedAtMs',
      ]));
      return (database) => createMessage(database, input);
    }
    case 'chat_ai_update_message': {
      const input = checkedUpdateMessageInput(requireNestedPayload(payload, [
        'id',
        'status',
        'contentText',
        'content',
        'error',
        'traceId',
        'updatedAtMs',
      ]));
      return (database) => updateMessage(database, input);
    }
    case 'chat_ai_get_draft': {
      const threadId = requiredThreadId(requireNestedPayload(payload, ['threadId']));
      return (database) => getDraft(database, threadId);
    }
    case 'chat_ai_put_draft': {
      const input = checkedPutDraftInput(requireNestedPayload(payload, [
        'threadId',
        'text',
        'attachments',
        'updatedAtMs',
      ]));
      return (database) => putDraft(database, input);
    }
    case 'chat_ai_delete_draft': {
      const threadId = requiredThreadId(requireNestedPayload(payload, ['threadId']));
      return (database) => deleteDraft(database, threadId);
    }
  }
}

async function resolveChatAiDatabasePath(selectedDataRootInput: unknown): Promise<string> {
  const selectedDataRoot = typeof selectedDataRootInput === 'string'
    ? selectedDataRootInput.trim()
    : '';
  if (!selectedDataRoot || !path.isAbsolute(selectedDataRoot)) {
    throw new Error('chat-ai-data-root-invalid');
  }
  const selectedDataRootStat = await lstat(selectedDataRoot).catch((error: unknown) => {
    if (isMissingPathError(error)) {
      throw new Error('chat-ai-data-root-unavailable', { cause: error });
    }
    throw error;
  });
  if (!selectedDataRootStat.isDirectory() || selectedDataRootStat.isSymbolicLink()) {
    throw new Error('chat-ai-data-root-invalid');
  }
  const canonicalSelectedDataRoot = await realpath(selectedDataRoot);
  // Keep the existing Runtime GetAppStorage durable-root layout while the
  // protected Electron carrier derives it from the canonical Product Control root.
  const appsRoot = await ensureFixedChildDirectory(
    canonicalSelectedDataRoot,
    APPS_DIRECTORY,
  );
  const desktopRoot = await ensureFixedChildDirectory(appsRoot, DESKTOP_APP_ID);
  const canonicalDesktopDurableDataRoot = await ensureFixedChildDirectory(
    desktopRoot,
    APP_DATA_DIRECTORY,
  );
  const canonicalChatDirectory = await ensureFixedChildDirectory(
    canonicalDesktopDurableDataRoot,
    CHAT_AI_DIRECTORY,
  );
  const databasePath = path.join(canonicalChatDirectory, CHAT_AI_DATABASE);
  try {
    const databaseStat = await lstat(databasePath);
    if (!databaseStat.isFile() || databaseStat.isSymbolicLink()) {
      throw new Error('chat-ai-database-path-invalid');
    }
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
  return databasePath;
}

async function ensureFixedChildDirectory(
  canonicalParent: string,
  childName: string,
): Promise<string> {
  const target = path.join(canonicalParent, childName);
  try {
    await mkdir(target, { mode: 0o700 });
  } catch (error) {
    if (!isExistingPathError(error)) throw error;
  }
  const targetStat = await lstat(target);
  if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
    throw new Error('chat-ai-data-root-escape');
  }
  const canonicalTarget = await realpath(target);
  if (
    !sameFilesystemPath(canonicalTarget, target)
    || !sameFilesystemPath(path.dirname(canonicalTarget), canonicalParent)
  ) {
    throw new Error('chat-ai-data-root-escape');
  }
  return canonicalTarget;
}

function sameFilesystemPath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US')
    : left === right;
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && error.code === 'ENOENT',
  );
}

function isExistingPathError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && error.code === 'EEXIST',
  );
}

function openDatabase(databasePath: string): DatabaseSync {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `);
    initializeSchema(database);
    database.exec('PRAGMA journal_mode = WAL;');
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function initializeSchema(database: DatabaseSync): void {
  const observedVersion = readSchemaVersion(database);
  if (hasApplicationSchema(database)) {
    requireExpectedSchemaVersion(observedVersion);
    validateSchema(database);
    validateSchemaVersionMeta(database);
    return;
  }
  if (observedVersion !== 0) {
    throw schemaVersionMismatch(observedVersion);
  }

  database.exec('BEGIN IMMEDIATE;');
  try {
    createSchema(database);
    validateSchema(database);
    database.prepare(`
      INSERT INTO ai_store_meta (key, value_json, updated_at_ms)
      VALUES ('schemaVersion', ?, 0)
    `).run(JSON.stringify({ version: CHAT_AI_SCHEMA_VERSION }));
    database.exec(`PRAGMA user_version = ${CHAT_AI_SCHEMA_VERSION};`);
    database.exec('COMMIT;');
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
}

function createSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      last_message_at_ms INTEGER,
      archived_at_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ai_threads_updated ON ai_threads(updated_at_ms DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_threads_last_message ON ai_threads(last_message_at_ms DESC, id DESC);

    CREATE TABLE IF NOT EXISTS ai_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      content_text TEXT NOT NULL,
      content_json TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      trace_id TEXT,
      parent_message_id TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_messages_thread_created
      ON ai_messages(thread_id, created_at_ms ASC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_ai_messages_thread_updated
      ON ai_messages(thread_id, updated_at_ms ASC, id ASC);

    CREATE TABLE IF NOT EXISTS ai_thread_drafts (
      thread_id TEXT PRIMARY KEY REFERENCES ai_threads(id) ON DELETE CASCADE,
      draft_text TEXT NOT NULL,
      draft_attachments_json TEXT,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_store_meta (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
  `);
}

function validateSchema(database: DatabaseSync): void {
  requireTableColumns(database, 'ai_threads', [
    'id',
    'title',
    'created_at_ms',
    'updated_at_ms',
    'last_message_at_ms',
    'archived_at_ms',
  ]);
  rejectTableColumns(database, 'ai_threads', [
    'route_kind',
    'connector_id',
    'provider',
    'model_id',
    'route_binding_json',
  ]);
  requireTableColumns(database, 'ai_messages', [
    'id',
    'thread_id',
    'role',
    'status',
    'content_text',
    'content_json',
    'error_code',
    'error_message',
    'trace_id',
    'parent_message_id',
    'created_at_ms',
    'updated_at_ms',
  ]);
  requireTableColumns(database, 'ai_thread_drafts', [
    'thread_id',
    'draft_text',
    'draft_attachments_json',
    'updated_at_ms',
  ]);
  requireTableColumns(database, 'ai_store_meta', [
    'key',
    'value_json',
    'updated_at_ms',
  ]);
}

function hasApplicationSchema(database: DatabaseSync): boolean {
  return Boolean(database.prepare(`
    SELECT 1 AS present
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    LIMIT 1
  `).get());
}

function readSchemaVersion(database: DatabaseSync): number {
  const row = database.prepare('PRAGMA user_version').get();
  if (!row) throw new Error('CHAT_AI_SCHEMA_MISMATCH: user_version unavailable');
  return requiredDatabaseInteger(row, 'user_version');
}

function requireExpectedSchemaVersion(observedVersion: number): void {
  if (observedVersion !== CHAT_AI_SCHEMA_VERSION) {
    throw schemaVersionMismatch(observedVersion);
  }
}

function schemaVersionMismatch(observedVersion: number): Error {
  return new Error(
    `CHAT_AI_SCHEMA_MISMATCH: expected_version=${CHAT_AI_SCHEMA_VERSION}`
    + ` observed_version=${observedVersion}`
    + ' actionHint=delete_local_chat_ai_db_and_restart',
  );
}

function validateSchemaVersionMeta(database: DatabaseSync): void {
  const row = database.prepare(`
    SELECT value_json
    FROM ai_store_meta
    WHERE key = 'schemaVersion'
  `).get();
  if (!row) {
    throw new Error(
      'CHAT_AI_SCHEMA_MISMATCH: schemaVersion meta missing'
      + ' actionHint=delete_local_chat_ai_db_and_restart',
    );
  }
  const value = parseStoredJsonText(
    requiredDatabaseString(row, 'value_json'),
    'ai_store_meta.schemaVersion',
  );
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
  if (
    !record
    || Object.keys(record).length !== 1
    || !Object.hasOwn(record, 'version')
    || record.version !== CHAT_AI_SCHEMA_VERSION
  ) {
    throw new Error(
      'CHAT_AI_SCHEMA_MISMATCH: schemaVersion meta invalid'
      + ' actionHint=delete_local_chat_ai_db_and_restart',
    );
  }
}

function requireTableColumns(
  database: DatabaseSync,
  table: string,
  requiredColumns: readonly string[],
): void {
  const columns = tableColumns(database, table);
  const missing = requiredColumns.filter((column) => !columns.has(column));
  if (missing.length > 0) {
    throw new Error(
      `CHAT_AI_SCHEMA_MISMATCH: table=${table} missing_columns=${missing.join(',')}`
      + ' actionHint=delete_local_chat_ai_db_and_restart',
    );
  }
}

function rejectTableColumns(
  database: DatabaseSync,
  table: string,
  forbiddenColumns: readonly string[],
): void {
  const columns = tableColumns(database, table);
  const present = forbiddenColumns.filter((column) => columns.has(column));
  if (present.length > 0) {
    throw new Error(
      `CHAT_AI_SCHEMA_MISMATCH: table=${table} forbidden_legacy_columns=${present.join(',')}`
      + ' actionHint=delete_local_chat_ai_db_and_restart',
    );
  }
}

function tableColumns(database: DatabaseSync, table: string): ReadonlySet<string> {
  return new Set(
    database.prepare(`PRAGMA table_info(${table})`).all()
      .map((row) => requiredDatabaseString(row, 'name')),
  );
}

function listThreads(database: DatabaseSync): ChatAiThreadSummary[] {
  const rows = database.prepare(`
    SELECT id, title, updated_at_ms, last_message_at_ms
    FROM ai_threads
    WHERE EXISTS (
      SELECT 1 FROM ai_messages WHERE ai_messages.thread_id = ai_threads.id
    )
    ORDER BY updated_at_ms DESC, id DESC
  `).all().map(threadSummaryFromRow);
  return parseChatAiThreadSummaries(rows);
}

function getThreadBundle(
  database: DatabaseSync,
  threadId: string,
): ChatAiThreadBundle | null {
  const threadRow = database.prepare(`
    SELECT id, title, created_at_ms, updated_at_ms, last_message_at_ms
    FROM ai_threads
    WHERE id = ?
  `).get(threadId);
  if (!threadRow) return null;
  const thread = threadRecordFromRow(threadRow);
  const messages = database.prepare(`
    SELECT
      id,
      thread_id,
      role,
      status,
      content_text,
      content_json,
      error_code,
      error_message,
      trace_id,
      parent_message_id,
      created_at_ms,
      updated_at_ms
    FROM ai_messages
    WHERE thread_id = ?
    ORDER BY created_at_ms ASC, id ASC
  `).all(threadId).map(messageRecordFromRow);
  const draftRow = database.prepare(`
    SELECT thread_id, draft_text, draft_attachments_json, updated_at_ms
    FROM ai_thread_drafts
    WHERE thread_id = ?
  `).get(threadId);
  return parseChatAiThreadBundle({
    thread,
    messages,
    draft: draftRow ? draftRecordFromRow(draftRow) : null,
  });
}

function createThread(
  database: DatabaseSync,
  input: ChatAiCreateThreadInput,
): ChatAiThreadRecord {
  const result = database.prepare(`
    INSERT INTO ai_threads (
      id,
      title,
      created_at_ms,
      updated_at_ms,
      last_message_at_ms,
      archived_at_ms
    ) VALUES (?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO NOTHING
  `).run(
    input.id,
    input.title,
    input.createdAtMs,
    input.updatedAtMs,
    input.lastMessageAtMs,
  );
  if (Number(result.changes) === 0) {
    const existing = getThreadRecord(database, input.id);
    if (!existing) {
      throw new Error('create chat_ai thread failed: duplicate thread without existing record');
    }
    return existing;
  }
  return parseChatAiThreadRecord(input);
}

function updateThreadMetadata(
  database: DatabaseSync,
  input: ChatAiUpdateThreadMetadataInput,
): ChatAiThreadRecord {
  const existing = getThreadRecord(database, input.id);
  if (!existing) throw new Error('chat_ai thread not found');
  const result = database.prepare(`
    UPDATE ai_threads
    SET title = ?, updated_at_ms = ?, last_message_at_ms = ?
    WHERE id = ?
  `).run(input.title, input.updatedAtMs, input.lastMessageAtMs, input.id);
  if (Number(result.changes) === 0) throw new Error('chat_ai thread not found');
  return parseChatAiThreadRecord({
    ...input,
    createdAtMs: existing.createdAtMs,
  });
}

function getThreadRecord(
  database: DatabaseSync,
  threadId: string,
): ChatAiThreadRecord | null {
  const row = database.prepare(`
    SELECT id, title, created_at_ms, updated_at_ms, last_message_at_ms
    FROM ai_threads
    WHERE id = ?
  `).get(threadId);
  return row ? threadRecordFromRow(row) : null;
}

function createMessage(
  database: DatabaseSync,
  input: ChatAiCreateMessageInput,
): ChatAiMessageRecord {
  try {
    database.prepare(`
      INSERT INTO ai_messages (
        id,
        thread_id,
        role,
        status,
        content_text,
        content_json,
        error_code,
        error_message,
        trace_id,
        parent_message_id,
        created_at_ms,
        updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.threadId,
      input.role,
      input.status,
      input.contentText,
      JSON.stringify(input.content),
      input.error?.code ?? null,
      input.error?.message ?? null,
      input.traceId,
      input.parentMessageId,
      input.createdAtMs,
      input.updatedAtMs,
    );
  } catch (error) {
    throw mapSqliteMutationError('create chat_ai message failed', error);
  }
  return parseChatAiMessageRecord(input);
}

function updateMessage(
  database: DatabaseSync,
  input: ChatAiUpdateMessageInput,
): ChatAiMessageRecord {
  const row = database.prepare(`
    SELECT
      id,
      thread_id,
      role,
      status,
      content_text,
      content_json,
      error_code,
      error_message,
      trace_id,
      parent_message_id,
      created_at_ms,
      updated_at_ms
    FROM ai_messages
    WHERE id = ?
  `).get(input.id);
  if (!row) throw new Error('chat_ai message not found');
  const existing = messageRecordFromRow(row);
  const result = database.prepare(`
    UPDATE ai_messages
    SET
      status = ?,
      content_text = ?,
      content_json = ?,
      error_code = ?,
      error_message = ?,
      trace_id = ?,
      updated_at_ms = ?
    WHERE id = ?
  `).run(
    input.status,
    input.contentText,
    JSON.stringify(input.content),
    input.error?.code ?? null,
    input.error?.message ?? null,
    input.traceId,
    input.updatedAtMs,
    input.id,
  );
  if (Number(result.changes) === 0) throw new Error('chat_ai message not found');
  return parseChatAiMessageRecord({
    ...input,
    threadId: existing.threadId,
    role: existing.role,
    parentMessageId: existing.parentMessageId,
    createdAtMs: existing.createdAtMs,
  });
}

function getDraft(
  database: DatabaseSync,
  threadId: string,
): ChatAiDraftRecord | null {
  const row = database.prepare(`
    SELECT thread_id, draft_text, draft_attachments_json, updated_at_ms
    FROM ai_thread_drafts
    WHERE thread_id = ?
  `).get(threadId);
  return row ? draftRecordFromRow(row) : null;
}

function putDraft(
  database: DatabaseSync,
  input: ChatAiPutDraftInput,
): ChatAiDraftRecord {
  if (!getThreadRecord(database, input.threadId)) {
    throw new Error('chat_ai draft thread not found');
  }
  try {
    database.prepare(`
      INSERT INTO ai_thread_drafts (
        thread_id,
        draft_text,
        draft_attachments_json,
        updated_at_ms
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        draft_text = excluded.draft_text,
        draft_attachments_json = excluded.draft_attachments_json,
        updated_at_ms = excluded.updated_at_ms
    `).run(
      input.threadId,
      input.text,
      input.attachments.length > 0 ? JSON.stringify(input.attachments) : null,
      input.updatedAtMs,
    );
  } catch (error) {
    throw mapSqliteMutationError('write chat_ai draft failed', error);
  }
  return parseChatAiDraftRecord(input);
}

function deleteDraft(database: DatabaseSync, threadId: string): void {
  database.prepare('DELETE FROM ai_thread_drafts WHERE thread_id = ?').run(threadId);
}

function threadSummaryFromRow(row: Readonly<Record<string, SQLOutputValue>>): ChatAiThreadSummary {
  return {
    id: requiredDatabaseString(row, 'id'),
    title: requiredDatabaseString(row, 'title'),
    updatedAtMs: requiredDatabaseInteger(row, 'updated_at_ms'),
    lastMessageAtMs: nullableDatabaseInteger(row, 'last_message_at_ms'),
  };
}

function threadRecordFromRow(row: Readonly<Record<string, SQLOutputValue>>): ChatAiThreadRecord {
  return parseChatAiThreadRecord({
    ...threadSummaryFromRow(row),
    createdAtMs: requiredDatabaseInteger(row, 'created_at_ms'),
  });
}

function messageRecordFromRow(row: Readonly<Record<string, SQLOutputValue>>): ChatAiMessageRecord {
  const errorCode = nullableDatabaseString(row, 'error_code');
  const errorMessage = nullableDatabaseString(row, 'error_message');
  if (errorCode && !errorMessage) {
    throw new Error('ai_messages.error_code/error_message mismatch');
  }
  return parseChatAiMessageRecord({
    id: requiredDatabaseString(row, 'id'),
    threadId: requiredDatabaseString(row, 'thread_id'),
    role: requiredDatabaseString(row, 'role'),
    status: requiredDatabaseString(row, 'status'),
    contentText: requiredDatabaseString(row, 'content_text', true),
    content: parseStoredJson(row, 'content_json'),
    error: errorMessage
      ? { code: errorCode || undefined, message: errorMessage }
      : null,
    traceId: nullableDatabaseString(row, 'trace_id'),
    parentMessageId: nullableDatabaseString(row, 'parent_message_id'),
    createdAtMs: requiredDatabaseInteger(row, 'created_at_ms'),
    updatedAtMs: requiredDatabaseInteger(row, 'updated_at_ms'),
  });
}

function draftRecordFromRow(row: Readonly<Record<string, SQLOutputValue>>): ChatAiDraftRecord {
  const attachmentsJson = nullableDatabaseString(row, 'draft_attachments_json');
  const attachments = attachmentsJson
    ? parseStoredJsonText(attachmentsJson, 'ai_thread_drafts.draft_attachments_json')
    : [];
  return parseChatAiDraftRecord({
    threadId: requiredDatabaseString(row, 'thread_id'),
    text: requiredDatabaseString(row, 'draft_text', true),
    attachments,
    updatedAtMs: requiredDatabaseInteger(row, 'updated_at_ms'),
  });
}

function requiredDatabaseString(
  row: Readonly<Record<string, SQLOutputValue>>,
  field: string,
  allowEmpty = false,
): string {
  const value = row[field];
  if (typeof value !== 'string' || (!allowEmpty && !value)) {
    throw new Error(`chat_ai database field is invalid: ${field}`);
  }
  return value;
}

function nullableDatabaseString(
  row: Readonly<Record<string, SQLOutputValue>>,
  field: string,
): string | null {
  const value = row[field];
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`chat_ai database field is invalid: ${field}`);
  }
  return value;
}

function requiredDatabaseInteger(
  row: Readonly<Record<string, SQLOutputValue>>,
  field: string,
): number {
  const value = row[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`chat_ai database field is invalid: ${field}`);
  }
  return value;
}

function nullableDatabaseInteger(
  row: Readonly<Record<string, SQLOutputValue>>,
  field: string,
): number | null {
  if (row[field] === null) return null;
  return requiredDatabaseInteger(row, field);
}

function parseStoredJson(
  row: Readonly<Record<string, SQLOutputValue>>,
  field: string,
): unknown {
  return parseStoredJsonText(requiredDatabaseString(row, field), `ai_messages.${field}`);
}

function parseStoredJsonText(value: string, field: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`${field} contains invalid JSON`, { cause: error });
  }
}

function requiredThreadId(payload: Readonly<Record<string, unknown>>): string {
  const threadId = typeof payload.threadId === 'string' ? payload.threadId.trim() : '';
  if (!threadId) throw new Error('chat_ai threadId must not be empty');
  return threadId;
}

function checkedCreateThreadInput(value: unknown): ChatAiCreateThreadInput {
  const input = parseChatAiCreateThreadInput(value);
  requireNonNegativeInteger(input.createdAtMs, 'createdAtMs');
  requireNonNegativeInteger(input.updatedAtMs, 'updatedAtMs');
  if (input.lastMessageAtMs !== null) {
    requireNonNegativeInteger(input.lastMessageAtMs, 'lastMessageAtMs');
  }
  return input;
}

function checkedUpdateThreadInput(value: unknown): ChatAiUpdateThreadMetadataInput {
  const input = parseChatAiUpdateThreadMetadataInput(value);
  requireNonNegativeInteger(input.updatedAtMs, 'updatedAtMs');
  if (input.lastMessageAtMs !== null) {
    requireNonNegativeInteger(input.lastMessageAtMs, 'lastMessageAtMs');
  }
  return input;
}

function checkedCreateMessageInput(value: unknown): ChatAiCreateMessageInput {
  const input = parseChatAiCreateMessageInput(value);
  requireNonNegativeInteger(input.createdAtMs, 'createdAtMs');
  requireNonNegativeInteger(input.updatedAtMs, 'updatedAtMs');
  validateMessageContent(input.content);
  validateMessageError(input.error);
  return input;
}

function checkedUpdateMessageInput(value: unknown): ChatAiUpdateMessageInput {
  const input = parseChatAiUpdateMessageInput(value);
  requireNonNegativeInteger(input.updatedAtMs, 'updatedAtMs');
  validateMessageContent(input.content);
  validateMessageError(input.error);
  return input;
}

function checkedPutDraftInput(value: unknown): ChatAiPutDraftInput {
  const input = parseChatAiPutDraftInput(value);
  requireNonNegativeInteger(input.updatedAtMs, 'updatedAtMs');
  validateAttachments(input.attachments, 'attachments');
  return input;
}

function validateMessageContent(content: ChatAiMessageContent): void {
  validateAttachments(content.attachments, 'content.attachments');
  for (const toolCall of content.toolCalls) {
    if (
      typeof toolCall.output !== 'undefined'
      && toolCall.output !== null
      && !Array.isArray(toolCall.output)
      && (typeof toolCall.output !== 'object')
    ) {
      throw new Error('content.toolCalls[].output must be an object, array, or null');
    }
    if (toolCall.error) {
      validateMessageError(toolCall.error);
    }
  }
}

function validateAttachments(
  attachments: readonly ChatAiAttachment[],
  field: string,
): void {
  for (const attachment of attachments) {
    requireNonNegativeInteger(attachment.sizeBytes, `${field}[].sizeBytes`);
  }
}

function validateMessageError(error: ChatAiMessageError | null | undefined): void {
  if (error && !error.message.trim()) {
    throw new Error('error.message must not be empty');
  }
}

function requireNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
}

function requireNestedPayload(
  payload: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (Object.keys(payload).length !== 1 || !Object.hasOwn(payload, 'payload')) {
    throw new Error('chat-ai-store-payload-invalid');
  }
  const nested = payload.payload;
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
    throw new Error('chat-ai-store-payload-invalid');
  }
  const record = nested as Readonly<Record<string, unknown>>;
  const actualKeys = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (
    actualKeys.length !== expected.length
    || actualKeys.some((key, index) => key !== expected[index])
  ) {
    throw new Error('chat-ai-store-payload-invalid');
  }
  return record;
}

function mapSqliteMutationError(context: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message.includes('FOREIGN KEY constraint failed')) {
    return new Error(`${context}: missing referenced thread`, { cause: error });
  }
  if (
    message.includes('UNIQUE constraint failed')
    || message.includes('PRIMARY KEY constraint failed')
  ) {
    return new Error(`${context}: duplicate primary key or unique value`, { cause: error });
  }
  return new Error(`${context}: ${message || 'unknown sqlite error'}`, { cause: error });
}
