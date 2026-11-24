// Durable WAL + synchronous=FULL SQLite opener for apps/harness (pi-durable@1.6.0).
// Explicitly verifies PRAGMA journal_mode == 'wal' and PRAGMA synchronous == 2 (FULL)
// by readback before handing the database to SqliteStorage.open().
// @nimi-authority: rule.nimi.harness.assistant.symbiosis-and-durability
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { defineDoc } from '@earendil-works/pi-durable';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import { openNodeSqliteDatabase, type NodeSqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite/node';

export type OutboxReceiptRecord = {
  requestId: string;
  payloadHash: string;
  submissionId: number | null;
  withdrawState: 'active' | 'withdrawn' | 'settled';
  createdAt: number;
  updatedAt: number;
};

export type OutboxReceiptsDocState = {
  byRequestId: Record<string, OutboxReceiptRecord>;
};

/**
 * Persisted inside the EXACT SAME pi-durable WAL+FULL commit transaction as
 * conversation.submit(tx, ...) (which runs first). Guarantees that re-delivered
 * NEW_INTENT envelopes for withdrawn or already-settled outbox_ids return their
 * idempotent receipt instead of HARNESS_REQUEST_CONFLICT or re-running the task.
 */
export const OutboxReceiptsDoc = defineDoc<OutboxReceiptsDocState>({
  kind: 'nimi.outbox-receipts',
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  initial: () => ({ byRequestId: {} }),
  checkpointWhen: () => true,
});

export function hashOutboxPayload(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export interface VerifiedDurableStorage {
  readonly storage: SqliteStorage;
  readonly db: NodeSqliteDatabase;
  readonly journalMode: string;
  readonly synchronous: number;
}

export async function openDurableFullStorage(dbPath: string): Promise<VerifiedDurableStorage> {
  await mkdir(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = await openNodeSqliteDatabase(dbPath, { busyTimeoutMs: 5_000 });
  try {
    await db.exec('PRAGMA foreign_keys = ON;');
    await db.exec('PRAGMA journal_mode = WAL;');
    await db.exec('PRAGMA synchronous = FULL;');

    const jmRow = await db.get<{ journal_mode?: string }>('PRAGMA journal_mode;');
    const syncRow = await db.get<{ synchronous?: number }>('PRAGMA synchronous;');
    const journalMode = String(jmRow?.journal_mode ?? '').trim().toLowerCase();
    const synchronous = Number(syncRow?.synchronous ?? -1);

    if (journalMode !== 'wal') {
      throw new Error(`Harness SQLite durability violation: PRAGMA journal_mode=${journalMode}, expected wal`);
    }
    if (synchronous !== 2) {
      throw new Error(`Harness SQLite durability violation: PRAGMA synchronous=${synchronous}, expected 2 (FULL)`);
    }

    const storage = await SqliteStorage.open(db);
    return { storage, db, journalMode, synchronous };
  } catch (error) {
    await db.close().catch(() => {});
    throw error;
  }
}
