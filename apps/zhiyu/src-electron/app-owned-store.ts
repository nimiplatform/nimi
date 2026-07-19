import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const APP_ID = 'nimi.zhiyu';
const SCHEMA_VERSION = 1;

export type ZhiyuAppOwnedStore = {
  readonly databasePath: string;
  readonly snapshot: () => Readonly<{ appId: string; bootCount: number; schemaVersion: number }>;
  readonly close: () => void;
};

export async function openZhiyuAppOwnedStore(input: {
  readonly userDataRoot: string;
  readonly nowUnixMs?: number;
  readonly platform?: NodeJS.Platform;
  readonly uid?: number;
}): Promise<ZhiyuAppOwnedStore> {
  const platform = input.platform ?? process.platform;
  if (platform !== 'darwin' && platform !== 'win32') fail();
  const uid = platform === 'darwin' ? input.uid ?? process.getuid?.() : undefined;
  if (platform === 'darwin' && (!Number.isSafeInteger(uid) || Number(uid) < 0)) fail();
  const requestedRoot = exactAbsolute(input.userDataRoot);
  const canonicalUserDataRoot = await realpath(requestedRoot).catch(() => fail());
  if (canonicalUserDataRoot !== requestedRoot) fail();
  await requireOwnedDirectory(canonicalUserDataRoot, platform, uid, false);

  const storageRoot = path.join(canonicalUserDataRoot, 'app-owned', 'v1');
  await mkdir(storageRoot, { recursive: true, mode: 0o700 });
  if (platform === 'darwin') await chmod(storageRoot, 0o700);
  await requireOwnedDirectory(path.join(canonicalUserDataRoot, 'app-owned'), platform, uid, true);
  await requireOwnedDirectory(storageRoot, platform, uid, true);

  const databasePath = path.join(storageRoot, 'zhiyu.sqlite3');
  await ensurePrivateDatabaseFile(databasePath, platform, uid);
  const database = new DatabaseSync(databasePath, {
    allowExtension: false,
    readOnly: false,
    timeout: 5_000,
  });
  try {
    database.exec([
      'PRAGMA foreign_keys = ON',
      'PRAGMA journal_mode = DELETE',
      'PRAGMA secure_delete = ON',
      'PRAGMA trusted_schema = OFF',
    ].join(';'));
    initializeOrValidateSchema(database);
    recordBoot(database, exactUnixMs(input.nowUnixMs ?? Date.now()));
    if (platform === 'darwin') await chmod(databasePath, 0o600);
    await requireOwnedFile(databasePath, platform, uid);
  } catch (error) {
    database.close();
    throw error;
  }

  let closed = false;
  return Object.freeze({
    databasePath,
    snapshot: () => {
      if (closed) fail();
      return readSnapshot(database);
    },
    close: () => {
      if (closed) return;
      closed = true;
      database.close();
    },
  });
}

function initializeOrValidateSchema(database: DatabaseSync): void {
  const version = Number(database.prepare('PRAGMA user_version').get()?.user_version);
  if (version === 0) {
    transaction(database, () => {
      database.exec(`
        CREATE TABLE app_meta (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        ) STRICT;
        INSERT INTO app_meta(key, value) VALUES ('app_id', '${APP_ID}');
        INSERT INTO app_meta(key, value) VALUES ('boot_count', '0');
        INSERT INTO app_meta(key, value) VALUES ('last_boot_unix_ms', '0');
        PRAGMA user_version = ${SCHEMA_VERSION};
      `);
    });
  } else if (version !== SCHEMA_VERSION) {
    fail();
  }
  const appId = database.prepare("SELECT value FROM app_meta WHERE key = 'app_id'").get()?.value;
  if (appId !== APP_ID) fail();
}

function recordBoot(database: DatabaseSync, nowUnixMs: number): void {
  transaction(database, () => {
    const row = database.prepare("SELECT value FROM app_meta WHERE key = 'boot_count'").get();
    const bootCount = Number(row?.value);
    if (!Number.isSafeInteger(bootCount) || bootCount < 0) fail();
    database.prepare("UPDATE app_meta SET value = ? WHERE key = 'boot_count'").run(String(bootCount + 1));
    database.prepare("UPDATE app_meta SET value = ? WHERE key = 'last_boot_unix_ms'").run(String(nowUnixMs));
  });
}

function readSnapshot(database: DatabaseSync) {
  const rows = Object.fromEntries(
    database.prepare('SELECT key, value FROM app_meta ORDER BY key').all()
      .map((row) => [String(row.key), String(row.value)]),
  );
  const schemaVersion = Number(database.prepare('PRAGMA user_version').get()?.user_version);
  const bootCount = Number(rows.boot_count);
  if (rows.app_id !== APP_ID || schemaVersion !== SCHEMA_VERSION
    || !Number.isSafeInteger(bootCount) || bootCount < 1) fail();
  return Object.freeze({ appId: rows.app_id, bootCount, schemaVersion });
}

function transaction(database: DatabaseSync, operation: () => void): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    operation();
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

async function ensurePrivateDatabaseFile(
  databasePath: string,
  platform: 'darwin' | 'win32',
  uid: number | undefined,
): Promise<void> {
  let handle;
  try {
    handle = await open(
      databasePath,
      constants.O_RDWR | constants.O_CREAT | constants.O_EXCL
        | (platform === 'darwin' ? constants.O_NOFOLLOW : 0),
      0o600,
    );
    await handle.sync();
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error;
  } finally {
    await handle?.close();
  }
  if (platform === 'darwin') await chmod(databasePath, 0o600);
  await requireOwnedFile(databasePath, platform, uid);
}

async function requireOwnedDirectory(
  candidate: string,
  platform: 'darwin' | 'win32',
  uid: number | undefined,
  privateDirectory: boolean,
): Promise<void> {
  const metadata = await lstat(candidate);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()
    || (platform === 'darwin' && (metadata.uid !== uid
      || (privateDirectory && (metadata.mode & 0o077) !== 0)))
    || await realpath(candidate) !== candidate) fail();
}

async function requireOwnedFile(
  candidate: string,
  platform: 'darwin' | 'win32',
  uid: number | undefined,
): Promise<void> {
  const metadata = await lstat(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || (platform === 'darwin' && (metadata.uid !== uid || (metadata.mode & 0o077) !== 0))
    || await realpath(candidate) !== candidate) fail();
}

function exactAbsolute(value: unknown): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.normalize(value) !== value
    || value.trim() !== value || value.includes('\0')) fail();
  return value;
}

function exactUnixMs(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) fail();
  return numeric;
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
}

function fail(): never {
  throw new Error('zhiyu-app-owned-storage-untrusted');
}
