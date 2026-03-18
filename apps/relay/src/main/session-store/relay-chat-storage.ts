import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';

// ── Interface ──────────────────────────────────────────────────────

export interface RelayChatStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown): Promise<void>;
  clear(): Promise<void>;
}

// ── Electron fs-backed implementation ──────────────────────────────

const DEBOUNCE_MS = 500;

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, '_');
}

type PendingEntry = { kind: 'string'; value: string } | { kind: 'json'; value: unknown };

export class ElectronChatStorage implements RelayChatStorage {
  private readonly baseDir: string;
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingWrites = new Map<string, PendingEntry>();
  private ensuredDir = false;

  constructor(namespace: string) {
    this.baseDir = path.join(app.getPath('userData'), 'relay-chat', sanitizeKey(namespace));
  }

  private filePath(key: string): string {
    return path.join(this.baseDir, `${sanitizeKey(key)}.json`);
  }

  private async ensureBaseDir(): Promise<void> {
    if (this.ensuredDir) return;
    await fs.mkdir(this.baseDir, { recursive: true });
    this.ensuredDir = true;
  }

  async get(key: string): Promise<string | null> {
    const pending = this.pendingWrites.get(key);
    if (pending) {
      return pending.kind === 'string' ? pending.value : JSON.stringify(pending.value);
    }
    try {
      const raw = await fs.readFile(this.filePath(key), 'utf-8');
      const parsed = JSON.parse(raw) as { kind: string; value: unknown };
      return typeof parsed.value === 'string' ? parsed.value : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    this.pendingWrites.set(key, { kind: 'string', value });
    this.scheduleDebouncedWrite(key);
  }

  async delete(key: string): Promise<void> {
    this.pendingWrites.delete(key);
    this.cancelDebounce(key);
    try {
      await fs.unlink(this.filePath(key));
    } catch {
      // file may not exist
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const pending = this.pendingWrites.get(key);
    if (pending) {
      return (pending.kind === 'json' ? pending.value : null) as T | null;
    }
    try {
      const raw = await fs.readFile(this.filePath(key), 'utf-8');
      const parsed = JSON.parse(raw) as { kind: string; value: unknown };
      return parsed.kind === 'json' ? (parsed.value ?? null) as T | null : null;
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown): Promise<void> {
    this.pendingWrites.set(key, { kind: 'json', value });
    this.scheduleDebouncedWrite(key);
  }

  async clear(): Promise<void> {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.pendingWrites.clear();
    try {
      const entries = await fs.readdir(this.baseDir);
      await Promise.all(
        entries.map((entry) => fs.unlink(path.join(this.baseDir, entry)).catch(() => {})),
      );
    } catch {
      // directory may not exist
    }
  }

  /** Flush all pending debounced writes immediately. */
  async flush(): Promise<void> {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    const keys = [...this.pendingWrites.keys()];
    await Promise.all(keys.map((key) => this.writeNow(key)));
  }

  // ── Internal ─────────────────────────────────────────────────────

  private scheduleDebouncedWrite(key: string): void {
    this.cancelDebounce(key);
    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      void this.writeNow(key);
    }, DEBOUNCE_MS);
    this.debounceTimers.set(key, timer);
  }

  private cancelDebounce(key: string): void {
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.debounceTimers.delete(key);
    }
  }

  private async writeNow(key: string): Promise<void> {
    const entry = this.pendingWrites.get(key);
    if (!entry) return;
    this.pendingWrites.delete(key);
    await this.ensureBaseDir();
    const envelope = JSON.stringify({ kind: entry.kind, value: entry.value }, null, 2);
    await fs.writeFile(this.filePath(key), envelope, 'utf-8');
  }
}

// ── Factory ────────────────────────────────────────────────────────

let defaultInstance: ElectronChatStorage | null = null;

export function createRelayChatStorage(namespace: string): ElectronChatStorage {
  return new ElectronChatStorage(namespace);
}

export function getDefaultRelayChatStorage(): ElectronChatStorage {
  if (!defaultInstance) {
    defaultInstance = new ElectronChatStorage('default');
  }
  return defaultInstance;
}
