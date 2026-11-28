import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useEffect } from 'react';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import messages from '../src/shell/renderer/locales/en/67-ProductUpdate.json';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import type { ProductUpdateStatus } from '../src/shell/shared/product-update.js';

test('Home update UI preserves consent and recovery, and acknowledges current and completed results with OK', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), React, IS_REACT_ACT_ENVIRONMENT: true };
  const original = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let status: ProductUpdateStatus = { phase: 'prepared', currentVersion: '0.2.0', channel: 'beta', target: 'macos-arm64', candidateVersion: '0.3.0',
    releaseId: 'nimi/v0.3.0', downloadedBytes: 1, totalBytes: 1, checkedAt: null, reason: null, installationAvailable: false,
    checkAvailable: true, recoveryAction: 'none', recoveryError: null };
  const installs: string[] = [];
  const cleanups: string[][] = [];
  let reopens = 0;
  const port = { status: async () => status, check: async () => status, cancel: async () => status, homeReady: async () => status,
    reopenCurrentVersion: async () => { reopens++; status = { ...status, recoveryError: 'UPDATE_REOPEN_BLOCKED' }; return status; },
    install: async (id: string) => { installs.push(id); return status; },
    previewRetention: async () => ({ currentVersion: '0.4.0', runtimeVersion: '0.4.0', entries: [
      { version: '0.1.0', path: 'C:/Program Files/Nimi/Product/0.1.0', identitySha256: 'a'.repeat(64), directoryId: 'volume:file', logicalBytes: 1024, eligible: true, complete: true, reason: 'obsolete' },
      { version: '0.3.0', path: 'C:/Program Files/Nimi/Product/0.3.0', identitySha256: 'b'.repeat(64), directoryId: 'volume:other', logicalBytes: 2048, eligible: false, complete: true, reason: 'retained-code-version' },
    ] }),
    cleanupRetention: async (versions: string[]) => { cleanups.push(versions); return { results: [{ version: '0.1.0', removed: false, deletedBytes: 0, reason: 'UPDATE_RETENTION_IN_USE_OR_LOCKED' }] }; },
  };
  const bindings = { app: { commands: { productUpdate: port } } } as DesktopCanonicalRendererBindings;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['nimi-product-update'], status);
  const i18n = createInstance(); await i18n.init({ lng: 'en', resources: { en: { translation: { ProductUpdate: messages } } } });
  const { createRoot } = await import('react-dom/client');
  const { ProductUpdateNotice } = await import('../src/shell/renderer/features/home/product-update-notice.js');
  const { ProductUpdateProvider, useProductUpdate } = await import('../src/shell/renderer/features/home/product-update-context.js');
  const { TooltipProvider } = await import('@nimiplatform/kit/ui');
  function UpdateControls() {
    const update = useProductUpdate();
    useEffect(update.homeReady, [update.homeReady]);
    return <><button disabled={!update.checkAvailable} onClick={() => { void update.check(); }}>Check from Help</button><ProductUpdateNotice /></>;
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  const button = (text: string, dialog = false) => {
    const found = [...dom.window.document.querySelectorAll<HTMLButtonElement>(dialog ? '[role="dialog"] button' : 'button')].find((item) => item.textContent === text || item.getAttribute('aria-label') === text);
    assert.ok(found, `button missing: ${text}`); return found;
  };
  try {
    await act(async () => root.render(<I18nextProvider i18n={i18n}><QueryClientProvider client={client}><DesktopRendererBindingProvider bindings={bindings}><TooltipProvider><ProductUpdateProvider><UpdateControls /></ProductUpdateProvider></TooltipProvider></DesktopRendererBindingProvider></QueryClientProvider></I18nextProvider>));
    assert.ok(![...dom.window.document.querySelectorAll('button')].some((item) => item.textContent === messages.restart));
    await act(async () => button(messages.update).click());
    assert.match(dom.window.document.body.textContent ?? '', /Installation is not available/);
    await act(async () => button('OK', true).click());
    status = { ...status, installationAvailable: true };
    await act(async () => { client.setQueryData(['nimi-product-update'], status); await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => button(messages.update).click());
    assert.match(dom.window.document.body.textContent ?? '', /Running apps and tasks will stop/); assert.deepEqual(installs, []);
    await act(async () => button(messages.later, true).click()); assert.deepEqual(installs, []);
    await act(async () => button(messages.update).click());
    status = { ...status, releaseId: 'nimi/v0.4.0', candidateVersion: '0.4.0' };
    await act(async () => { client.setQueryData(['nimi-product-update'], status); await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => button(messages.restart, true).click()); assert.deepEqual(installs, []);
    await act(async () => button(messages.update).click());
    await act(async () => button(messages.restart, true).click()); assert.deepEqual(installs, ['nimi/v0.4.0']);
    status = { ...status, phase: 'failed', reason: 'UPDATE_HANDOFF_FAILED', installationAvailable: false,
      checkAvailable: false, recoveryAction: 'reopen-current' };
    await act(async () => { client.setQueryData(['nimi-product-update'], status); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.ok(![...dom.window.document.querySelectorAll('button')].some((item) => item.textContent === messages.check));
    await act(async () => button(messages.update).click());
    await act(async () => { button(messages.reopen).click(); await new Promise((resolve) => setTimeout(resolve, 0)); }); assert.equal(reopens, 1);
    const alertDeadline = Date.now() + 1_000;
    while (!(dom.window.document.body.textContent ?? '').includes('could not stop safely') && Date.now() < alertDeadline) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
    assert.match(dom.window.document.body.textContent ?? '', /could not stop safely/);
    assert.match(dom.window.document.body.textContent ?? '', /installer handoff failed/);
    await act(async () => button('OK', true).click());
    status = { ...status, phase: 'current', reason: null, checkAvailable: true, recoveryAction: 'none', recoveryError: null };
    await act(async () => { client.setQueryData(['nimi-product-update'], status); await new Promise((resolve) => setTimeout(resolve, 10)); });
    assert.equal(dom.window.document.querySelector('[data-testid="nimi-product-update"]'), null);
    await act(async () => button('Check from Help').click());
    assert.match(dom.window.document.body.textContent ?? '', /You’re up to date/);
    assert.equal(dom.window.document.querySelector('[data-testid="product-update-dialog"]')?.querySelectorAll('button').length, 1);
    await act(async () => button('OK', true).click());
    status = { ...status, phase: 'awaiting-activation', checkAvailable: false };
    await act(async () => { client.setQueryData(['nimi-product-update'], status); await new Promise((resolve) => setTimeout(resolve, 10)); });
    assert.ok(!(dom.window.document.body.textContent ?? '').includes(messages.completedTitle));
    status = { ...status, phase: 'completed', currentVersion: '0.4.0', checkAvailable: true };
    await act(async () => { client.setQueryData(['nimi-product-update'], status); await new Promise((resolve) => setTimeout(resolve, 10)); });
    assert.match(dom.window.document.body.textContent ?? '', /This update has been installed and Nimi is ready to use/);
    assert.equal(dom.window.document.querySelector('[data-testid="nimi-product-update"]'), null);
    await act(async () => button('OK', true).click());
    await act(async () => { client.setQueryData(['nimi-product-update'], { ...status }); await new Promise((resolve) => setTimeout(resolve, 1_000)); });
    assert.equal(dom.window.document.querySelector('[data-testid="product-update-dialog"]'), null);
    status = { ...status, phase: 'current', target: 'windows-amd64', maintenanceAvailable: true };
    await act(async () => { client.setQueryData(['nimi-product-update'], status); await new Promise((resolve) => setTimeout(resolve, 10)); });
    await act(async () => button('Check from Help').click());
    await act(async () => button(messages.retention.open).click());
    assert.match(dom.window.document.body.textContent ?? '', /C:\/Program Files\/Nimi\/Product\/0.1.0/);
    assert.deepEqual(cleanups, []);
    const childDialog = [...dom.window.document.querySelectorAll('[role="dialog"]')].at(-1)!;
    const dismiss = [...childDialog.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === messages.dismiss)!;
    await act(async () => dismiss.click());
    assert.deepEqual(cleanups, []);
    await act(async () => button(messages.retention.open).click());
    await act(async () => button('Delete 1 old versions').click());
    assert.deepEqual(cleanups, [['0.1.0']]);
    assert.match(dom.window.document.body.textContent ?? '', /Retained or partially removed/);
    assert.match(dom.window.document.body.textContent ?? '', /UPDATE_RETENTION_IN_USE_OR_LOCKED/);
  } finally {
    await act(async () => root.unmount()); client.clear(); await new Promise((resolve) => setTimeout(resolve, 0)); dom.window.close();
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

test('Passive UPDATE_UPSTREAM_UNAVAILABLE hides primary rail notice while projecting status in Troubleshooting and Help check dialog', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), React, IS_REACT_ACT_ENVIRONMENT: true };
  const original = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

  let status: ProductUpdateStatus = {
    phase: 'failed',
    currentVersion: '0.2.0',
    channel: 'beta',
    target: 'macos-arm64',
    candidateVersion: null,
    releaseId: null,
    downloadedBytes: 0,
    totalBytes: 0,
    checkedAt: '2026-11-28T04:00:00Z',
    reason: 'UPDATE_UPSTREAM_UNAVAILABLE',
    installationAvailable: false,
    checkAvailable: true,
    recoveryAction: 'none',
    recoveryError: null,
  };
  let checkCalls = 0;
  const port = {
    status: async () => status,
    check: async () => { checkCalls++; return status; },
    cancel: async () => status,
    homeReady: async () => status,
    reopenCurrentVersion: async () => status,
    install: async () => status,
    previewRetention: async () => ({ currentVersion: '0.2.0', runtimeVersion: '0.2.0', entries: [] }),
    cleanupRetention: async () => ({ results: [] }),
  };
  const bindings = {
    app: {
      commands: {
        productUpdate: port,
        supportRepair: {
          loadProductControlRecord: async () => ({ state: 'ready_for_use', record: null, error: null }),
          loadStorageDirs: async () => ({ dataRoot: '/tmp/nimi_data', logsDir: '/tmp/nimi_data/logs' }),
        },
        runtimeDaemon: {
          status: async () => ({ running: true, launchMode: 'SOURCE', grpcAddr: '127.0.0.1:46371', version: '0.2.0', lastError: null }),
        },
        systemResources: {
          load: async () => ({ cpuPercent: 1, memoryUsedBytes: 1, memoryTotalBytes: 2, memoryPressure: 'normal', diskUsedBytes: 1, diskTotalBytes: 2, source: 'test' }),
        },
      },
      projection: { resourceBaseUrl: () => '' },
    },
  } as unknown as DesktopCanonicalRendererBindings;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: { ProductUpdate: messages } } } });
  const { createRoot } = await import('react-dom/client');
  const { ProductUpdateNotice } = await import('../src/shell/renderer/features/home/product-update-notice.js');
  const { ProductUpdateProvider, useProductUpdate } = await import('../src/shell/renderer/features/home/product-update-context.js');
  const { SupportTroubleshooting } = await import('../src/shell/renderer/features/support/support-troubleshooting.js');
  const { TooltipProvider } = await import('@nimiplatform/kit/ui');

  function UpdateHarness() {
    const update = useProductUpdate();
    useEffect(update.homeReady, [update.homeReady]);
    return (
      <>
        <button data-testid="help-check-trigger" disabled={!update.checkAvailable} onClick={() => { void update.check(); }}>
          Check from Help
        </button>
        <ProductUpdateNotice />
        <SupportTroubleshooting />
      </>
    );
  }

  const root = createRoot(dom.window.document.getElementById('root')!);
  const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  const setStatus = async (next: ProductUpdateStatus) => {
    status = next;
    await act(async () => {
      client.setQueryData(['nimi-product-update'], status);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  };
  try {
    await act(async () => root.render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <DesktopRendererBindingProvider bindings={bindings}>
            <TooltipProvider>
              <ProductUpdateProvider>
                <UpdateHarness />
              </ProductUpdateProvider>
            </TooltipProvider>
          </DesktopRendererBindingProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    ));
    await flush();

    // 1. Passive UPDATE_UPSTREAM_UNAVAILABLE is hidden from the primary rail.
    assert.equal(Boolean(dom.window.document.querySelector('[data-testid="nimi-product-update"]')), false);

    // 2. Settings -> Troubleshooting projects version, precise unavailable status, reason code, and Check CTA.
    const card = dom.window.document.querySelector('[data-testid="support-product-update"]');
    assert.ok(card, 'Settings -> Troubleshooting update card must render');
    assert.match(card.textContent ?? '', /Nimi 0\.2\.0/);
    assert.match(card.textContent ?? '', /The update service is unavailable\. Try again later\./);
    assert.match(card.textContent ?? '', /UPDATE_UPSTREAM_UNAVAILABLE/);
    const troubleshootingCheckBtn = card.querySelector<HTMLButtonElement>('[data-testid="support-product-update-check"]');
    assert.ok(troubleshootingCheckBtn && !troubleshootingCheckBtn.disabled);

    // 3. Manual check from Troubleshooting opens the precise status dialog and keeps primary rail hidden.
    await act(async () => troubleshootingCheckBtn.click());
    await flush();
    assert.equal(checkCalls, 1);
    const dialog = dom.window.document.querySelector('[data-testid="product-update-dialog"]');
    assert.ok(dialog, 'Manual check must open feedback dialog');
    assert.match(dialog.textContent ?? '', /The update service is unavailable\. Try again later\./);
    assert.match(dialog.textContent ?? '', /UPDATE_UPSTREAM_UNAVAILABLE/);
    assert.equal(Boolean(dom.window.document.querySelector('[data-testid="nimi-product-update"]')), false);
    const okBtn = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === messages.dismiss);
    assert.ok(okBtn);
    await act(async () => okBtn.click());
    const closeDeadline = Date.now() + 1_000;
    while (dom.window.document.querySelector('[data-testid="product-update-dialog"][data-state="open"]') && Date.now() < closeDeadline) {
      await flush();
    }
    const closedDialog = dom.window.document.querySelector('[data-testid="product-update-dialog"]');
    assert.ok(!closedDialog || closedDialog.getAttribute('data-state') === 'closed', 'dialog must close after OK');

    // 4. Manual check from Help also opens the dialog with UPDATE_UPSTREAM_UNAVAILABLE.
    const helpBtn = dom.window.document.querySelector<HTMLButtonElement>('[data-testid="help-check-trigger"]')!;
    await act(async () => helpBtn.click());
    await flush();
    assert.equal(checkCalls, 2);
    const helpDialog = dom.window.document.querySelector('[data-testid="product-update-dialog"]');
    assert.ok(helpDialog && helpDialog.getAttribute('data-state') !== 'closed');
    assert.match(helpDialog.textContent ?? '', /UPDATE_UPSTREAM_UNAVAILABLE/);
    const okBtn2 = [...helpDialog.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === messages.dismiss)!;
    await act(async () => okBtn2.click());
    await flush();

    // 5. Actionable states remain surfaced on the primary rail.
    await setStatus({ ...status, phase: 'prepared', candidateVersion: '0.3.0', releaseId: 'nimi/v0.3.0', reason: null, installationAvailable: true });
    assert.equal(Boolean(dom.window.document.querySelector('[data-testid="nimi-product-update"]')), true, 'prepared update must show on primary rail');
    assert.equal(dom.window.document.querySelector('[data-testid="support-product-update-action"]')?.textContent, messages.update);

    await setStatus({ ...status, phase: 'recovery-required', candidateVersion: null, releaseId: null, reason: 'UPDATE_RUNTIME_HEALTH_FAILED', installationAvailable: false, checkAvailable: false });
    assert.equal(Boolean(dom.window.document.querySelector('[data-testid="nimi-product-update"]')), true, 'recovery-required must show on primary rail');

    await setStatus({ ...status, phase: 'failed', reason: 'UPDATE_UPSTREAM_UNAVAILABLE', recoveryAction: 'reopen-current', checkAvailable: false });
    assert.equal(Boolean(dom.window.document.querySelector('[data-testid="nimi-product-update"]')), true, 'reopen-current recovery must show on primary rail even with UPDATE_UPSTREAM_UNAVAILABLE');

    await setStatus({ ...status, phase: 'failed', reason: 'UPDATE_SIGNATURE_INVALID', recoveryAction: 'none', checkAvailable: true });
    assert.equal(Boolean(dom.window.document.querySelector('[data-testid="nimi-product-update"]')), true, 'non-passive update failure must show on primary rail');
  } finally {
    await act(async () => root.unmount()); client.clear(); await new Promise((resolve) => setTimeout(resolve, 0)); dom.window.close();
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
