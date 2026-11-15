import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

test('discovery preserves pages and selected source, explicitly connects, and ignores departed results', async () => {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, React, IS_REACT_ACT_ENVIRONMENT: true };
  const before = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { ZhiyuCharacterDiscovery, characterKey } = await import('../src/shell/discovery/ZhiyuCharacterDiscovery.tsx');
  const { createZhiyuNavigation } = await import('../src/shell/app/navigation.tsx');
  const navigation = createZhiyuNavigation();
  const partner = { agentHandle: 'opaque-partner', displayName: 'Wren' };
  const character = id => ({ sourceRef: { kind: 'personaCharacter', id, worldId: 'world', sourceHash: 'a'.repeat(64), ownerAccountId: 'author' }, displayName: id, summary: 'Public source', worldName: 'World', disposition: '', traits: [], topics: [], connectable: true, existingPartner: null, avatarUrl: null });
  const one = character('One'), two = character('Two');
  const reads = [], connects = [], reached = [], worlds = [];
  let inventoryKey = 'initial';
  let query = '';
  const externallyOwned = new Set();
  let finish;
  const client = {
    async listCharacters(input) {
      reads.push(input);
      const item = input.cursor ? two : one;
      return { items: [{ ...item, existingPartner: externallyOwned.has(item.sourceRef.id) ? partner : null }],
        nextCursor: input.cursor || input.query ? '' : 'page-two' };
    },
    connectCharacter(input) { connects.push(input); return new Promise(resolve => { finish = resolve; }); },
  };
  const cache = new Map();
  const root = createRoot(document.getElementById('root'));
  let selected;
  const render = async () => act(async () => root.render(React.createElement(ZhiyuCharacterDiscovery, { client, cache, inventoryKey, query, selectedKey: selected,
    onSearch() {}, onSelect(value) { selected = value; }, onBack() {}, onPartner: value => reached.push(value), openWorld: async value => { worlds.push(value); } })));
  const click = async text => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.includes(text)); assert.ok(button, text); await act(async () => button.click()); };
  try {
    await render();
    assert.equal(connects.length, 0);
    await click('查看更多角色');
    assert.deepEqual(reads.map(value => value.cursor), [undefined, 'page-two']);
    await click('Two'); await render();
    assert.equal(selected, characterKey(two));
    await click('在 Home 查看世界'); assert.deepEqual(worlds, ['world']);
    query = 'One'; selected = undefined; await render();
    query = ''; selected = characterKey(two); await render();
    const beforeRefresh = reads.length;
    externallyOwned.add('One'); inventoryKey = 'partner-added-in-home';
    await render();
    assert.deepEqual(reads.slice(beforeRefresh).map(value => value.cursor), [undefined, 'page-two']);
    assert.equal(cache.get('').items.length, 2, 'inventory refresh preserves the loaded depth');
    assert.deepEqual(cache.get('').items[0].existingPartner, partner);
    assert.equal(selected, characterKey(two), 'the current detail remains selected');
    query = 'One'; selected = characterKey(one); await render();
    assert.ok(document.body.textContent.includes('已是你的伙伴'), 'another cached query is refreshed when revisited');
    query = ''; selected = characterKey(two); await render();
    await click('成为伙伴并聊天'); assert.deepEqual(connects[0].sourceRef, two.sourceRef);
    await act(async () => finish({ partner, created: true })); assert.deepEqual(reached, [partner]);
    await render(); assert.ok(document.body.textContent.includes('已是你的伙伴'));
    await click('继续聊天');
    await act(async () => root.unmount());
    await act(async () => finish({ partner, created: false })); assert.equal(reached.length, 1);
    assert.equal(cache.get('').items.length, 2);
    await navigation.push({ id: 'partner', agentHandle: 'previous-partner' });
    await navigation.push({ id: 'discover', agentHandle: 'previous-partner', query: 'Two', sourceKey: characterKey(two) });
    await navigation.push({ id: 'partner', agentHandle: 'new-partner' });
    await navigation.back();
    assert.equal(navigation.getSnapshot().current.destination.query, 'Two');
    assert.equal(navigation.getSnapshot().current.destination.sourceKey, characterKey(two));
  } finally {
    navigation.dispose(); dom.window.close();
    for (const [key, descriptor] of before) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
