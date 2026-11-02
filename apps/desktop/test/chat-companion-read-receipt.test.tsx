import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { JSDOM } from 'jsdom';
import type { NimiAppActivityRecord } from '@nimiplatform/sdk/app';
import type { DesktopRendererSdkPort } from '../src/shell/renderer/renderer/sdk-port.js';
import { ChatCompanionReadReceipt } from '../src/shell/renderer/features/chat/chat-companion-read-receipt.js';
import { SystemEntryProviderContext } from '../src/shell/renderer/features/system-entry/system-entry-context.js';
import { useSystemEntryActivityOwner } from '../src/shell/renderer/features/system-entry/system-entry-activity-owner.js';

test('a failed companion read is explained on the reply and retries the displayed revision', async () => {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  dom.window.document.hasFocus = () => true;
  let intersect!: IntersectionObserverCallback;
  const globals = { React, window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
    IntersectionObserver: class {
      constructor(callback: IntersectionObserverCallback) { intersect = callback; }
      observe() {} disconnect() {}
    } };
  const original = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: {
    runtimeConfig: { overview: { appActivity: { readFailed: 'Could not mark this reply as read.' } } },
    Chat: { retryReadReceipt: 'Retry read acknowledgement' },
  } } } });
  const calls: unknown[] = [];
  let rejectFirst!: (error: Error) => void;
  const reply = {
    activityId: 'act_reply', revision: 3, key: 'turn:example', changeSeq: '1', kind: 'activity',
    type: 'nimi.runtime.agent-conversation.turn-completed.v1', source: { kind: 'runtime-agent', sourceRef: 'src_runtime' },
    agent: { agentRef: 'agr_example', displayName: 'Example' }, userView: { unread: true },
  } as NimiAppActivityRecord;
  const sdk = { appProduct: () => ({ activity: {
    list: async () => ({ records: [], nextPageToken: null, baselineChangeSeq: '0' }),
    subscribe: async () => {
      let close!: () => void;
      const closed = new Promise<void>(resolve => { close = resolve; });
      return { cancel: close, async *[Symbol.asyncIterator]() { await closed; } };
    },
    markRead: async (request: unknown) => {
      calls.push(request);
      if (calls.length === 1) await new Promise<void>((_, reject) => { rejectFirst = reject; });
    },
  } }) } as unknown as DesktopRendererSdkPort;
  function Conversation() {
    const { activity } = useSystemEntryActivityOwner(sdk, 'viewer');
    return <SystemEntryProviderContext.Provider value={{ appActivity: activity, hostContext: null, homeVisible: true,
      ai: null, projection: null, refresh() {}, openAIActivity: async () => {} }}>
      <ChatCompanionReadReceipt reply={reply} />
    </SystemEntryProviderContext.Provider>;
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => root.render(<I18nextProvider i18n={i18n}><Conversation /></I18nextProvider>));
    assert.equal(calls.length, 0);
    await act(async () => intersect([{ isIntersecting: false }, { isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver));
    await act(async () => { dom.window.dispatchEvent(new dom.window.Event('focus')); });
    assert.equal(calls.length, 1, 'refocusing while the read is in flight must not send it twice');
    await act(async () => rejectFirst(Error('Connection lost')));
    assert.match(dom.window.document.body.textContent ?? '', /Could not mark this reply as read/);
    const retry = dom.window.document.querySelector('button')!;
    assert.equal(retry.textContent, 'Retry read acknowledgement');
    await act(async () => retry.click());
    assert.deepEqual(calls, Array(2).fill({ activityId: reply.activityId, displayedRevision: reply.revision }));
    assert.equal(dom.window.document.querySelector('button'), null);
    assert.doesNotMatch(dom.window.document.body.textContent ?? '', /Could not mark/);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
