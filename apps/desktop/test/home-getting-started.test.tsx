import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

test('Home guidance survives preparation and navigation, and only the user collapses it', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
    Node: dom.window.Node, Event: dom.window.Event, React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { HomeGettingStarted } = await import('../src/shell/renderer/features/home/home-getting-started.js');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const opened: string[] = [];
  const actions = {
    onOpenAI: () => opened.push('local'), onOpenCloud: () => opened.push('cloud'),
    onOpenChat: () => opened.push('chat'), onExplore: () => opened.push('explore'), onOpenApps: () => opened.push('apps'),
  };
  const render = async (state: 'unset' | 'preparing' | 'ready' | 'attention' | 'unknown', account = 'first') => {
    await act(async () => root.render(<HomeGettingStarted key={account} accountKey={account} textPreparation={state} {...actions} />));
  };
  const click = async (text: string) => {
    const button = [...dom.window.document.querySelectorAll('button')].find(item => item.textContent?.trim() === text);
    assert.ok(button, `missing action ${text}`);
    await act(async () => button.click());
  };
  try {
    await initI18n();
    await changeLocale('en');
    for (const state of ['unset', 'preparing', 'ready', 'attention', 'unknown'] as const) {
      await render(state);
      assert.ok(dom.window.document.getElementById('home-getting-started-steps'), `guidance disappeared for ${state}`);
      assert.match(dom.window.document.body.textContent ?? '', /Open Nimi Chat/);
      if (state === 'ready') assert.match(dom.window.document.body.textContent ?? '', /Open chat next/);
      if (state === 'unknown') assert.doesNotMatch(dom.window.document.body.textContent ?? '', /Local text resources are ready/);
    }
    for (const label of ['View local AI', 'Use cloud services', 'Open Nimi Chat', 'Explore companions', 'Browse apps']) await click(label);
    assert.deepEqual(opened, ['local', 'cloud', 'chat', 'explore', 'apps']);
    await click('Hide guidance');
    assert.equal(dom.window.document.getElementById('home-getting-started-steps'), null);
    await act(async () => root.render(null));
    await render('ready');
    assert.equal(dom.window.document.getElementById('home-getting-started-steps'), null, 'explicit choice survives returning to Home');
    await render('ready', 'second');
    assert.ok(dom.window.document.getElementById('home-getting-started-steps'), 'another account does not inherit the choice');
    await render('ready');
    await click('Show guidance');
    assert.ok(dom.window.document.getElementById('home-getting-started-steps'));
    await act(async () => { await changeLocale('zh'); });
    assert.match(dom.window.document.body.textContent ?? '', /本机文本资源已就绪/);
    await click('收起指引');
    await click('展开指引');
    assert.doesNotMatch(dom.window.document.body.textContent ?? '', /runtimeConfig\./);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
