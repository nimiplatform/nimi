import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

import { Field } from '../../src/shell/chrome/field.tsx';
import { SkyPanel } from '../../src/shell/chrome/sky-panel.tsx';
import {
  UiProvider,
  useUi,
} from '../../src/shell/chrome/ui-context.tsx';

function installBrowserGlobals(
  dom: JSDOM,
  {
    reducedMotion,
    webdriver,
  }: {
    readonly reducedMotion: boolean;
    readonly webdriver: boolean;
  },
) {
  const mediaQuery = {
    matches: reducedMotion,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  };
  Object.defineProperty(dom.window, 'matchMedia', {
    configurable: true,
    value: () => mediaQuery,
  });
  Object.defineProperty(dom.window.navigator, 'webdriver', {
    configurable: true,
    value: webdriver,
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
}

function StateProbe() {
  const ui = useUi();
  return (
    <>
      <button
        type="button"
        onClick={() => ui.setSkyPanelOpen(true)}
      >
        打开光影面板
      </button>
      <output
        data-testid="sky-state"
        data-auto={ui.autoSceneTime}
        data-intensity={ui.intensity}
        data-motion={ui.motion}
        data-phase={ui.effectivePhase}
        data-scene-time={ui.sceneTime}
      />
      <SkyPanel />
    </>
  );
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === text);
  assert.ok(button, `missing button: ${text}`);
  return button;
}

test('webdriver does not suppress the capability-driven living sky', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://127.0.0.1/',
  });
  installBrowserGlobals(dom, {
    reducedMotion: false,
    webdriver: true,
  });
  try {
    const markup = renderToStaticMarkup(
      <UiProvider>
        <Field phase="night" />
      </UiProvider>,
    );
    assert.match(markup, /class="field field--gl"/u);
    assert.match(markup, /data-testid="lunar-sky-canvas"/u);
  } finally {
    dom.window.close();
  }
});

test('sky controls expose four manual phases and one playback action', async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'http://127.0.0.1/' },
  );
  installBrowserGlobals(dom, {
    reducedMotion: false,
    webdriver: false,
  });
  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(
      <UiProvider>
        <StateProbe />
      </UiProvider>,
    ));
    await act(async () => buttonByText(container, '打开光影面板').click());

    const group = container.querySelector<HTMLElement>(
      '[role="group"][aria-label="月昼快捷态"]',
    );
    assert.ok(group);
    assert.deepEqual(
      [...group.querySelectorAll('button')].map((button) => button.textContent?.trim()),
      ['月晨', '月昼', '月暮', '月夜'],
    );
    assert.equal(buttonByText(container, '暂停演进').disabled, false);
    assert.equal(container.querySelectorAll('button.sky-panel-auto').length, 5);

    await act(async () => buttonByText(container, '月晨').click());
    const state = container.querySelector<HTMLOutputElement>(
      '[data-testid="sky-state"]',
    );
    assert.ok(state);
    assert.equal(state.dataset.auto, 'false');
    assert.equal(state.dataset.phase, 'dawn');
    assert.equal(state.dataset.sceneTime, '0.25');
    assert.ok(buttonByText(container, '月晨').getAttribute('aria-pressed') === 'true');
    assert.equal(buttonByText(container, '继续演进').disabled, false);

    await act(async () => buttonByText(container, '继续演进').click());
    assert.equal(state.dataset.auto, 'true');
    assert.equal(state.dataset.motion, '1');
    assert.equal(buttonByText(container, '暂停演进').disabled, false);

    await act(async () => buttonByText(container, '暂停演进').click());
    assert.equal(state.dataset.auto, 'false');
    assert.equal(state.dataset.motion, '0');
    assert.equal(buttonByText(container, '继续演进').disabled, false);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('reduced motion reports a paused scene while manual controls remain available', async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'http://127.0.0.1/' },
  );
  installBrowserGlobals(dom, {
    reducedMotion: true,
    webdriver: false,
  });
  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(
      <UiProvider>
        <StateProbe />
      </UiProvider>,
    ));
    await act(async () => buttonByText(container, '打开光影面板').click());

    const playback = buttonByText(container, '系统减少动态已开启');
    assert.equal(playback.disabled, true);
    const panel = container.querySelector<HTMLElement>('#sky-control-panel');
    assert.ok(panel);
    assert.match(panel.textContent ?? '', /系统减少动态 · 已暂停/u);
    assert.doesNotMatch(panel.textContent ?? '', /演进中/u);

    await act(async () => buttonByText(container, '月昼').click());
    const state = container.querySelector<HTMLOutputElement>(
      '[data-testid="sky-state"]',
    );
    assert.ok(state);
    assert.equal(state.dataset.auto, 'false');
    assert.equal(state.dataset.phase, 'day');
    assert.equal(state.dataset.sceneTime, '0.5');

    const intensity = container.querySelector<HTMLInputElement>(
      'input[aria-label="光照强度"]',
    );
    const progress = container.querySelector<HTMLInputElement>(
      'input[aria-label="月昼进度"]',
    );
    assert.ok(intensity);
    assert.ok(progress);
    assert.equal(intensity.disabled, false);
    assert.equal(progress.disabled, false);
    assert.equal(buttonByText(container, '系统减少动态已开启').disabled, true);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
