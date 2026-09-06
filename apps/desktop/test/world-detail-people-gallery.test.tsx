/**
 * People gallery — grouping model + overlay render proof.
 *
 * Covers the "view all people you can meet" surface: the pure clustering model
 * (faction / tier / status axes, in-group sorting, search, default-axis pick)
 * and a static render of the overlay through the real i18n instance so every
 * group label and control resolves with no missing keys.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// ScrollArea / radix CJS primitives expect a global `React`.
(globalThis as { React?: typeof React }).React = React;

import { initI18n } from '../src/shell/renderer/i18n';
import worldDetailZh from '../src/shell/renderer/locales/zh/41-WorldDetail.json' with { type: 'json' };
import { WorldPeopleArchivePage, WorldPeopleGallery } from '../src/shell/renderer/features/world/world-detail-people-gallery';
import {
  availableGroupBys,
  buildPeopleGroups,
  connectableCount,
  defaultPeopleGroupBy,
  filterPeople,
} from '../src/shell/renderer/features/world/world-detail-people-gallery-model';
import type { WorldCharacter } from '../src/shell/renderer/features/world/world-detail-types';

function character(overrides: Partial<WorldCharacter> & Pick<WorldCharacter, 'id' | 'name'>): WorldCharacter {
  return {
    handle: `@${overrides.id}`,
    bio: `${overrides.name} 的生平。`,
    sourceRef: { kind: 'worldCharacter', worldId: 'w', characterId: overrides.id } as unknown as WorldCharacter['sourceRef'],
    sourceKind: 'worldCharacter',
    ownership: 'worldOwned',
    relation: { state: 'connectable' },
    createdAt: '2026-01-01T00:00:00.000Z',
    importance: 'SECONDARY',
    ...overrides,
  };
}

const roster: WorldCharacter[] = [
  character({ id: 'yao', name: '姚燧', faction: '文人交游圈', importance: 'PRIMARY', stats: { vitalityScore: 90 } }),
  character({ id: 'tong', name: '同恕', faction: '文人交游圈', importance: 'SECONDARY', stats: { vitalityScore: 70 } }),
  character({ id: 'ni', name: '倪瓒', faction: '隐逸画家', importance: 'SECONDARY', relation: { state: 'unavailable' } }),
  character({ id: 'wu', name: '吴全节', faction: '道教交游枢纽', importance: 'BACKGROUND', relation: { state: 'connected' } }),
  character({ id: 'li', name: '李存', importance: 'BACKGROUND' }),
];

test('default axis prefers faction when ≥2 factions exist', () => {
  assert.equal(defaultPeopleGroupBy(roster), 'faction');
  const noFaction = roster.map((c) => ({ ...c, faction: null }));
  assert.equal(defaultPeopleGroupBy(noFaction), 'tier');
  assert.deepEqual(availableGroupBys(roster), ['faction', 'tier', 'status']);
  assert.deepEqual(availableGroupBys(noFaction), ['tier', 'status']);
});

test('faction grouping pins connected people above circles sorted by size', () => {
  const groups = buildPeopleGroups(roster, 'faction');
  // 吴全节 is already local → pinned to the leading connected group on every axis.
  assert.equal(groups[0].labelKey, 'connected');
  assert.deepEqual(groups[0].characters.map((c) => c.name), ['吴全节']);
  // Largest real circle first; '李存' (no faction) lands in the trailing ungrouped bucket.
  assert.equal(groups[1].label, '文人交游圈');
  assert.equal(groups[groups.length - 1].id, 'ungrouped');
  assert.equal(groups[groups.length - 1].labelKey, 'ungrouped');
  assert.deepEqual(groups[1].characters.map((c) => c.name), ['姚燧', '同恕']);
});

test('tier grouping pins connected first, then core → active → background', () => {
  const groups = buildPeopleGroups(roster, 'tier');
  assert.deepEqual(groups.map((g) => g.labelKey), ['connected', 'PRIMARY', 'SECONDARY', 'BACKGROUND']);
  assert.equal(groups[1].characters[0].name, '姚燧');
});

test('status grouping splits connectable / connected / unavailable', () => {
  const groups = buildPeopleGroups(roster, 'status');
  assert.deepEqual(groups.map((g) => g.labelKey), ['connected', 'connectable', 'unavailable']);
  const byKey = Object.fromEntries(groups.map((g) => [g.labelKey, g.characters.length]));
  assert.equal(byKey.connectable, 3);
  assert.equal(byKey.connected, 1);
  assert.equal(byKey.unavailable, 1);
  assert.equal(connectableCount(roster), 3);
});

test('search filters across name, role and faction', () => {
  assert.deepEqual(filterPeople(roster, '隐逸').map((c) => c.name), ['倪瓒']);
  assert.deepEqual(filterPeople(roster, '姚').map((c) => c.name), ['姚燧']);
  assert.equal(filterPeople(roster, '').length, roster.length);
});

test.before(async () => {
  await initI18n();
});

test('gallery overlay renders grouped roster with resolved copy', () => {
  const markup = renderToStaticMarkup(
    React.createElement(WorldPeopleGallery, {
      characters: roster,
      onClose: () => {},
      onSelect: () => {},
      onMaterializeSource: () => {},
    }),
  );

  assert.match(markup, /data-testid="world-detail-people-gallery"/);
  // Default faction axis → faction group titles surface.
  assert.match(markup, /文人交游圈/);
  assert.match(markup, /隐逸画家/);
  // Controls + every character present.
  assert.match(markup, /姚燧/);
  assert.match(markup, /李存/);
  // Connected people pin to the leading group and get a compact chat pill.
  assert.match(markup, /Local agent ready/);
  assert.match(markup, /Chat now/);
  // No raw i18n keys leak.
  assert.doesNotMatch(markup, /WorldDetail\.paper\.gallery\./);
});

test('archive page renders as an in-page drill-down without the modal backdrop', () => {
  const markup = renderToStaticMarkup(
    React.createElement(WorldPeopleArchivePage, {
      characters: roster,
      onBack: () => {},
      onSelect: () => {},
      onMaterializeSource: () => {},
    }),
  );

  assert.match(markup, /data-testid="world-detail-people-archive-page"/);
  assert.match(markup, /People you can meet/);
  assert.match(markup, /Add character/);
  assert.match(markup, /Back to world detail/);
  assert.doesNotMatch(markup, /position:fixed;inset:0/);
  assert.doesNotMatch(markup, /background:rgba\(38,32,23,.5\)/);
});

test('people archive Chinese add action uses character language', () => {
  assert.equal(worldDetailZh.paper.characters.connect, '添加角色');
});

test('archive page keeps only the leading back control', () => {
  const markup = renderToStaticMarkup(
    React.createElement(WorldPeopleArchivePage, {
      characters: roster,
      onBack: () => {},
      onSelect: () => {},
      onMaterializeSource: () => {},
    }),
  );

  assert.equal(markup.match(/Back to world detail/g)?.length, 1);
});
