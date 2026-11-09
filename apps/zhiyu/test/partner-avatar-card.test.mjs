import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { JSDOM } from 'jsdom';

test('partner previews preserve rail selection and exact panel targets, and discard late old-partner reads', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const original = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { ZhiyuPartnerAvatarCard } = await import('../src/shell/agent-chat/ZhiyuPartnerAvatarCard.tsx');
  const root = createRoot(document.getElementById('root'));
  const reads = [], opens = [], selections = [];
  let finishOld;
  const introduction = id => ({ worldName: `World ${id}`, role: `Role ${id}`, era: null, greeting: null, referenceImageUrl: id === 'A' ? 'https://assets.example/detail-960.webp' : null,
    voicePreviewUrl: null, questionTopics: [{ kind: 'role', text: `Role ${id}` }, { kind: 'topic', text: `Topic ${id}` }] });
  const reader = async ({ agentHandle }) => {
    reads.push(agentHandle);
    if (agentHandle === 'failed') throw new Error('Introduction unavailable');
    if (agentHandle === 'old') return new Promise(resolve => { finishOld = () => resolve(introduction('old')); });
    return introduction(agentHandle);
  };
  const render = (id, placement = 'composer') => act(async () => root.render(React.createElement(ZhiyuPartnerAvatarCard,
    { agentHandle: id, name: `Partner ${id}`, avatarUrl: 'https://assets.example/avatar-160.webp', placement, readIntroduction: reader,
      onSelect: () => selections.push(id), onOpen: section => opens.push([id, section]) },
    React.createElement('button', { 'data-trigger': true }, 'Preview'))));
  const trigger = () => document.querySelector('[data-trigger]');
  const card = () => document.querySelector('[data-testid="zhiyu-partner-card"]');
  const settle = () => act(async () => { return new Promise(resolve => setTimeout(resolve, 30)); });
  const open = async () => { await act(async () => trigger().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))); await settle(); };
  try {
    await render('A'); assert.deepEqual(reads, []);
    await open(); assert.equal(document.activeElement, card());
    assert.match(card().textContent, /World A/);
    assert.equal(card().querySelector('.zhiyu-partner-preview__art img').getAttribute('src'), 'https://assets.example/detail-960.webp');
    assert.equal(card().querySelector('li').textContent, 'Topic A', 'topics do not repeat the authored role');
    await act(async () => [...card().querySelectorAll('button')].find(b => b.textContent === '记忆').click());
    assert.deepEqual(opens, [['A', 'cognition']]);
    await render('B', 'rail'); await act(async () => trigger().click());
    assert.deepEqual(selections, ['B']); assert.equal(card(), null);
    await open();
    assert.equal(card().querySelector('.zhiyu-partner-preview__art'), null, 'missing detail media must not enlarge the inventory thumbnail');
    await act(async () => [...card().querySelectorAll('button')].find(b => b.textContent === '伙伴中心').click());
    assert.deepEqual(opens, [['A', 'cognition'], ['B', 'overview']]);
    await render('old'); await open(); assert.match(card().textContent, /正在读取/);
    assert.equal(card().querySelector('.zhiyu-partner-preview__art'), null, 'pending reads must not enlarge the inventory thumbnail');
    await render('new'); await act(async () => finishOld()); await settle();
    assert.equal(card(), null, 'an old read cannot reopen a new partner preview');
    await open(); assert.match(card().textContent, /World new/); assert.doesNotMatch(card().textContent, /World old/);
    await render('failed'); await open();
    assert.match(card().textContent, /人物介绍暂时无法加载/);
    assert.equal(card().querySelector('.zhiyu-partner-preview__art'), null, 'failed reads must not enlarge the inventory thumbnail');
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
