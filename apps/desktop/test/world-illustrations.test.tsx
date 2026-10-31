import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { worldIllustrations } from '../src/shell/renderer/features/world/world-detail-illustrations.js';

test('external illustration dimensions stay unknown until the image loads', () => {
  const illustrations = worldIllustrations({ scenes: [], resourceRefs: [], intents: [], externalRefs: [
    { refId: 'portrait', kind: 'highlight', uri: 'https://example.test/portrait.png' },
  ] });
  assert.equal(illustrations[0]?.ratio, null);
});

test('illustrations learn external dimensions, retain the gallery layout, and offer a resettable keyboard-dismissable viewer', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent, Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { WorldDetailStory } = await import('../src/shell/renderer/features/world/world-detail-story.js');
  await initI18n();
  await changeLocale('en');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const document = dom.window.document;
  const button = (label: string) => {
    const node = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.getAttribute('aria-label') === label || item.textContent === label);
    assert.ok(node, label);
    return node;
  };
  const dialog = () => document.querySelector('[role="dialog"][aria-hidden="false"]');
  const mainImage = () => document.querySelector<HTMLImageElement>('[data-testid="world-illustration-open"] img')!;
  const settleClose = async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 750)); });
    // Radix restores the trigger on the task after the exit unmount commits.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  };
  let readCount = 0;
  try {
    await act(async () => root.render(<WorldDetailStory worldName="Gallery" story="A story worth reading." showExcerpt hasReading
      illustrations={[
        { id: 'portrait', url: 'https://example.test/portrait.png', ratio: null },
        { id: 'landscape', url: 'https://example.test/landscape.png', ratio: null },
      ]} onReadWorld={() => { readCount++; }} />));
    const thumbnails = [...document.querySelectorAll<HTMLImageElement>('[data-testid="world-illustration-thumbnails"] img')];
    for (const [index, [width, height]] of [[600, 900], [1600, 900]].entries()) {
      Object.defineProperties(thumbnails[index]!, { naturalWidth: { value: width }, naturalHeight: { value: height } });
      await act(async () => thumbnails[index]!.dispatchEvent(new dom.window.Event('load')));
    }
    const story = document.querySelector<HTMLElement>('[data-testid="world-detail-story"]')!;
    const reservedRatio = story.style.getPropertyValue('--world-illustration-ratio');
    assert.equal(Number(reservedRatio), 1600 / 900);
    await act(async () => button('Illustration 2 of Gallery').click());
    assert.equal(mainImage().getAttribute('src'), 'https://example.test/landscape.png');
    assert.equal(story.style.getPropertyValue('--world-illustration-ratio'), reservedRatio);
    const trigger = document.querySelector<HTMLButtonElement>('[data-testid="world-illustration-open"]')!;
    trigger.focus();
    await act(async () => trigger.click());
    assert.ok(dialog());
    assert.equal(dialog()!.querySelector('img')?.getAttribute('src'), mainImage().getAttribute('src'));
    await act(async () => button('Zoom in').click());
    assert.match(dialog()!.textContent!, /150%/);
    await act(async () => button('Fit to window').click());
    assert.match(dialog()!.textContent!, /100%/);
    const viewport = document.querySelector<HTMLElement>('[data-testid="world-illustration-viewport"]')!;
    await act(async () => viewport.dispatchEvent(new dom.window.Event('dblclick', { bubbles: true })));
    assert.match(dialog()!.textContent!, /200%/);
    await act(async () => viewport.dispatchEvent(new dom.window.Event('dblclick', { bubbles: true })));
    assert.match(dialog()!.textContent!, /100%/);
    await act(async () => button('Zoom in').click());
    await act(async () => button('Previous illustration').click());
    assert.equal(dialog()!.querySelector('img')?.getAttribute('src'), 'https://example.test/portrait.png');
    assert.match(dialog()!.textContent!, /100%/);
    assert.equal(button('Previous illustration').disabled, true);
    await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await settleClose();
    assert.equal(dialog(), null);
    assert.ok(document.activeElement === trigger, `Escape returns focus to the image trigger; active: ${document.activeElement?.outerHTML.slice(0, 350)}`);
    const iconTrigger = button('Enlarge image');
    iconTrigger.focus();
    await act(async () => iconTrigger.click());
    assert.match(dialog()!.textContent!, /100%/);
    await act(async () => button('Close image').click());
    await settleClose();
    assert.ok(document.activeElement === iconTrigger, 'closing returns focus to the enlarge icon');
    for (let image = 0; image < 2; image++) {
      for (let attempt = 0; attempt < 2; attempt++) await act(async () => mainImage().dispatchEvent(new dom.window.Event('error')));
    }
    assert.equal(document.querySelector('[data-testid="world-detail-illustrations"]'), null);
    await act(async () => button('View full world setting').click());
    assert.equal(readCount, 1);
  } finally {
    await act(async () => root.unmount());
    await new Promise((resolve) => setTimeout(resolve, 0));
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
