import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import messages from '../src/shell/renderer/locales/en/67-ProductUpdate.json';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import type { ProductUpdateStatus } from '../src/shell/shared/product-update.js';

test('Home requires ready capability and explicit task-impact confirmation; deferral and changed candidate do not install', async () => {
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
  let reopens = 0;
  const port = { status: async () => status, check: async () => status, cancel: async () => status, homeReady: async () => status,
    reopenCurrentVersion: async () => { reopens++; status = { ...status, recoveryError: 'UPDATE_REOPEN_BLOCKED' }; return status; },
    install: async (id: string) => { installs.push(id); return status; } };
  const bindings = { app: { commands: { productUpdate: port } } } as DesktopCanonicalRendererBindings;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['nimi-product-update'], status);
  const i18n = createInstance(); await i18n.init({ lng: 'en', resources: { en: { translation: { ProductUpdate: messages } } } });
  const { createRoot } = await import('react-dom/client');
  const { ProductUpdateNotice } = await import('../src/shell/renderer/features/home/product-update-notice.js');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const button = (text: string, dialog = false) => {
    const scope = dialog ? dom.window.document.querySelector('[role="dialog"]')! : dom.window.document;
    const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === text);
    assert.ok(found, `button missing: ${text}`); return found;
  };
  try {
    await act(async () => root.render(<I18nextProvider i18n={i18n}><QueryClientProvider client={client}><DesktopRendererBindingProvider bindings={bindings}><ProductUpdateNotice /></DesktopRendererBindingProvider></QueryClientProvider></I18nextProvider>));
    assert.ok(![...dom.window.document.querySelectorAll('button')].some((item) => item.textContent === messages.restart));
    status = { ...status, installationAvailable: true };
    await act(async () => { client.setQueryData(['nimi-product-update'], status); await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => button(messages.restart).click());
    assert.match(dom.window.document.body.textContent ?? '', /Running apps and tasks will stop/); assert.deepEqual(installs, []);
    await act(async () => button(messages.later, true).click()); assert.deepEqual(installs, []);
    await act(async () => button(messages.restart).click());
    status = { ...status, releaseId: 'nimi/v0.4.0', candidateVersion: '0.4.0' };
    await act(async () => { client.setQueryData(['nimi-product-update'], status); await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => button(messages.restart, true).click()); assert.deepEqual(installs, []);
    await act(async () => button(messages.restart).click());
    await act(async () => button(messages.restart, true).click()); assert.deepEqual(installs, ['nimi/v0.4.0']);
    status = { ...status, phase: 'failed', reason: 'UPDATE_HANDOFF_FAILED', installationAvailable: false,
      checkAvailable: false, recoveryAction: 'reopen-current' };
    await act(async () => { client.setQueryData(['nimi-product-update'], status); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.ok(![...dom.window.document.querySelectorAll('button')].some((item) => item.textContent === messages.check));
    await act(async () => { button(messages.reopen).click(); await new Promise((resolve) => setTimeout(resolve, 0)); }); assert.equal(reopens, 1);
    const alertDeadline = Date.now() + 1_000;
    while (!(dom.window.document.body.textContent ?? '').includes('could not stop safely') && Date.now() < alertDeadline) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
    assert.match(dom.window.document.body.textContent ?? '', /could not stop safely/);
    assert.match(dom.window.document.body.textContent ?? '', /installer handoff failed/);
  } finally {
    await act(async () => root.unmount()); client.clear(); await new Promise((resolve) => setTimeout(resolve, 0)); dom.window.close();
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
