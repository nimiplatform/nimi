import assert from 'node:assert/strict';
import test from 'node:test';
import { selectWorldCatalogWorlds, selectWorldDiscoveryWorlds, selectWorldSpotlight, WORLD_ATLAS_LEAD_WORLD_IDS } from '../src/shell/renderer/features/world/world-list-catalog-model.js';
import { toWorldListItem, type WorldListItem } from '../src/shell/renderer/features/world/world-list-model.js';

function world(id: string, topicIds: string[] = [], genre: string | null = null): WorldListItem {
  return toWorldListItem({ id, name: id, summary: id, topicIds, genre,
    media: { bannerUrl: `https://example.com/${id}.png` }, stats: {}, time: { mode: 'static' } });
}

const ids = (worlds: readonly WorldListItem[]) => worlds.map(world => world.id);

test('discovery separates the reviewed ensemble covers and opens with varied scenes', () => {
  // Current first server page: production batches previously placed all four
  // similar covers in a two-by-two block after spotlight removal.
  const items = ['z05', 'z04', 'z03', 'z02', 'z01', 'y06', 'y05', 'y04', 'y03', 'y02', 'y01',
    'x06', 'x05', 'x04', 'x03', 'x02', 'x01', 'u06', 'u05', 'u04'].map(id => world(id));
  const before = [...items];
  const ordered = selectWorldCatalogWorlds([{ items }], '', '');
  const leads = WORLD_ATLAS_LEAD_WORLD_IDS.map(id => world(id));
  const spotlight = new Set(ids(selectWorldSpotlight(ordered, leads)));
  const visible = ids(ordered.filter(item => !spotlight.has(item.id)));
  assert.deepEqual(visible.slice(0, 6), ['x05', 'z04', 'u06', 'y01', 'z02', 'x06']);
  const ensembles = ['y01', 'y05', 'y02', 'y04'].map(id => visible.indexOf(id));
  for (let index = 1; index < ensembles.length; index += 1) {
    assert.ok(ensembles[index]! - ensembles[index - 1]! >= 4, 'leave at least three different covers between ensembles');
  }
  assert.ok(visible.indexOf('y04') - visible.indexOf('y05') >= 9, 'separate the two supper scenes');
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
  const first = { items: [world('y04'), world('other-a', ['history']), world('other-b', ['history'])] };
  const second = { items: [world('other-c', ['future']), world('x05'), world('other-d', ['ecology'])] };
  const initial = selectWorldCatalogWorlds([first], '', '');
  const expanded = selectWorldCatalogWorlds([first, second], '', '');
  assert.deepEqual(expanded.slice(0, initial.length), initial);
  assert.deepEqual(new Set(expanded), new Set([...first.items, ...second.items]));
});

test('search and topic filters retain server ranking, including reviewed worlds', () => {
  const pages = [{ items: [world('y04'), world('x05'), world('a', ['history'])] }, { items: [world('y01')] }];
  const serverOrder = pages.flatMap(page => page.items);
  for (const [query, topic] of [['海岸', ''], ['', 'history'], ['海岸', 'everyday']]) {
    assert.deepEqual(selectWorldCatalogWorlds(pages, query!, topic!), serverOrder);
  }
});

test('dynasty worlds stay out of the opening grid and are dispersed after row 20', () => {
  const openingIds = ['thinink-plains', 'summerwell-village', 'prism-city-network', 'oneiric-littoral', 'living-echo-continent'];
  const dynastyIds = [
    'cbdb-qing-scholar-gentry-world',
    'cbdb-tang-literati-world',
    'cbdb-northern-song-scholar-official-world',
    'cbdb-southern-song-memory-world',
    'cbdb-yuan-literati-academy-world',
  ];
  const leads = [...openingIds, ...dynastyIds].map(id => world(id));
  const catalog = Array.from({ length: 130 }, (_, index) => world(`catalog-${index}`));
  const ordered = selectWorldDiscoveryWorlds(catalog, leads);
  assert.deepEqual(ids(ordered).slice(0, openingIds.length), openingIds);
  dynastyIds.forEach((id, index) => {
    const row = 21 + index * 5;
    assert.equal(ordered[(row - 1) * 3]?.id, id, `${id} starts row ${row}`);
  });
  assert.equal(ordered.length, catalog.length + leads.length);
  assert.equal(new Set(ids(ordered)).size, ordered.length);
  const partial = selectWorldDiscoveryWorlds(catalog.slice(0, 50), leads);
  assert.ok(partial.every(item => !dynastyIds.includes(item.id)), 'partial catalogs do not surface deferred worlds early');
});
