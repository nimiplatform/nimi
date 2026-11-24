// Electron utilityProcess worker entry for isolating heavy pi-durable SQLite
// verification, file hashing, and diff I/O off the Electron main UI thread (Gate 7).
// @nimi-authority: rule.nimi.harness.assistant.security-gates
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openDurableFullStorage } from './durable-sqlite.js';

export type EngineWorkerRequest =
  | { id: string; kind: 'verify-sqlite-durability'; dbPath: string }
  | { id: string; kind: 'hash-file'; filePath: string }
  | { id: string; kind: 'ping' };

export type EngineWorkerResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string };

export async function handleEngineWorkerRequest(req: EngineWorkerRequest): Promise<EngineWorkerResponse> {
  try {
    if (req.kind === 'ping') {
      return { id: req.id, ok: true, result: { pong: true, pid: process.pid } };
    }
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

export interface UtilityProcessLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  kill(): boolean;
}

/**
 * Main-process client wrapping an Electron `utilityProcess` running `engine-worker.js`.
 */
export class EngineWorkerHostClient {
  private readonly pending = new Map<string, { resolve: (val: unknown) => void; reject: (err: Error) => void }>();
  private disposed = false;

  constructor(private readonly proc: UtilityProcessLike) {
    proc.on('message', msg => {
      const res = msg as EngineWorkerResponse | undefined;
      if (!res || typeof res.id !== 'string') return;
      const entry = this.pending.get(res.id);
      if (!entry) return;
      this.pending.delete(res.id);
      if (res.ok) entry.resolve(res.result);
      else entry.reject(new Error(res.error));
    });
    proc.on('exit', code => {
      this.disposed = true;
      for (const entry of this.pending.values()) {
        entry.reject(new Error(`Engine utilityProcess exited (code=${code}).`));
      }
      this.pending.clear();
    });
  }

  request<T>(payload: Omit<EngineWorkerRequest, 'id'>, timeoutMs = 15_000): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error('Engine utilityProcess is no longer running.'));
    }
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`Engine utilityProcess request "${payload.kind}" timed out.`));
        }
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: val => { clearTimeout(timer); resolve(val as T); },
        reject: err => { clearTimeout(timer); reject(err); },
      });
      this.proc.postMessage({ ...payload, id });
    });
  }

  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.pending.values()) {
      entry.reject(new Error('Engine utilityProcess closed.'));
    }
    this.pending.clear();
    try { this.proc.kill(); } catch { /* already terminated */ }
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
