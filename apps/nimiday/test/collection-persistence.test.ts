import { describe, expect, it } from 'vitest';
import { createDayPersistence } from '../src/nimiday/store/persistence.js';
import { parseCollectionIndex, type CollectionIndex } from '../src/nimiday/store/collection-layout.js';
import type { JsonDocumentStore } from '../src/nimiday/store/json-documents.js';
import { createDayStore } from '../src/nimiday/store/day-store.js';

const INDEX = 'nimiday/v1/notes.index.json';
const records = () => ['a', 'b', 'c'].map(id => ({ id, body: id.repeat(100_000) }));
const changed = () => records().map((value, index) => index === 1 ? value : { ...value, body: 'z'.repeat(100_000) });

function disk() {
  const data = new Map<string, unknown>();
  const events: Array<{ operation: string; path: string; value?: unknown }> = [];
  let intercept: ((operation: string, path: string, value: unknown, commit: () => void) => Promise<void>) | undefined;
  const documents: JsonDocumentStore = {
    read: async path => { events.push({ operation: 'read', path }); return structuredClone(data.get(path)); },
    write: async (path, value) => {
      events.push({ operation: 'write', path, value: structuredClone(value) });
      const commit = () => { data.set(path, structuredClone(value)); };
      if (intercept) await intercept('write', path, value, commit); else commit();
    },
    remove: async path => {
      events.push({ operation: 'remove', path });
      const commit = () => { data.delete(path); };
      if (intercept) await intercept('remove', path, undefined, commit); else commit();
    },
  };
  return { data, events, documents, intercept: (value: typeof intercept) => { intercept = value; } };
}

