import { createHookClient } from '../hook/index.js';
import { createNimiError } from '../../runtime/errors.js';
import { ReasonCode } from '../../types/index.js';
import type { ModRuntimeContextInput } from '../types/runtime-mod.js';
import type { HookStorageClient } from '../types/storage.js';

export function createModStorageClient(modId: string, context?: ModRuntimeContextInput): HookStorageClient {
  return createHookClient(modId, context).storage;
}

export type ModKvStore = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
  has: (key: string) => Promise<boolean>;
  clear: () => Promise<void>;
  getJson: <T>(key: string) => Promise<T | null>;
  setJson: (key: string, value: unknown) => Promise<void>;
};

function normalizeKvName(input: string): string {
  return String(input || '').trim();
}

function requireKvName(input: string, field: 'namespace' | 'key'): string {
  const normalized = normalizeKvName(input);
  if (!normalized) {
    throw createNimiError({
      message: `mod kv store requires ${field}`,
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: field === 'namespace' ? 'set_namespace' : 'set_key',
      source: 'sdk',
    });
  }
  return normalized;
}

export function createModKvStore(input: {
  storage: HookStorageClient;
  namespace: string;
}): ModKvStore {
  const namespace = requireKvName(input.namespace, 'namespace');

  let ensureTablePromise: Promise<void> | null = null;

  const ensureTable = async () => {
    if (!ensureTablePromise) {
      ensureTablePromise = input.storage.sqlite.execute({
        sql: `
          CREATE TABLE IF NOT EXISTS mod_state_kv (
            namespace TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (namespace, key)
          )
        `,
      }).then(() => undefined);
    }
    await ensureTablePromise;
  };

  const store: ModKvStore = {
    get: async (key) => {
      const normalizedKey = requireKvName(key, 'key');
      await ensureTable();
      const rows = await input.storage.sqlite.query({
        sql: `
          SELECT value
          FROM mod_state_kv
          WHERE namespace = ?1 AND key = ?2
          LIMIT 1
        `,
        params: [namespace, normalizedKey],
      });
      const row = rows[0];
      return typeof row?.value === 'string' ? row.value : null;
    },
    set: async (key, value) => {
      const normalizedKey = requireKvName(key, 'key');
      await ensureTable();
      await input.storage.sqlite.execute({
        sql: `
          INSERT INTO mod_state_kv (namespace, key, value, updated_at)
          VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
          ON CONFLICT(namespace, key)
          DO UPDATE SET
            value = excluded.value,
            updated_at = CURRENT_TIMESTAMP
        `,
        params: [namespace, normalizedKey, value],
      });
    },
    delete: async (key) => {
      const normalizedKey = requireKvName(key, 'key');
      await ensureTable();
      await input.storage.sqlite.execute({
        sql: `
          DELETE FROM mod_state_kv
          WHERE namespace = ?1 AND key = ?2
        `,
        params: [namespace, normalizedKey],
      });
    },
    has: async (key) => {
      const normalizedKey = requireKvName(key, 'key');
      await ensureTable();
      const rows = await input.storage.sqlite.query({
        sql: `
          SELECT 1 AS found
          FROM mod_state_kv
          WHERE namespace = ?1 AND key = ?2
          LIMIT 1
        `,
        params: [namespace, normalizedKey],
      });
      return rows.length > 0;
    },
    clear: async () => {
      await ensureTable();
      await input.storage.sqlite.execute({
        sql: `
          DELETE FROM mod_state_kv
          WHERE namespace = ?1
        `,
        params: [namespace],
      });
    },
    getJson: async <T>(key: string) => {
      const raw = await store.get(key);
      if (!raw) {
        return null;
      }
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    setJson: async (key, value) => {
      await store.set(key, JSON.stringify(value));
    },
  };
  return store;
}
