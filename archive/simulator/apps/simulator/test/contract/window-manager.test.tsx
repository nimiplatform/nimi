import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import {
  installWindowFocusCapture,
  projectSurfaceLayer,
  projectSurfaceDepths,
  resizeWindowBounds,
  surfaceWindowLayerZIndex,
} from '../../src/shell/chrome/window-manager.tsx';
import { UiProvider, useUi, type UiState } from '../../src/shell/chrome/ui-context.tsx';

const INITIAL = Object.freeze({ x: 240, y: 160, w: 480, h: 360 });
const VIEWPORT = Object.freeze({ width: 1440, height: 1000 });
const windowManagerSource = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/shell/chrome/window-manager.tsx'),
  'utf8',
);
const fieldStyles = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/shell/styles/field.css'),
  'utf8',
);

test('window chrome does not render internal instance identifiers', () => {
  assert.doesNotMatch(windowManagerSource, /window-iid/u);
});

test('App surfaces project their z order onto the shared front-to-back depth stack', () => {
  const windows = {
    desktop: { x: 100, y: 80, w: 900, h: 700, z: 11, minimized: false },
    lab: { x: 100, y: 80, w: 900, h: 700, z: 12, minimized: false },
    zhiyu: { x: 100, y: 80, w: 900, h: 700, z: 13, minimized: false },
  };

  assert.deepEqual(
    projectSurfaceDepths(
      [{ instanceId: 'desktop' }, { instanceId: 'lab' }, { instanceId: 'zhiyu' }],
      windows,
    ),
    [
      { instanceId: 'zhiyu', depth: 0, state: 'focus' },
      { instanceId: 'lab', depth: 1, state: 'depth-1' },
      { instanceId: 'desktop', depth: 2, state: 'depth-2' },
    ],
  );

  assert.deepEqual(
    projectSurfaceDepths(
      [{ instanceId: 'desktop' }, { instanceId: 'lab' }, { instanceId: 'zhiyu' }],
      { ...windows, lab: { ...windows.lab, minimized: true } },
    ),
    [
      { instanceId: 'zhiyu', depth: 0, state: 'focus' },
      { instanceId: 'desktop', depth: 1, state: 'depth-1' },
    ],
  );

  assert.deepEqual(
    projectSurfaceDepths(
      [{ instanceId: 'desktop' }, { instanceId: 'lab' }, { instanceId: 'zhiyu' }],
      {
        desktop: { ...windows.desktop, minimized: true },
        lab: { ...windows.lab, minimized: true },
        zhiyu: { ...windows.zhiyu, minimized: true },
      },
    ),
    [],
    'closed windows remain outside the visible depth projection',
  );
});

test('surface window layer crosses the depth workspace only after App focus', () => {
  assert.equal(surfaceWindowLayerZIndex(13), 40);
  assert.equal(surfaceWindowLayerZIndex(46), 46);
});

test('only an explicit App focus or full-window route raises App pages', () => {
  assert.deepEqual(projectSurfaceLayer({
    fullWindow: false,
    surfaceLayerZ: 40,
    homeDepthLayerZ: 45,
  }), {
    foreground: false,
    zIndex: 40,
  });
  assert.deepEqual(projectSurfaceLayer({
    fullWindow: false,
    surfaceLayerZ: 46,
    homeDepthLayerZ: 45,
  }), {
    foreground: true,
    zIndex: 46,
  });
  assert.match(fieldStyles, /\.field\s*\{[^}]*z-index:\s*41;/su);
});

test('last interaction alternates foreground between App surfaces and home depth pages', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1/',
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  let currentUi: UiState | null = null;
  function Harness() {
    currentUi = useUi();
    return null;
  }

  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  await act(async () => root.render(<UiProvider><Harness /></UiProvider>));
  assert.ok(currentUi);
  assert.ok(currentUi.homeDepthLayerZ > currentUi.surfaceLayerZ);

  await act(async () => {
    currentUi?.syncWindows([{ instanceId: '1:instance:desktop', moduleId: 'desktop' }]);
  });
  assert.equal(
    currentUi?.windows['1:instance:desktop']?.minimized,
    true,
    'background Scenario instances must not default to an open App window',
  );
  await act(async () => {
    currentUi?.focusWindow('1:instance:desktop');
  });
  assert.ok(currentUi);
  assert.ok(currentUi.surfaceLayerZ > currentUi.homeDepthLayerZ);

  // Selecting the already-active Modules page must still bring its layer back
  // above Desktop/Lab/Zhiyu windows.
  await act(async () => {
    currentUi?.setHomeDepthWindow('modules');
  });
  assert.ok(currentUi);
  assert.ok(currentUi.homeDepthLayerZ > currentUi.surfaceLayerZ);

  await act(async () => {
    currentUi?.focusWindow('1:instance:desktop');
  });
  assert.ok(currentUi);
  assert.ok(currentUi.surfaceLayerZ > currentUi.homeDepthLayerZ);

  await act(async () => root.unmount());
  dom.window.close();
});

