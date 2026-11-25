import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { RouteAndSubmitOutcome, type WorkSessionRecord, type RouteAndSubmitInputRequest } from '@nimiplatform/sdk/runtime/generated';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';

test('Home consumes accepted and queued App submissions once and keeps an unconfirmed draft', async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    React, IS_REACT_ACT_ENVIRONMENT: true };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : Reflect.deleteProperty(globalThis, key));
  }
  const { createRoot } = await import('react-dom/client');
  const { nimiToast } = await import('@nimiplatform/kit/ui');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { HomeOmniComposer } = await import('../src/shell/renderer/features/home/home-omni-composer.js');
  await initI18n();
  await changeLocale('en');
  const toasts = t.mock.method(nimiToast, 'show', () => 'toast');
  const openHarness = t.mock.fn();
  const session = { workSessionRef: 'ws-review', agentBinding: 'partner',
    title: 'Review', sessionKind: 'app_work', ownerBodyKind: 'app.review.tasks' } as WorkSessionRecord;
  const recentSessions = [session];
  let outcome = RouteAndSubmitOutcome.ACCEPTED;
  const calls: RouteAndSubmitInputRequest[] = [];
  const sessions = {
    listSessions: async () => ({ items: recentSessions }),
    async routeAndSubmitInput(request: RouteAndSubmitInputRequest) {
      calls.push(request);
      return { outcome, sessionKind: session.sessionKind, ownerBodyKind: session.ownerBodyKind,
        resolvedWorkSessionRef: session.workSessionRef };
    },
  };
  const bindings = { app: { commands: {} }, sdk: { accountProduct: () => ({ sessions }) } } as unknown as DesktopCanonicalRendererBindings;
  const doc = dom.window.document;
  const root = createRoot(doc.getElementById('root')!);
  try {
    await act(async () => root.render(<DesktopRendererBindingProvider bindings={bindings}>
      <HomeOmniComposer accountKey="account" partners={[]} recentSessions={recentSessions}
        onOpenHarness={openHarness} onOpenModelSwitch={() => {}} onOpenHumanChatDraft={() => {}} onOpenPartnerZhiyu={() => {}} />
    </DesktopRendererBindingProvider>));
    const input = doc.querySelector('textarea')!;
    const type = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    };
    await type('#Review');
    const option = doc.querySelector('[role="option"]')!;
    assert.match(option.textContent ?? '', /Review/);
    await act(async () => { option.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true })); });
    const submit = doc.querySelector<HTMLButtonElement>('[data-testid="home-quick-start-submit"]')!;
    for (const expected of [RouteAndSubmitOutcome.ACCEPTED, RouteAndSubmitOutcome.DEFERRED_BODY_OFFLINE, RouteAndSubmitOutcome.UNSPECIFIED]) {
      outcome = expected;
      const before = calls.length;
      await type('Review the draft');
      await act(async () => submit.click());
      assert.equal(calls.length, before + 1);
      assert.equal(calls[before]?.explicitWorkSessionRef, session.workSessionRef);
      const confirmed = outcome !== RouteAndSubmitOutcome.UNSPECIFIED;
      assert.equal(input.value, confirmed ? '' : 'Review the draft');
      assert.equal(Boolean(doc.querySelector('[role="alert"]')), !confirmed);
      if (confirmed) {
        assert.equal(submit.disabled, true);
        await act(async () => { input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
        assert.equal(calls.length, before + 1);
      }
    }
    assert.equal(openHarness.mock.callCount(), 0);
    assert.deepEqual(toasts.mock.calls.map(call => call.arguments[0].message), [
      'Task sent to the app handling this session.',
      'Task queued. It will be delivered when the app comes online.',
    ]);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
