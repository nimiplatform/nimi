import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

// T6.2-A — Contacts category convergence (D-CONTACTS-002).
// Contacts presents exactly two relationship categories: human friends and
// agent friends (plus requests / blocked sub-views). There is no third
// `myAgents` / `MASTER_OWNED` category; owner-created befriended RealmAgents
// fold into the ordinary `agent_friends` category.

const __dirname = dirname(fileURLToPath(import.meta.url));
const contactsDir = resolve(__dirname, '../src/shell/renderer/features/contacts');

function read(name: string): string {
  return readFileSync(resolve(contactsDir, name), 'utf8');
}

test('TabFilter carries no `myAgents` third category', () => {
  const modelSource = read('contacts-model.ts');
  const tabFilterMatch = modelSource.match(/export type TabFilter = ([^;]+);/);
  assert.ok(tabFilterMatch && tabFilterMatch[1], 'TabFilter type must be declared');
  const tabFilter: string = tabFilterMatch[1];
  assert.doesNotMatch(tabFilter, /'myAgents'/);
  assert.match(tabFilter, /'humans'/);
  assert.match(tabFilter, /'agents'/);
  assert.match(tabFilter, /'requests'/);
  assert.match(tabFilter, /'blocks'/);
});

test('CATEGORIES exposes only humans + agents + requests + blocks — no myAgents', () => {
  const viewTypesSource = read('contacts-view-types.ts');
  assert.doesNotMatch(viewTypesSource, /myAgents/);
  assert.doesNotMatch(viewTypesSource, /myAgentsCount/);
});

test('contacts feature carries no MASTER_OWNED category splitting', () => {
  // The `agents` category is the single Agent category — no list is split out
  // by `agentOwnershipType === 'MASTER_OWNED'`.
  for (const name of ['contacts-panel.tsx', 'contacts-category-list.tsx', 'contacts-view.tsx']) {
    const source = read(name);
    assert.doesNotMatch(
      source,
      /agentOwnershipType\s*===\s*'MASTER_OWNED'/,
      `${name} must not split a category by MASTER_OWNED ownership`,
    );
    assert.doesNotMatch(
      source,
      /agentOwnershipType\s*!==\s*'MASTER_OWNED'/,
      `${name} must not split a category by MASTER_OWNED ownership`,
    );
  }
});

test('no "My Agent" role sub-label after convergence', () => {
  const categoryListSource = read('contacts-category-list.tsx');
  assert.doesNotMatch(categoryListSource, /roleMyAgent/);
});

test('contacts locale files carry no orphaned myAgents keys', () => {
  for (const locale of ['en', 'zh']) {
    const raw = readFileSync(
      resolve(__dirname, `../src/shell/renderer/locales/${locale}/24-Contacts.json`),
      'utf8',
    );
    const keys = Object.keys(JSON.parse(raw) as Record<string, unknown>);
    for (const orphan of ['tabMyAgents', 'roleMyAgent', 'yourMyAgents', 'myAgentsDescription']) {
      assert.ok(
        !keys.includes(orphan),
        `${locale}/24-Contacts.json must not carry orphaned key ${orphan}`,
      );
    }
  }
});

test('a persisted `myAgents` filter migrates to `agents` on read', async () => {
  const store = new Map<string, string>();
  const originalWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
  };
  try {
    const { loadStoredContactsFilter, CONTACTS_ACTIVE_FILTER_STORAGE_KEY } = await import(
      '../src/shell/renderer/features/contacts/contacts-model.js'
    );

    store.set(CONTACTS_ACTIVE_FILTER_STORAGE_KEY, 'myAgents');
    assert.equal(loadStoredContactsFilter('humans'), 'agents');

    store.set(CONTACTS_ACTIVE_FILTER_STORAGE_KEY, 'agents');
    assert.equal(loadStoredContactsFilter('humans'), 'agents');

    store.set(CONTACTS_ACTIVE_FILTER_STORAGE_KEY, 'humans');
    assert.equal(loadStoredContactsFilter('agents'), 'humans');

    store.delete(CONTACTS_ACTIVE_FILTER_STORAGE_KEY);
    assert.equal(loadStoredContactsFilter('humans'), 'humans');
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }
});
