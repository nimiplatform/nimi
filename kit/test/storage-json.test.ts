import { describe, expect, it } from 'vitest';

import {
  readStorageJsonFrom,
  readStorageTextFrom,
  removeStorageKeyFrom,
  writeStorageTextTo,
  writeStorageJsonTo,
} from '../core/src/storage-json.js';

function createStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem(key: string) {
      return data.has(key) ? data.get(key) ?? null : null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
    snapshot() {
      return Object.fromEntries(data.entries());
    },
  };
}

describe('kit core storage-json', () => {
  it('reads typed JSON without owning the caller schema', () => {
    const storage = createStorage({ prefs: '{"schemaVersion":1,"enabled":true}' });
    const result = readStorageJsonFrom(storage, 'prefs', (value) => {
      const record = value as { schemaVersion?: unknown; enabled?: unknown };
      if (record.schemaVersion !== 1 || typeof record.enabled !== 'boolean') {
        throw new Error('invalid prefs schema');
      }
      return { schemaVersion: 1 as const, enabled: record.enabled };
    });

    expect(result).toEqual({
      state: 'ready',
      raw: '{"schemaVersion":1,"enabled":true}',
      value: { schemaVersion: 1, enabled: true },
    });
  });

  it('keeps missing, corrupt, and write failures visible', () => {
    expect(readStorageJsonFrom(null, 'prefs').state).toBe('unavailable');
    expect(readStorageJsonFrom(createStorage(), 'prefs').state).toBe('missing');
    expect(readStorageJsonFrom(createStorage({ prefs: '{bad json' }), 'prefs').state).toBe('corrupt');

    const failingWrite = {
      setItem() {
        throw new Error('quota exceeded');
      },
    };
    expect(writeStorageJsonTo(failingWrite, 'prefs', { ok: true })).toEqual({
      state: 'write-error',
      error: 'quota exceeded',
    });
  });

  it('writes and removes caller-owned keys', () => {
    const storage = createStorage();
    expect(writeStorageJsonTo(storage, 'prefs', { ok: true }).state).toBe('saved');
    expect(storage.snapshot()).toEqual({ prefs: '{"ok":true}' });
    expect(removeStorageKeyFrom(storage, 'prefs').state).toBe('removed');
    expect(storage.snapshot()).toEqual({});
  });

  it('reads and writes caller-owned text without schema meaning', () => {
    const storage = createStorage({ selected: 'diagnostics' });
    expect(readStorageTextFrom(storage, 'selected')).toEqual({
      state: 'ready',
      value: 'diagnostics',
    });
    expect(readStorageTextFrom(storage, 'missing')).toEqual({
      state: 'missing',
      value: null,
    });
    expect(writeStorageTextTo(storage, 'selected', 'repair').state).toBe('saved');
    expect(storage.snapshot()).toMatchObject({ selected: 'repair' });
  });
});
