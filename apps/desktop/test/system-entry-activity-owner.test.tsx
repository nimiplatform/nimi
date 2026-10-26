import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { NimiAppActivityChange, NimiAppActivitySubscription } from '@nimiplatform/sdk/app';
import type { DesktopRendererSdkPort } from '../src/shell/renderer/renderer/sdk-port.js';
import { useSystemEntryActivityOwner } from '../src/shell/renderer/features/system-entry/system-entry-activity-owner.js';
import { SystemEntryProviderContext, useHomeAppActivity, type HomeAppActivity } from '../src/shell/renderer/features/system-entry/system-entry-context.js';

test('Home and overview consumers share exactly two activity subscriptions and revoke both on scope change', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } }, interpolation: { escapeValue: false } });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  let lists = 0, subscriptions = 0, cancellations = 0, reads = 0;
  const client = {
    list: async () => { lists += 1; return { records: [], nextPageToken: null, baselineChangeSeq: '0' }; },
    subscribe: async (): Promise<NimiAppActivitySubscription> => {
      subscriptions += 1;
      let ended = false;
      let pending: ((value: IteratorResult<NimiAppActivityChange>) => void) | undefined;
      const close = async () => {
        if (!ended) { ended = true; cancellations += 1; pending?.({ done: true, value: undefined }); }
      };
      return { cancel: close, [Symbol.asyncIterator]: () => ({
        next: () => ended ? Promise.resolve({ done: true, value: undefined }) : new Promise((resolve) => { pending = resolve; }),
        return: async () => { await close(); return { done: true, value: undefined }; },
      }) };
    },
    open: async () => ({ outcome: 'opened', reason: 'opened' }),
    markRead: async () => { reads += 1; },
  };
  const sdk = { appProduct: () => ({ activity: client }) } as unknown as DesktopRendererSdkPort;
  const seen: HomeAppActivity[] = [];
  function Consumer({ index }: { index: number }) { seen[index] = useHomeAppActivity(); return <span>{seen[index]!.pending.status}</span>; }
  function Owner({ scope, extra = false }: { scope: string; extra?: boolean }) {
    const owner = useSystemEntryActivityOwner(sdk, scope);
    return <SystemEntryProviderContext.Provider value={{ hostContext: null, homeVisible: true, projection: null, appActivity: owner.activity,
      ai: null, refresh: async () => {}, openAIActivity: async () => {} }}>
      <Consumer index={0} /><Consumer index={1} />{extra ? <Consumer index={2} /> : null}
    </SystemEntryProviderContext.Provider>;
  }
  const render = async (scope: string, extra = false) => {
    await act(async () => { root.render(<I18nextProvider i18n={i18n}><Owner scope={scope} extra={extra} /></I18nextProvider>); });
    await act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)); });
  };
  try {
    await render('account-a');
    assert.equal(lists, 2); assert.equal(subscriptions, 2); assert.equal(seen[0], seen[1]);
    await render('account-a', true);
    assert.equal(lists, 2); assert.equal(subscriptions, 2); assert.equal(seen[0], seen[2]);
    await render('account-b');
    assert.equal(lists, 4); assert.equal(subscriptions, 4); assert.equal(cancellations, 2);
    assert.equal(reads, 0, 'observing, remounting consumers and scope replacement never mark activity read');
  } finally {
    await act(async () => root.unmount());
    assert.equal(cancellations, 4);
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
