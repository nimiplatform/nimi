// Electron utilityProcess worker entry for isolating heavy pi-durable SQLite,
// diff/hashing, and snapshot I/O off the Electron main UI thread (Gate 7).
// @nimi-authority: rule.nimi.harness.assistant.p-harn-002
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openDurableFullStorage } from './durable-sqlite.js';

export type EngineWorkerRequest =
  | { id: string; kind: 'verify-sqlite-durability'; dbPath: string }
  | { id: string; kind: 'hash-file'; filePath: string };

export type EngineWorkerResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string };

export async function handleEngineWorkerRequest(req: EngineWorkerRequest): Promise<EngineWorkerResponse> {
  try {
    if (req.kind === 'verify-sqlite-durability') {
      const opened = await openDurableFullStorage(req.dbPath);
      const { journalMode, synchronous } = opened;
      await opened.db.close();
      return { id: req.id, ok: true, result: { journalMode, synchronous } };
    }
    if (req.kind === 'hash-file') {
      const bytes = await readFile(req.filePath);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      return { id: req.id, ok: true, result: { sha256, bytes: bytes.byteLength } };
    }
    return { id: (req as { id: string }).id, ok: false, error: 'Unsupported worker command.' };
  } catch (error) {
    return { id: req.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// When spawned inside Electron utilityProcess, listen on process.parentPort.
const parentPort = (process as unknown as {
  parentPort?: {
    on(event: 'message', listener: (ev: { data: EngineWorkerRequest }) => void): void;
    postMessage(msg: EngineWorkerResponse): void;
  };
}).parentPort;

if (parentPort) {
  parentPort.on('message', event => {
    void handleEngineWorkerRequest(event.data).then(res => parentPort.postMessage(res));
  });
}
