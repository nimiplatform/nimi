/**
 * Steam-style two-pane Apps properties dialog proof.
 *
 * Renders AppsPropertiesDialog under jsdom and asserts the left rail carries the
 * App name plus one nav item per section, and that switching sections swaps the
 * right pane between the developer rows and the run rows.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

test('Apps properties dialog renders the section rail and swaps the right pane per section', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent, Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { AppsPropertiesDialog } = await import('../src/shell/renderer/features/apps/apps-properties-dialog.js');
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => {
      root.render(
        <AppsPropertiesDialog
          open
          appName="Nimi Lab"
          onClose={() => {}}
          sections={[
            {
              id: 'developer',
              label: 'Developer information',
              description: 'Exact local source and generation details.',
              rows: [
                { label: 'App', value: 'nimi.lab', mono: true },
                { label: 'Project root', value: '/projects/nimi-lab', mono: true },
              ],
            },
            {
              id: 'run',
              label: 'Run status',
              rows: [{ label: 'Run state', value: 'Running' }],
            },
          ]}
        />,
      );
    });
    const { document } = dom.window;
    const dialog = document.querySelector('[data-testid="apps-detail-properties-dialog"]');
    assert.ok(dialog, 'expected the properties dialog panel');
    const nav = dialog.querySelector('nav');
    assert.ok(nav, 'expected the section rail');
    assert.match(nav.textContent ?? '', /Nimi Lab/u);
    const developerNav = nav.querySelector('[data-testid="apps-properties-nav:developer"]');
    const runNav = nav.querySelector('[data-testid="apps-properties-nav:run"]');
    assert.ok(developerNav && runNav, 'expected one nav item per section');
    assert.equal(developerNav.getAttribute('aria-current'), 'true');
    assert.equal(runNav.getAttribute('aria-current'), null);
    assert.match(dialog.textContent ?? '', /\/projects\/nimi-lab/u);
    assert.equal(dialog.textContent?.includes('Running'), false, 'run rows stay hidden until their section is active');
    await act(async () => {
      runNav.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    assert.equal(runNav.getAttribute('aria-current'), 'true');
    assert.equal(developerNav.getAttribute('aria-current'), null);
    assert.match(dialog.textContent ?? '', /Running/u);
    assert.equal(dialog.textContent?.includes('/projects/nimi-lab'), false, 'developer rows leave once the run section is active');
  } finally {
    await act(async () => { root.unmount(); });
    // Radix restores focus on the next task after unmount.
    await new Promise((resolve) => setTimeout(resolve, 0));
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
