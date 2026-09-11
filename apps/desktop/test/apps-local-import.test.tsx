import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { ReasonCode, type LocalAppPackagePreview } from '@nimiplatform/sdk/runtime/wire-types';
import type { NimiDesktopMachineProductRuntimeClient } from '@nimiplatform/sdk/runtime';

// DOM and hook behavior with simulated RPC outcomes; native package lifecycle
// is covered by Runtime tests, not by these renderer fixtures.
test('local import releases invalid previews and keeps confirmation failures inside the dialog', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent, Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true,
    __NIMI_ELECTRON_TEST__: { invoke: async (command: string) => {
      assert.equal(command, 'nimi.shell.fileDialog.open');
      return { canceled: false, paths: ['/tmp/example.nimiapp'] };
    } },
  };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.ts');
  const { useAppsLocalImport, AppsLocalImportFeedback } = await import('../src/shell/renderer/features/apps/apps-local-import.js');
  await initI18n();
  await changeLocale('en');
  const selector = new TextEncoder().encode('a'.repeat(48));
  const valid = { candidateSelector: selector, appId: 'example.app', displayName: 'Example', version: '1.0.0', os: 'macos', arch: 'arm64', appAccess: [], macosNotarization: 'absent' } as LocalAppPackagePreview;
  let preview = valid;
  const discarded: Uint8Array[] = [];
  const getClient = () => ({
    prepareLocalAppPackage: async () => ({ reasonCode: ReasonCode.ACTION_EXECUTED, preview }),
    discardLocalAppPackage: async (input: { candidateSelector: Uint8Array }) => { discarded.push(input.candidateSelector); return { reasonCode: ReasonCode.ACTION_EXECUTED }; },
    startLocalAppPackageInstall: async () => { throw new Error('installation-blocked-test'); },
  }) as unknown as NimiDesktopMachineProductRuntimeClient['apps'];
  let state!: ReturnType<typeof useAppsLocalImport>;
  const started = () => { throw new Error('failed install must not announce a started job'); };
  function Harness() { state = useAppsLocalImport(getClient, started); return <AppsLocalImportFeedback state={state} />; }
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => { root.render(<Harness />); });
    for (const invalid of [{ ...valid, appId: '' }, { ...valid, version: '1.2' }]) {
      preview = invalid;
      await act(async () => { await state.choose(); });
      assert.equal(state.phase, 'idle');
      assert.equal(state.intent, null);
      assert.ok(state.error);
      assert.deepEqual(discarded.at(-1), selector, state.error ?? undefined);
    }
    assert.equal(discarded.length, 2);
    preview = valid;
    await act(async () => { await state.choose(); });
    assert.equal(state.phase, 'confirming');
    await act(async () => { await state.confirm(); });
    const dialog = dom.window.document.querySelector('[role="dialog"]');
    assert.ok(dialog);
    assert.match(dialog.querySelector('[role="alert"]')?.textContent ?? '', /installation-blocked-test/u);
    assert.equal(dom.window.document.querySelectorAll('[role="alert"]').length, 1);
    await act(async () => { state.cancel(); });
    assert.equal(discarded.length, 3);
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
