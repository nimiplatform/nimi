import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

test('Home guidance appears only during cold start, disappears completely once AI is ready, and supports per-account dismissal', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    Event: dom.window.Event,
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { createRoot } = await import('react-dom/client');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { HomeGettingStarted } = await import('../src/shell/renderer/features/home/home-getting-started.js');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const opened: string[] = [];
  const actions = {
    onOpenAI: () => opened.push('local'),
    onOpenCloud: () => opened.push('cloud'),
    onOpenChat: () => opened.push('chat'),
    onExplore: () => opened.push('explore'),
    onOpenApps: () => opened.push('apps'),
  };
  const render = async (state: 'unset' | 'preparing' | 'ready' | 'attention' | 'unknown', account = 'first') => {
    await act(async () => root.render(<HomeGettingStarted key={account} accountKey={account} textPreparation={state} {...actions} />));
  };
  const click = async (text: string) => {
    const button = [...dom.window.document.querySelectorAll('button')].find((item) => item.textContent?.trim() === text);
    assert.ok(button, `missing action ${text}`);
    await act(async () => button.click());
  };
  try {
    await initI18n();
    await changeLocale('en');
    for (const state of ['unset', 'preparing', 'attention', 'unknown'] as const) {
      await render(state);
      assert.ok(dom.window.document.getElementById('home-getting-started-steps'), `guidance disappeared for ${state}`);
      assert.match(dom.window.document.body.textContent ?? '', /View local AI/);
    }
    for (const label of ['View local AI', 'Use cloud services', 'Open Nimi Chat', 'Explore companions', 'Browse apps']) {
      await click(label);
    }
    assert.deepEqual(opened, ['local', 'cloud', 'chat', 'explore', 'apps']);

    // Ready state completely retires the module (returns null) so it is never a permanent fixture.
    await render('ready');
    assert.equal(dom.window.document.querySelector('[data-testid="home-first-run"]'), null);

    // Explicit dismissal during cold start hides the guide for this account without leaking to another account.
    await render('unset', 'first');
    assert.ok(dom.window.document.querySelector('[data-testid="home-first-run"]'));
    const dismissButton = dom.window.document.querySelector<HTMLButtonElement>('[data-testid="home-first-run-dismiss"]');
    assert.ok(dismissButton);
    await act(async () => dismissButton.click());
    assert.equal(dom.window.document.querySelector('[data-testid="home-first-run"]'), null);

    // Remounting for 'first' stays dismissed, while 'second' unready account still sees onboarding.
    await act(async () => root.render(null));
    await render('unset', 'first');
    assert.equal(dom.window.document.querySelector('[data-testid="home-first-run"]'), null);
    await render('unset', 'second');
    assert.ok(dom.window.document.querySelector('[data-testid="home-first-run"]'));

    await act(async () => {
      await changeLocale('zh');
    });
    assert.match(dom.window.document.body.textContent ?? '', /首次启动快速向导/);
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
