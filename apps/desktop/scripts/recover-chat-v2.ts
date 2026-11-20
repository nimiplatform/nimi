import { link, lstat, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { openChatAiDatabase, readChatAiTranscript } from '../src-electron/chat-ai-store-database.ts';
import { encodeHomeChatHandoff, homeChatHandoff } from '../src/shell/shared/chat-ai-handoff.ts';

async function attachV2(db: DatabaseSync, source: string) {
  if (!path.isAbsolute(source)) throw new Error('Provide an absolute source path.');
  if (await hasSidecar(source)) throw new Error('Select a standalone SQLite backup. Use SQLite backup to include committed WAL data.');
  db.exec('PRAGMA trusted_schema=OFF');
  const uri = pathToFileURL(source);
  uri.searchParams.set('mode', 'ro');
  // The input is a standalone SQLite backup. An immutable reader also keeps
  // SQLite from creating WAL/shared-memory files alongside that backup.
  uri.searchParams.set('immutable', '1');
  db.prepare('ATTACH DATABASE ? AS legacy').run(uri.href);
  const version = db.prepare('PRAGMA legacy.user_version').get()?.user_version;
  if (version !== 2) throw new Error('Select a version 2 Nimi Chat database backup.');
  const meta = db.prepare("SELECT value_json FROM legacy.ai_store_meta WHERE key='schemaVersion'").get();
  if (typeof meta?.value_json !== 'string' || JSON.parse(meta.value_json)?.version !== 2) {
    throw new Error('Version 2 schema metadata does not match the backup.');
  }
  const draftColumns = db.prepare('PRAGMA legacy.table_info(ai_thread_drafts)').all().map(row => row.name);
  if (draftColumns.join(',') !== 'thread_id,draft_text,draft_attachments_json,updated_at_ms') {
    throw new Error('Unrecognized v2 draft table.');
  }
}

export async function listRecoverableThreads(source: string) {
  const db = new DatabaseSync(':memory:');
  try {
    await attachV2(db, source);
    return db.prepare(`
      SELECT id, title FROM legacy.ai_threads AS t
      WHERE EXISTS (SELECT 1 FROM legacy.ai_messages AS m WHERE m.thread_id = t.id)
      ORDER BY updated_at_ms DESC, id DESC
    `).all();
  } finally {
    db.close();
  }
}

// A v2 draft was keyed only by thread. Recovering sent messages does not
// require us to decide which account, if any, owns that draft.
function copyHistory(db: DatabaseSync, threadId?: string) {
  if (db.prepare('PRAGMA main.user_version').get()?.user_version !== 3) {
    throw new Error('This recovery tool requires the version 3 Home writer.');
  }
  db.exec('BEGIN');
  try {
    const selected = threadId === undefined ? [] : [threadId];
    for (const table of ['ai_threads', 'ai_messages']) {
      const columns = db.prepare(`PRAGMA main.table_info(${table})`).all().map(row => row.name);
      const legacyColumns = db.prepare(`PRAGMA legacy.table_info(${table})`).all().map(row => row.name);
      if (columns.length !== legacyColumns.length || columns.some(name => !legacyColumns.includes(name))) {
        throw new Error(`Unrecognized v2 columns in ${table}.`);
      }
      const fields = columns.join(', ');
      const filter = selected.length ? ` WHERE ${table === 'ai_threads' ? 'id' : 'thread_id'} = ?` : '';
      db.prepare(`INSERT INTO main.${table} (${fields}) SELECT ${fields} FROM legacy.${table}${filter}`).run(...selected);
    }
    const result = {
      threads: db.prepare('SELECT COUNT(*) AS n FROM main.ai_threads').get()!.n,
      messages: db.prepare('SELECT COUNT(*) AS n FROM main.ai_messages').get()!.n,
      draftsRetainedInSource: db.prepare('SELECT COUNT(*) AS n FROM legacy.ai_thread_drafts' + (selected.length ? ' WHERE thread_id = ?' : '')).get(...selected)!.n,
    };
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Write an independently usable candidate; the source and existing outputs are never replaced. */
export async function recoverChatV2(source: string, output: string, threadId?: string) {
  if (!path.isAbsolute(output)) throw new Error('Provide an absolute output path.');
  if (await hasSidecar(output)) throw new Error('Choose a new output name with no SQLite sidecar files.');
  if (threadId !== undefined && !threadId.trim()) throw new Error('Provide a thread ID for the handoff.');
  const staging = await mkdtemp(path.join(path.dirname(output), '.home-chat-recovery-'));
  const candidate = path.join(staging, 'main.db');
  const publication = threadId === undefined ? candidate : path.join(staging, 'conversation.nimi-chat.json');
  try {
    await (await open(candidate, 'wx', 0o600)).close();
    const db = openChatAiDatabase(candidate);
    let result: ReturnType<typeof copyHistory>;
    try {
      db.exec('PRAGMA journal_mode=DELETE');
      await attachV2(db, source);
      result = copyHistory(db, threadId);
      if (threadId !== undefined) {
        const transcript = readChatAiTranscript(db, threadId);
        if (!transcript) throw new Error('Selected thread not found in the backup.');
        const copy = homeChatHandoff({ ...transcript, draft: null }, '');
        const text = copy && encodeHomeChatHandoff(copy);
        if (!text) throw new Error('Harness handoff requires a completed text conversation up to 1 MiB.');
        await writeFile(publication, text, { mode: 0o600, flag: 'wx' });
      }
    } finally {
      db.close();
    }
    await link(publication, output);
    return result;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function hasSidecar(file: string) {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try {
      await lstat(file + suffix);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return false;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: {
      source: { type: 'string' }, output: { type: 'string' }, 'thread-id': { type: 'string' }, list: { type: 'boolean' },
    } });
    if (values.source && values.list && !values.output && values['thread-id'] === undefined) {
      console.log(JSON.stringify(await listRecoverableThreads(values.source), null, 2));
    } else if (values.source && values.output && !values.list) {
      console.log(JSON.stringify(await recoverChatV2(values.source, values.output, values['thread-id'])));
    } else {
      throw new Error('Usage: recover-chat-v2 --source <v2 backup> (--list | --output <new file> [--thread-id <id for Harness handoff>])');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
