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
