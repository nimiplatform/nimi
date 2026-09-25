/**
 * Apps detail overflow menu under a live DOM.
 *
 * While a local-development build or start is in progress the detail header
 * shows 启动中 instead of 停止, so the overflow menu must keep stopping
 * reachable. Kit overlays portal through Radix, whose layout effect binds at
 * import time, so jsdom globals are installed before the view is imported.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { DesktopAppsEntry } from '../src/shell/renderer/features/apps/apps-panel-projection';
import type { AppsPanelViewProps } from '../src/shell/renderer/features/apps/apps-panel-view';

function buildingEntry(): DesktopAppsEntry {
  const selector = 'dev-project-example';
  return {
    identity: {
      entryKey: `local_development:nimi.lab:${selector}`,
      appId: 'nimi.lab',
      sourceClass: 'local_development',
      displayName: 'Nimi Lab',
      updatedAtUnixMs: 1_722_000_000_000,
    },
    catalogTarget: null,
    localDevelopment: {
      selector,
      appId: 'nimi.lab',
      displayName: 'Nimi Lab',
      canonicalProjectRoot: '/projects/nimi-lab',
      shell: 'electron',
      appAccess: [],
      aiConfigAllowedRoutes: ['local', 'cloud'],
      capabilityContractRefs: [],
      sourceGeneration: 1,
      declarationGeneration: 1,
      registeredAtUnixMs: 1_721_000_000_000,
      updatedAtUnixMs: 1_722_000_000_000,
    },
    committedRelease: null,
    packageJob: null,
    run: {
      selector,
      appId: 'nimi.lab',
      displayName: 'Nimi Lab',
      canonicalProjectRoot: '/projects/nimi-lab',
      shell: 'electron',
      state: 'building',
      message: '',
      retryable: false,
      hostGeneration: 1,
    },
    aiConfigSummary: null,
    iconUrl: null,
    summary: null,
  };
}

test('a local-development build keeps 停止 in the detail overflow menu', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
  const values: Record<string, unknown> = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    ResizeObserver: (globalThis as { ResizeObserver?: unknown }).ResizeObserver ?? ResizeObserverStub,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const name of Object.getOwnPropertyNames(dom.window)) {
    if (/^(?:HTML|SVG)\w*Element$|Event$/u.test(name) && !(name in values)) {
      values[name] = (dom.window as unknown as Record<string, unknown>)[name];
    }
  }
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

  const { createRoot } = await import('react-dom/client');
  const { TooltipProvider } = await import('@nimiplatform/kit/ui');
  const { changeLocale, initI18n } = await import('../src/shell/renderer/i18n');
  const { AppsPanelView } = await import('../src/shell/renderer/features/apps/apps-panel-view');
  await initI18n();
  await changeLocale('zh');

  const entry = buildingEntry();
  const actions: string[] = [];
  const props: AppsPanelViewProps = {
    projection: { status: 'loaded', entries: [entry], catalogStatus: 'not-implemented', runtimeError: null },
    searchQuery: '',
    onSearchChange: () => {},
    selectedEntryKey: entry.identity.entryKey,
    requestedDetailSection: null,
    requestedDetailNavigationRevision: 0,
    onCardAction: (entryKey, action) => actions.push(`${entryKey}:${action}`),
    onBack: () => {},
    onOpenDeveloperMode: () => {},
    onImportLocal: () => {},
    onRetry: () => {},
    onAIConfigChanged: () => {},
    actionError: null,
    pendingActions: [],
    installConfirmation: null,
    onConfirmInstall: () => undefined,
    onCancelInstall: () => undefined,
  };
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => root.render(<TooltipProvider><AppsPanelView {...props} /></TooltipProvider>));
    const document = dom.window.document;
    assert.ok(document.querySelector('[data-testid="apps-detail-starting"]'), 'header shows 启动中');
    const trigger = document.querySelector<HTMLElement>('[data-testid="apps-detail-more"]');
    assert.ok(trigger, 'expected the detail overflow trigger');
    await act(async () => trigger.click());
    const stop = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent?.includes('停止'));
    assert.ok(stop, 'the overflow menu offers 停止 while the header shows 启动中');
    await act(async () => stop.click());
    assert.deepEqual(actions, [`${entry.identity.entryKey}:stop`]);
  } finally {
    await act(async () => root.unmount());
    // Radix focus scopes dispatch their unmount events on a timer; let them
    // land on jsdom before the Node globals come back.
    await new Promise((resolve) => setTimeout(resolve, 50));
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
