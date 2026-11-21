import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectWorldCatalogWorlds,
  selectWorldDiscoverySlots,
  selectWorldSpotlight,
  WORLD_ATLAS_LEAD_WORLD_IDS,
  WORLD_DISCOVERY_DEFERRED_IDS,
  WORLD_DISCOVERY_OPENING_IDS,
} from '../src/shell/renderer/features/world/world-list-catalog-model.js';
import { toWorldListItem, type WorldListItem } from '../src/shell/renderer/features/world/world-list-model.js';

function world(id: string, topicIds: string[] = [], genre: string | null = null): WorldListItem {
  return toWorldListItem({ id, name: id, summary: id, topicIds, genre,
    media: { bannerUrl: `https://example.com/${id}.png` }, stats: {}, time: { mode: 'static' } });
}

const ids = (worlds: readonly Pick<WorldListItem, 'id'>[]) => worlds.map(world => world.id);

test('discovery orders reviewed r16 worlds with varied pacing and keeps every accepted world', () => {
  const items = [
    'z03', 'x02', 'x01', 'u01', 'yokai-department-9f', 'tower-livestream-arena',
    'song-frontier-squad', 'shanghai-88f-pitch', 'rainy-rental-alley', 'love-show-night-stall',
    'liaozhai-paper-village', 'junkyard-mecha-girl', 'global-death-exam', 'fengshen-bronze-ruins',
    'cwe-b01-u08', 'dayong-court-gossip',
  ].map(id => world(id));
  const before = [...items];
  const ordered = selectWorldCatalogWorlds([{ items }], '', '');
  const leads = WORLD_ATLAS_LEAD_WORLD_IDS.map(id => world(id));
  const spotlight = new Set(ids(selectWorldSpotlight(ordered, leads)));
  const visible = ids(ordered.filter(item => !spotlight.has(item.id)));
  assert.deepEqual(visible.slice(0, 6), [
    'fengshen-bronze-ruins',
    'love-show-night-stall',
    'global-death-exam',
    'liaozhai-paper-village',
    'junkyard-mecha-girl',
    'cwe-b01-u08',
  ]);
  assert.equal(ordered.length, items.length);
  assert.deepEqual(new Set(ordered), new Set(items), 'keep every accepted World and its facts');
  assert.deepEqual(items, before, 'do not mutate cached server order');
  assert.deepEqual(selectWorldCatalogWorlds([{ items }], '', ''), ordered, 'ordering is repeatable');
});

test('unreviewed worlds interleave explicit topics while retaining order within each topic', () => {
  const items = [world('history-a', ['history']), world('history-b', ['history']), world('history-c', ['history']),
    world('future-a', ['future']), world('future-b', ['future']), world('nature-a', ['ecology'])];
  assert.deepEqual(ids(selectWorldCatalogWorlds([{ items }], '', '')),
    ['history-a', 'future-a', 'nature-a', 'history-b', 'future-b', 'history-c']);
});

test('genre-only and unassigned worlds remain discoverable without guessed categories', () => {
  const items = [world('a', [], 'Fantasy'), world('b', [], 'Fantasy'), world('c'), world('d'), world('e', [], 'History')];
  assert.deepEqual(ids(selectWorldCatalogWorlds([{ items }], '', '')), ['a', 'c', 'e', 'b', 'd']);
  assert.deepEqual(selectWorldCatalogWorlds([], '', ''), []);
  assert.deepEqual(selectWorldCatalogWorlds([{ items: [] }], '', ''), []);
});

test('new pages append without moving previously displayed worlds or losing any entries', () => {
  const first = { items: [world('z03'), world('other-a', ['history']), world('other-b', ['history'])] };
  const second = { items: [world('other-c', ['future']), world('fengshen-bronze-ruins'), world('other-d', ['ecology'])] };
  const initial = selectWorldCatalogWorlds([first], '', '');
  const expanded = selectWorldCatalogWorlds([first, second], '', '');
  assert.deepEqual(expanded.slice(0, initial.length), initial);
  assert.deepEqual(new Set(expanded), new Set([...first.items, ...second.items]));
});

test('catalog covers enter the opening grid only after their spotlight placement is known', () => {
  const catalog = [world('candidate'), world('next')];
  const leads = [world(WORLD_DISCOVERY_OPENING_IDS[1]), ...WORLD_ATLAS_LEAD_WORLD_IDS.slice(1).map(id => world(id))];
  const pending = new Set<string>([WORLD_DISCOVERY_OPENING_IDS[0], WORLD_ATLAS_LEAD_WORLD_IDS[0]]);
  const waiting = selectWorldDiscoverySlots(catalog, leads, pending, new Set());
  assert.equal(waiting.waitingForSpotlight, true);
  assert.deepEqual(waiting.slots.map(slot => slot.world?.id ?? null), [null, WORLD_DISCOVERY_OPENING_IDS[1]]);
  // The first spotlight and grid reads finish unavailable. The catalog supplies one carousel cover.
  const spotlight = selectWorldSpotlight(catalog, leads);
  const ready = selectWorldDiscoverySlots(catalog, leads, new Set(), new Set(ids(spotlight)));
  assert.equal(ready.waitingForSpotlight, false);
  assert.deepEqual(ids(ready.slots), [WORLD_DISCOVERY_OPENING_IDS[1], 'next']);
});

test('search and topic filters retain server ranking, including reviewed worlds', () => {
  const pages = [{ items: [world('z03'), world('fengshen-bronze-ruins'), world('a', ['history'])] }, { items: [world('x02')] }];
  const serverOrder = pages.flatMap(page => page.items);
  for (const [query, topic] of [['夜市', ''], ['', 'history'], ['夜市', 'comedy']]) {
    assert.deepEqual(selectWorldCatalogWorlds(pages, query!, topic!), serverOrder);
  }
});

test('curated r16 leads and opening slots contain no retired legacy dynasty IDs', () => {
  assert.equal(WORLD_DISCOVERY_DEFERRED_IDS.length, 0);
  const allCurated = [...WORLD_ATLAS_LEAD_WORLD_IDS, ...WORLD_DISCOVERY_OPENING_IDS];
  assert.equal(new Set(allCurated).size, allCurated.length, 'curated leads and opening slots are disjoint');
  for (const id of allCurated) {
    assert.ok(!id.startsWith('cbdb-'), `retired dynasty ID ${id} must not be hardcoded`);
  }
});
