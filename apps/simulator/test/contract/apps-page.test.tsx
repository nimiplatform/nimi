import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { AppsPage } from '../../src/shell/chrome/apps-page.tsx';
import {
  ShellActionsProvider,
  type ShellActions,
} from '../../src/shell/chrome/shell-actions.tsx';
import {
  UiProvider,
  useUi,
  type UiState,
} from '../../src/shell/chrome/ui-context.tsx';

test('Apps page focuses the latest live window and opens only a standby App', async () => {
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

  const oldDesktopId = '1:instance:desktop-old';
  const latestDesktopId = '1:instance:desktop-latest';
  const openCalls: [moduleId: string, surfaceId: string][] = [];
  const actions: ShellActions = {
    epoch: 1,
    phase: 'open',
    route: { kind: 'home' },
    moduleCount: 2,
    modules: [
      { moduleId: 'desktop', surfaces: [{ id: 'main', label: 'Nimi Desktop' }] },
      { moduleId: 'tester', surfaces: [{ id: 'main', label: 'Nimi Lab' }] },
    ],
    instances: [
      {
        instanceId: oldDesktopId,
        moduleId: 'desktop',
        surfaceId: 'main',
        status: 'active',
        readiness: 'usable',
        route: { pathname: '/', search: [], fragment: null },
      },
      {
        instanceId: latestDesktopId,
        moduleId: 'desktop',
        surfaceId: 'main',
        status: 'inactive',
        readiness: 'usable',
        route: { pathname: '/', search: [], fragment: null },
      },
      {
        instanceId: '1:instance:desktop-disposed',
        moduleId: 'desktop',
        surfaceId: 'main',
        status: 'disposed',
        readiness: 'cancelled',
        route: { pathname: '/', search: [], fragment: null },
      },
    ],
    open: (moduleId, surfaceId) => {
      openCalls.push([moduleId, surfaceId]);
    },
    close: () => {},
    activate: () => {},
    deactivate: () => {},
    navigate: () => {},
    reset: () => {},
  };

  let currentUi: UiState | null = null;
  function Probe() {
    currentUi = useUi();
    return null;
  }

  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(
      <UiProvider>
        <ShellActionsProvider value={actions}>
          <AppsPage />
          <Probe />
        </ShellActionsProvider>
      </UiProvider>,
    ));
    assert.ok(currentUi);

    await act(async () => {
      currentUi?.syncWindows([
        { instanceId: oldDesktopId, moduleId: 'desktop' },
        { instanceId: latestDesktopId, moduleId: 'desktop' },
      ]);
      currentUi?.restoreWindow(oldDesktopId);
      currentUi?.setAppsPageOpen(true);
    });
    assert.ok(currentUi);
    assert.equal(currentUi.windows[oldDesktopId]?.minimized, false);
    assert.equal(currentUi.windows[latestDesktopId]?.minimized, true);
    assert.ok(currentUi.windows[oldDesktopId].z > currentUi.windows[latestDesktopId].z);

    const runningCard = container.querySelector<HTMLButtonElement>(
      'button[aria-label="desktop · 聚焦运行中的应用"]',
    );
    assert.ok(runningCard);
    await act(async () => runningCard.click());

    assert.deepEqual(openCalls, [], 'a running App must not allocate another instance');
    assert.ok(currentUi);
    assert.equal(currentUi.windows[latestDesktopId]?.minimized, false);
    assert.ok(currentUi.windows[latestDesktopId].z > currentUi.windows[oldDesktopId].z);
    assert.ok(currentUi.surfaceLayerZ > currentUi.homeDepthLayerZ);
    assert.equal(currentUi.appsPageOpen, false);

    await act(async () => currentUi?.setAppsPageOpen(true));
    const standbyCard = container.querySelector<HTMLButtonElement>(
      'button[aria-label="tester · 打开应用"]',
    );
    assert.ok(standbyCard);
    await act(async () => standbyCard.click());

    assert.deepEqual(openCalls, [['tester', 'main']]);
    assert.equal(currentUi?.appsPageOpen, false);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
