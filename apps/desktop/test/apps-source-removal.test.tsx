import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import type { LocalDevelopmentRegistration } from '../src/shell/renderer/features/local-development/local-development-types.js';
import type { DesktopAppsEntry } from '../src/shell/renderer/features/apps/apps-panel-projection.js';
(globalThis as { React?: typeof React }).React = React;
function registration(
  overrides: Partial<LocalDevelopmentRegistration> = {},
): LocalDevelopmentRegistration {
  return {
    selector: 'dev-project-example',
    appId: 'nimi.lab',
    displayName: 'Nimi Lab',
    canonicalProjectRoot: '/projects/nimi-lab',
    shell: 'electron',
    appAccess: ['realm.data', 'runtime.consume'],
    aiConfigAllowedRoutes: ['local', 'cloud'],
    capabilityContractRefs: [],
    sourceGeneration: 1,
    declarationGeneration: 2,
    registeredAtUnixMs: 1_721_000_000_000,
    updatedAtUnixMs: 1_722_000_000_000,
    ...overrides,
  };
}

function entry(
  overrides: Partial<LocalDevelopmentRegistration> = {},
  runState: string | null = null,
): DesktopAppsEntry {
  const row = registration(overrides);
  const entryKey = `local_development:${row.appId}:${row.selector}`;
  return {
    identity: {
      entryKey,
      appId: row.appId,
      sourceClass: 'local_development',
      displayName: row.displayName,
      updatedAtUnixMs: row.updatedAtUnixMs,
    },
    catalogTarget: null,
    localDevelopment: row,
    committedRelease: null,
    packageJob: null,
    run: runState === null
      ? null
      : {
        selector: row.selector,
        appId: row.appId,
        displayName: row.displayName,
        canonicalProjectRoot: row.canonicalProjectRoot,
        shell: row.shell,
        state: runState,
        message: '',
        retryable: false,
        hostGeneration: 1,
      },
    aiConfigSummary: null,
    iconUrl: null,
    summary: null,
  };
}

test('source removal confirms the exact sibling without changing the open source', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, Element: dom.window.Element,
    Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent, Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { TooltipProvider } = await import('@nimiplatform/kit/ui');
  const { AppsDetailView } = await import('../src/shell/renderer/features/apps/apps-detail-view.js');
  const { changeLocale, initI18n } = await import('../src/shell/renderer/i18n/index.js');
  await initI18n(); await changeLocale('zh');
  const first = entry();
  const second = entry({ selector: 'dev-project-second' });
  const installed = entry({ selector: 'dev-project-current' });
  const calls: string[] = [];
  const props = {
    entry: installed, sourceEntries: [first, second], requestedSection: null,
    requestedNavigationRevision: 0, onBack() {}, onOpenEntry(key: string) { calls.push(key+':details'); },
    onAction(action: string) { calls.push(installed.identity.entryKey+':'+action); },
    onRemoveSource(key: string) { calls.push(key+':remove'); },
    activeAction: null, actionsDisabled: false, actionError: null, onAIConfigChanged() {},
  };
  const root = createRoot(dom.window.document.getElementById('root')!);
  const button = () => dom.window.document.querySelector<HTMLButtonElement>(`[data-testid="apps-remove-source-${second.identity.entryKey}"]`)!;
  try {
    await act(async () => root.render(<TooltipProvider><AppsDetailView {...props} /></TooltipProvider>));
    await act(async () => button().click());
    assert.deepEqual(calls, []);
    const dialog = () => dom.window.document.querySelector('[role="alertdialog"], [role="dialog"]')!;
    assert.match(dialog().textContent ?? '', /不会删除项目文件/);
    await act(async () => [...dialog().querySelectorAll('button')].find(b => b.textContent === '取消')!.click());
    assert.deepEqual(calls, []);
    await act(async () => button().click());
    await act(async () => [...dialog().querySelectorAll('button')].find(b => b.textContent === '移除注册')!.click());
    assert.deepEqual(calls, [`${second.identity.entryKey}:remove`]);
    await act(async () => root.render(<TooltipProvider><AppsDetailView {...props} actionsDisabled /></TooltipProvider>));
    assert.equal(button().disabled, true);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
