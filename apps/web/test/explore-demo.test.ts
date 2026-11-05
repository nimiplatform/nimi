import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DemoExploreSurface, filterExploreWorlds } from '../src/landing/components/demo-explore.js';
import { exploreWorlds, exploreCharacters } from '../src/landing/content/explore-demo-data.js';
import { loadLandingContent } from '../src/landing/content/landing-content.js';
import { COURTYARD_PARTNER, demoChapters } from '../src/landing/content/demo-tour.js';
import { initialDemoSection, reduceDemoNavigation } from '../src/landing/content/demo-navigation.js';

test('Explore tour introduces worlds and varied characters before following one into a local conversation', async () => {
  const chapter = demoChapters[0]!;
  let state = reduceDemoNavigation({ entries: [{ surface: 'home' }], position: 0 }, { type: 'enter-section', index: initialDemoSection('#worlds') });
  assert.deepEqual(state.entries[state.position], { surface: 'explore' });
  const targets = ['characters', 'world:emberware-court', `character:${COURTYARD_PARTNER}`, `partner:${COURTYARD_PARTNER}`, COURTYARD_PARTNER];
  for (const [index, target] of targets.entries()) {
    state = reduceDemoNavigation(state, { type: 'guide', step: index + 1 });
    assert.deepEqual(state.entries[state.position], { surface: index === 4 ? 'chat' : 'explore', target });
  }
  for (const locale of ['zh', 'en'] as const) {
    const content = await loadLandingContent(locale);
    assert.equal(content.worlds.stops.length, chapter.stops.length);
    assert.ok(content.worlds.intro.includes('Local Agent'));
    assert.ok(!content.worlds.title.includes('禾罐') && !content.worlds.title.includes('Heguan'));
  }
});

test('Explore uses published world artwork and keeps every character attached to its source world', () => {
  const provenance = JSON.parse(readFileSync(new URL('../public/demo/explore/SOURCES.json', import.meta.url), 'utf8'));
  const files = new Set(provenance.assets.map((asset: { file: string }) => asset.file));
  assert.equal(exploreWorlds.length, 8);
  assert.equal(exploreCharacters.length, 16);
  assert.equal(new Set(exploreCharacters.map(person => person.id)).size, 16);
  for (const world of exploreWorlds) {
    for (const image of [world.image, world.illustration, ...world.people.map(person => person.image)].filter(Boolean)) {
      assert.ok(files.has(image), `Missing provenance: ${image}`);
      assert.ok(existsSync(fileURLToPath(new URL(`../public${image}`, import.meta.url))), `Missing asset: ${image}`);
    }
    for (const person of world.people) {
      assert.equal(person.worldId, world.id);
      assert.equal(person.worldName, world.name);
      assert.ok(person.bio.length > 0);
    }
  }
});

test('world search, topic filtering and saved worlds compose without leaking unrelated results', () => {
  assert.deepEqual(filterExploreWorlds(' 薄墨 ', '', []).map(world => world.id), ['thinink-plains']);
  assert.deepEqual(filterExploreWorlds('', 'everyday', []).map(world => world.id), ['summerwell-village']);
  assert.deepEqual(filterExploreWorlds('薄墨', 'future', []), []);
  assert.deepEqual(filterExploreWorlds('', 'favorites', []), []);
  assert.deepEqual(filterExploreWorlds('', 'favorites', ['prism-city-network']).map(world => world.id), ['prism-city-network']);
});

test('world gallery, character discovery and companion directory remain distinct in both interface languages', async () => {
  for (const locale of ['zh', 'en'] as const) {
    const { hero: { demo } } = await loadLandingContent(locale);
    const props = { demo, onNavigate() {}, onAddPartner() {}, onChat() {} };
    const gallery = renderToStaticMarkup(createElement(DemoExploreSurface, props));
    assert.ok(gallery.includes('明代士人交游网络'));
    assert.ok(gallery.includes('薄墨平原'));
    assert.ok(gallery.includes(locale === 'zh' ? '发现伙伴' : 'Discover companions'));
    assert.ok(!gallery.includes('/demo/storybook/'));
    const discovery = renderToStaticMarkup(createElement(DemoExploreSurface, { ...props, target: 'characters' }));
    assert.ok(discovery.includes('柯芬'));
    assert.ok(discovery.includes(locale === 'zh' ? '寻找角色' : 'Find characters'));
    const partners = renderToStaticMarkup(createElement(DemoExploreSurface, { ...props, target: 'partners' }));
    assert.ok(partners.includes('唐龙'));
    assert.ok(partners.includes(locale === 'zh' ? '我创建的' : 'Created by me'));
    const world = renderToStaticMarkup(createElement(DemoExploreSurface, { ...props, target: 'world:thinink-plains' }));
    assert.ok(world.includes('柯芬'));
    assert.ok(world.includes('雅图'));
    assert.ok(!world.includes('唐龙'));
  }
});