describe('Host collection commits', () => {
  it('distinguishes loading a prepared recovery from an acknowledged save with pending cleanup', async () => {
    const file = disk(); file.data.set('nimiday/v1/rhythms.json', []);
    const seed = createDayPersistence(file.documents);
    await seed.writeCollection('notes', [{ id: 'n', title: 'Saved note', body: 'confirmed content' }]); seed.close();
    const before = file.data.get(INDEX) as CollectionIndex;
    file.data.set(INDEX, { ...before, pending: { phase: 'prepared', generation: 2, next: ['nimiday/v1/notes.g2-0.json'], created: ['nimiday/v1/notes.g2-0.json'], obsolete: before.current } });
    const store = createDayStore(createDayPersistence(file.documents), { language: () => 'zh' });
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', unsaved: false, cleanupPending: true, recoveryPending: true });
    expect(store.getSnapshot().state.notes[0]?.body).toBe('confirmed content');
    store.close();
  });

  it('keeps a confirmed save separate from later unsaved edits after cleanup becomes uncertain', async () => {
    const file = disk(); file.data.set('nimiday/v1/rhythms.json', []);
    const seed = createDayPersistence(file.documents);
    await seed.writeCollection('notes', [{ id: 'n', title: 'Saved note', body: 'old' }]); seed.close();
    const store = createDayStore(createDayPersistence(file.documents), { language: () => 'zh' });
    await store.load();
    file.intercept(async (operation, _path, _value, commit) => { if (operation === 'remove') throw new Error('cleanup confirmation lost'); commit(); });
    store.update(state => ({ ...state, notes: state.notes.map(note => ({ ...note, body: 'confirmed new' })) }), ['notes']);
    expect(await store.persist()).toEqual({ ok: true });
    expect(store.getSnapshot()).toMatchObject({ unsaved: false, cleanupPending: true, recoveryPending: false, recoveryRequired: true });
    const count = file.events.length;
    store.update(state => ({ ...state, notes: state.notes.map(note => ({ ...note, body: 'later edit' })) }), ['notes']);
    expect((await store.persist()).ok).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ unsaved: true, saveErrorKind: 'uncertain' });
    expect(store.getSnapshot().state.notes[0]?.body).toBe('later edit');
    expect(file.events).toHaveLength(count);
    const index = file.data.get(INDEX) as CollectionIndex;
    expect((file.data.get(index.current[0]!) as Array<{ body: string }>)[0]?.body).toBe('confirmed new');
    store.close();
  });
  it.each(['append', 'prepend'] as const)('packs repeated small %s saves instead of consuming one chunk per item', async direction => {
    const file = disk(); const owner = createDayPersistence(file.documents);
    let values: Array<{ id: string; body: string }> = [];
    for (let index = 0; index < 80; index++) {
      const next = { id: String(index), body: 'small saved record' };
      values = direction === 'append' ? [...values, next] : [next, ...values];
      await owner.writeCollection('notes', values);
    }
    expect((file.data.get(INDEX) as CollectionIndex).current).toHaveLength(1);
    expect((await owner.readCollection('notes')).records).toEqual(values);
    expect(file.data.size).toBe(2);
  });
  it('copies only two changed chunks, keeps the middle reference and preserves order', async () => {
    const file = disk(); const owner = createDayPersistence(file.documents);
    await owner.writeCollection('notes', records());
    const before = file.data.get(INDEX) as CollectionIndex;
    file.events.length = 0;
    await owner.writeCollection('notes', changed());
    const after = file.data.get(INDEX) as CollectionIndex;
    expect(after.current[1]).toBe(before.current[1]);
    expect(after.current[0]).not.toBe(before.current[0]);
    expect(after.current[2]).not.toBe(before.current[2]);
    expect(file.events.filter(event => event.operation === 'write' && event.path !== INDEX)).toHaveLength(2);
    expect(file.events.filter(event => event.operation === 'read')).toEqual([]);
    expect((await owner.readCollection('notes')).records).toEqual(changed());
    expect(after.pending).toBeUndefined();
    expect([...file.data.keys()].sort()).toEqual([INDEX, ...after.current].sort());
  });

  it('keeps unaffected anchors when records are inserted, deleted or object keys are reordered', async () => {
    const file = disk(); const owner = createDayPersistence(file.documents);
    await owner.writeCollection('notes', records());
    const before = file.data.get(INDEX) as CollectionIndex;
    file.events.length = 0;
    await owner.writeCollection('notes', records().map(({ id, body }) => ({ body, id })));
    expect(file.events.filter(event => event.operation === 'write')).toEqual([]);
    const next = [{ id: 'new', body: 'new' }, ...records().slice(1).map(({ id, body }) => ({ body, id }))];
    await owner.writeCollection('notes', next);
    const after = file.data.get(INDEX) as CollectionIndex;
    expect(after.current).toHaveLength(2);
    expect(after.current.at(-1)).toBe(before.current.at(-1));
    expect((await owner.readCollection('notes')).records).toEqual(next);
  });

  it('holds index-to-chunk reads in the same queue as writer cleanup', async () => {
    const file = disk(); const seed = createDayPersistence(file.documents);
    await seed.writeCollection('notes', records()); seed.close();
    let entered!: () => void; let resume!: () => void;
    const reading = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const owner = createDayPersistence({ ...file.documents, read: async path => {
      const value = await file.documents.read(path);
      if (path === INDEX) { entered(); await gate; }
      return value;
    } });
    const old = owner.readCollection('notes'); await reading;
    file.events.length = 0;
    const writing = owner.writeCollection('notes', changed());
    await Promise.resolve();
    expect(file.events).toEqual([]);
    resume();
    expect((await old).records).toEqual(records());
    await writing;
    expect((await owner.readCollection('notes')).records).toEqual(changed());
  });

  it.each(['prepared', 'first-candidate', 'before-publish', 'published-lost-ack', 'cleanup-remove', 'clear-pending-lost-ack'] as const)(
    'recovers exact current/pending after %s without trusting a rejected promise as a barrier', async failure => {
      const file = disk(); const owner = createDayPersistence(file.documents);
      await owner.writeCollection('notes', records());
      let fired = false;
      file.intercept(async (operation, path, value, commit) => {
        const index = path === INDEX ? value as CollectionIndex | undefined : undefined;
        const match = failure === 'prepared' ? index?.pending?.phase === 'prepared'
          : failure === 'first-candidate' ? operation === 'write' && path.includes('.g2-0.')
            : failure === 'before-publish' || failure === 'published-lost-ack' ? index?.pending?.phase === 'published'
              : failure === 'cleanup-remove' ? operation === 'remove'
                : operation === 'write' && index?.generation === 2 && !index.pending;
        if (match && !fired) {
          fired = true;
          if (failure !== 'before-publish' && failure !== 'cleanup-remove') commit();
          throw new Error('transport confirmation lost');
        }
        commit();
      });
      const published = ['published-lost-ack', 'cleanup-remove', 'clear-pending-lost-ack'].includes(failure);
      if (failure === 'cleanup-remove' || failure === 'clear-pending-lost-ack') {
        expect(await owner.writeCollection('notes', changed())).toEqual({ cleanupPending: true, recoveryRequired: true, recoveryPending: false });
      } else {
        await expect(owner.writeCollection('notes', changed())).rejects.toMatchObject({ kind: 'uncertain' });
      }
      const count = file.events.length;
      await expect(owner.maintain()).rejects.toMatchObject({ kind: 'uncertain' });
      await expect(owner.writeCollection('notes', records())).rejects.toMatchObject({ kind: 'uncertain' });
      expect(file.events).toHaveLength(count);
      // Model a NEW verified scope after the old writer is fenced. The actual
      // Runtime fence is tested with real file operations in the Go owner.
      owner.close(); file.intercept(undefined);
      const reopened = createDayPersistence(file.documents);
      expect((await reopened.readCollection('notes')).records).toEqual(published ? changed() : records());
      await reopened.maintain();
      const finalIndex = file.data.get(INDEX) as CollectionIndex;
      expect(finalIndex.pending).toBeUndefined();
      expect([...file.data.keys()].sort()).toEqual([INDEX, ...finalIndex.current].sort());
    });

  it('does not allocate another generation while pending cleanup is refused', async () => {
    const file = disk(); const first = createDayPersistence(file.documents);
    await first.writeCollection('notes', records());
    file.intercept(async (operation, path, _value, commit) => {
      commit();
      if (operation === 'write' && path.includes('.g2-0.')) throw new Error('lost confirmation');
    });
    await expect(first.writeCollection('notes', changed())).rejects.toMatchObject({ kind: 'uncertain' });
    first.close();
    const reopened = createDayPersistence(file.documents);
    file.intercept(async (operation, _path, _value, commit) => {
      if (operation === 'remove') throw Object.assign(new Error('refused before commit'), { reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE' });
      commit();
    });
    const pending = structuredClone(file.data);
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(reopened.writeCollection('notes', changed())).rejects.toThrow('refused before commit');
      expect(file.data).toEqual(pending);
    }
    file.intercept(undefined);
    await reopened.maintain();
    await reopened.writeCollection('notes', changed());
    expect((await reopened.readCollection('notes')).records).toEqual(changed());
  });

  it('recognizes native resource-exhausted as a definitive quota refusal and permits safe same-scope recovery', async () => {
    const file = disk(); const owner = createDayPersistence(file.documents);
    await owner.writeCollection('notes', records());
    file.intercept(async (operation, path, _value, commit) => {
      if (operation === 'write' && path.includes('.g2-1.')) throw Object.assign(new Error('quota'), { reasonCode: 'resource-exhausted' });
      commit();
    });
    await expect(owner.writeCollection('notes', changed())).rejects.toMatchObject({ reasonCode: 'resource-exhausted' });
    expect(owner.status()).toEqual({ cleanupPending: false, recoveryRequired: false, recoveryPending: false });
    expect((await owner.readCollection('notes')).records).toEqual(records());
    expect(file.data.size).toBe(4);
    file.intercept(undefined);
    await owner.writeCollection('notes', changed());
    expect((await owner.readCollection('notes')).records).toEqual(changed());
  });

  it('rejects cleanup references into current or outside the exact collection', () => {
    const current = ['nimiday/v1/notes.g2-0.json'];
    for (const obsolete of [current, ['nimiday/v1/items.g1-0.json'], ['../notes.g1-0.json']]) {
      expect(() => parseCollectionIndex({ version: 2, generation: 2, current, pending: { phase: 'published', obsolete } }, 'notes')).toThrow('index is damaged');
    }
  });
});
