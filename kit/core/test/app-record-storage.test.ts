import { expect, it } from 'vitest';
import { createNimiAppRecordStore } from '../src/app-record-storage.js';
import type { NimiLocalAppAssetsClient } from '../src/sdk-contract.js';

function ownerFixture() {
  const records = new Map<string, Uint8Array>();
  const rawAssets = {
    async write(input: { relativePath: string; body: Uint8Array }) { records.set(input.relativePath, input.body.slice()); return {}; },
    async list({ prefix }: { prefix: string }) { return { assets: [...records.keys()].filter(path => path.startsWith(prefix)).sort().map(relativePath => ({ relativePath })), nextCursor: '' }; },
    async read({ relativePath }: { relativePath: string }) {
      const body = records.get(relativePath)?.slice();
      if (!body) throw { reasonCode: 'APP_STORAGE_ENTRY_NOT_FOUND' };
      return { body: (async function* () { yield body; })() };
    },
    async remove(path: string) { return { removed: records.delete(path) }; },
  };
  const assets = rawAssets as unknown as NimiLocalAppAssetsClient;
  const parse = (value: unknown) => {
    const row = value as { id: string; text: string };
    if (!row || typeof row.id !== 'string' || typeof row.text !== 'string') throw new Error('invalid record');
    return row;
  };
  return { assets, rawAssets, records, create: () => createNimiAppRecordStore(assets, 'history/runs', parse) };
}

it('two independent clients append without replacing one another or using an index', async () => {
  const f = ownerFixture();
  const a = f.create(), b = f.create();
  await Promise.all([a.write({ id: 'A', text: 'first' }), b.write({ id: 'B', text: 'second' })]);
  expect(await a.list()).toEqual([{ id: 'A', text: 'first' }, { id: 'B', text: 'second' }]);
  expect([...f.records.keys()]).toEqual(['history/runs/A.json', 'history/runs/B.json']);
});

it('clearing listed records cannot remove another writer before it publishes', async () => {
  const f = ownerFixture();
  const write = f.rawAssets.write;
  let publish!: () => void;
  f.rawAssets.write = async input => { if (input.relativePath.endsWith('/A.json')) await new Promise<void>(resolve => { publish = resolve; }); return write(input); };
  const a = f.create(), b = f.create();
  const pending = a.write({ id: 'A', text: 'not published yet' });
  await b.write({ id: 'B', text: 'published' });
  for (const record of await b.list()) await b.remove(record.id);
  publish(); await pending;
  expect(await b.list()).toEqual([{ id: 'A', text: 'not published yet' }]);
});

it('does not accept corrupt or mismatched records as empty history', async () => {
  const f = ownerFixture();
  f.records.set('history/runs/A.json', new TextEncoder().encode('{"id":"B","text":"wrong"}'));
  await expect(f.create().list()).rejects.toThrow('identity');
});