test('presenting a newly launched App creates its window and raises the surface layer', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1/',
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  let currentUi: UiState | null = null;
  function Harness() {
    currentUi = useUi();
    return null;
  }

  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  await act(async () => root.render(<UiProvider><Harness /></UiProvider>));
  assert.ok(currentUi);
  assert.ok(currentUi.homeDepthLayerZ > currentUi.surfaceLayerZ);

  await act(async () => {
    currentUi?.presentWindow('1:instance:desktop', 'desktop');
  });
  assert.ok(currentUi);
  assert.ok(currentUi.windows['1:instance:desktop']);
  assert.ok(currentUi.surfaceLayerZ > currentUi.homeDepthLayerZ);

  await act(async () => {
    currentUi?.minimizeWindow('1:instance:desktop');
  });
  assert.equal(currentUi?.windows['1:instance:desktop']?.minimized, true);

  await act(async () => {
    currentUi?.presentWindow('1:instance:desktop', 'desktop');
  });
  assert.equal(currentUi?.windows['1:instance:desktop']?.minimized, false);
  assert.ok(currentUi);
  assert.ok(currentUi.surfaceLayerZ > currentUi.homeDepthLayerZ);

  await act(async () => root.unmount());
  dom.window.close();
});

test('window resize geometry follows every edge and corner', () => {
  assert.deepEqual(
    resizeWindowBounds(INITIAL, 'e', { x: 80, y: 0 }, VIEWPORT),
    { x: 240, y: 160, w: 560, h: 360 },
  );
  assert.deepEqual(
    resizeWindowBounds(INITIAL, 's', { x: 0, y: 60 }, VIEWPORT),
    { x: 240, y: 160, w: 480, h: 420 },
  );
  assert.deepEqual(
    resizeWindowBounds(INITIAL, 'w', { x: -40, y: 0 }, VIEWPORT),
    { x: 200, y: 160, w: 520, h: 360 },
  );
  assert.deepEqual(
    resizeWindowBounds(INITIAL, 'n', { x: 0, y: -30 }, VIEWPORT),
    { x: 240, y: 130, w: 480, h: 390 },
  );
  assert.deepEqual(
    resizeWindowBounds(INITIAL, 'ne', { x: 70, y: -20 }, VIEWPORT),
    { x: 240, y: 140, w: 550, h: 380 },
  );
  assert.deepEqual(
    resizeWindowBounds(INITIAL, 'se', { x: 70, y: 50 }, VIEWPORT),
    { x: 240, y: 160, w: 550, h: 410 },
  );
  assert.deepEqual(
    resizeWindowBounds(INITIAL, 'sw', { x: -30, y: 50 }, VIEWPORT),
    { x: 210, y: 160, w: 510, h: 410 },
  );
  assert.deepEqual(
    resizeWindowBounds(INITIAL, 'nw', { x: -30, y: -20 }, VIEWPORT),
    { x: 210, y: 140, w: 510, h: 380 },
  );
});

test('window resize geometry keeps a usable minimum and visible viewport bounds', () => {
  assert.deepEqual(
    resizeWindowBounds(INITIAL, 'nw', { x: 1000, y: 1000 }, VIEWPORT),
    { x: 560, y: 400, w: 160, h: 120 },
  );
  assert.deepEqual(
    resizeWindowBounds(INITIAL, 'se', { x: 2000, y: 2000 }, VIEWPORT),
    { x: 240, y: 160, w: 1192, h: 832 },
  );
});

test('window focus capture raises the stage even when App content stops bubbling', () => {
  const dom = new JSDOM('<!doctype html><section><button>App action</button></section>');
  const stage = dom.window.document.querySelector<HTMLElement>('section');
  const appAction = dom.window.document.querySelector<HTMLButtonElement>('button');
  assert.ok(stage);
  assert.ok(appAction);

  const focused: string[] = [];
  const removeFocusCapture = installWindowFocusCapture(
    stage,
    '1:instance:desktop',
    (instanceId) => focused.push(instanceId),
  );
  appAction.addEventListener('pointerdown', (event) => event.stopPropagation());

  appAction.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
  assert.deepEqual(focused, ['1:instance:desktop']);

  removeFocusCapture();
  appAction.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
  assert.deepEqual(focused, ['1:instance:desktop']);
  dom.window.close();
});
