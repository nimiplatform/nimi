import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import React, { act } from 'react';

const { JSDOM } = createRequire(new URL('../../../kit/package.json', import.meta.url))('jsdom');

test('Zhiyu loads replies beyond multiple activity page budgets before acknowledging visible history', async () => {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  let intersect;
  dom.window.document.hasFocus = () => true;
  const globals = { window: dom.window, document: dom.window.document, React, IS_REACT_ACT_ENVIRONMENT: true,
    IntersectionObserver: class { constructor(callback) { intersect = callback; } observe() {} disconnect() {} } };
  const original = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { useConversationReadReceipts, ZhiyuConversationReadReceipt } = await import('../src/shell/agent-chat/ZhiyuConversationReadReceipts.tsx');
  const root = createRoot(document.getElementById('root'));
  const records = Array.from({ length: 650 }, (_, index) => ({
    activityId: `reply-${index}`, key: `turn:turn-${index}`, revision: 7, changeSeq: String(index + 1), kind: 'activity',
    type: 'nimi.runtime.agent-conversation.turn-completed.v1', occurredAt: new Date(Date.UTC(2026, 10, 2) - index * 1000).toISOString(),
    source: { kind: 'runtime-agent', sourceRef: 'runtime' }, agent: { agentRef: 'activity-a' }, userView: { unread: true },
  }));
  const pages = [], reads = [];
  const activity = {
    list: async ({ pageToken, pageSize, filter }) => {
      assert.equal(filter.agentRef, 'activity-a');
      const start = Number(pageToken ?? 0);
      pages.push(start);
      const end = Math.min(start + pageSize, records.length);
      return { records: records.slice(start, end), nextPageToken: end < records.length ? String(end) : null, baselineChangeSeq: '650' };
    },
    subscribe: async () => {
      let close; const closed = new Promise(resolve => { close = resolve; });
      return { cancel: async () => close(), async *[Symbol.asyncIterator]() { await closed; } };
    },
    markRead: async input => { reads.push(input); },
  };
  const listReferences = async () => [{ agentHandle: 'agent-a', activityAgentRef: 'activity-a' }];
  function Conversation() {
    const state = useConversationReadReceipts({ scopeKey: 'account-one', agentHandle: 'agent-a', activity, listReferences });
    const reply = state.replies.get('turn:turn-649');
    return reply ? React.createElement(ZhiyuConversationReadReceipt, { reply, state }) : null;
  }
  try {
    await act(async () => root.render(React.createElement(Conversation)));
    assert.deepEqual(pages, [0, 100, 200, 300, 400, 500, 600]);
    assert.deepEqual(reads, [], 'loading older activity does not mark it read');
    await act(async () => intersect([{ isIntersecting: true }], {}));
    assert.deepEqual(reads, [{ activityId: 'reply-649', displayedRevision: 7 }]);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

test('Zhiyu acknowledges only the displayed current partner revision and retires old-account failures', async () => {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  let intersect;
  dom.window.document.hasFocus = () => true;
  const globals = { window: dom.window, document: dom.window.document, React, IS_REACT_ACT_ENVIRONMENT: true,
    IntersectionObserver: class { constructor(callback) { intersect = callback; } observe() {} disconnect() {} } };
  const original = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { useConversationReadReceipts, ZhiyuConversationReadReceipt } = await import('../src/shell/agent-chat/ZhiyuConversationReadReceipts.tsx');
  const root = createRoot(document.getElementById('root'));
  const calls = [], filters = [];
  let rejectRead;
  const reply = { activityId: 'reply-a', key: 'turn:turn-a', revision: 7, changeSeq: '1', kind: 'activity',
    type: 'nimi.runtime.agent-conversation.turn-completed.v1', occurredAt: '2026-11-02T00:00:00Z',
    source: { kind: 'runtime-agent', sourceRef: 'runtime' }, agent: { agentRef: 'activity-a' }, userView: { unread: true } };
  const activity = {
    list: async input => { filters.push(input.filter); return { records: [reply], nextPageToken: null, baselineChangeSeq: '1' }; },
    subscribe: async () => {
      let close; const closed = new Promise(resolve => { close = resolve; });
      return { cancel: async () => close(), async *[Symbol.asyncIterator]() { await closed; } };
    },
    markRead: async input => { calls.push(input); return new Promise((_, reject) => { rejectRead = reject; }); },
  };
  const listReferences = async () => [{ agentHandle: 'agent-a', activityAgentRef: 'activity-a' }];
  function Conversation({ scope, handle }) {
    const state = useConversationReadReceipts({ scopeKey: scope, agentHandle: handle, activity, listReferences });
    const record = state.replies.get('turn:turn-a');
    return record ? React.createElement(ZhiyuConversationReadReceipt, { reply: record, state }) : null;
  }
  const render = (scope, handle) => act(async () => root.render(React.createElement(Conversation, { scope, handle })));
  const settle = () => act(async () => new Promise(resolve => setTimeout(resolve, 20)));
  try {
    await render('account-one', 'agent-a'); await settle();
    assert.equal(calls.length, 0, 'selecting a partner alone cannot mark its reply read');
    assert.equal(filters[0].agentRef, 'activity-a');
    await act(async () => intersect([{ isIntersecting: false }, { isIntersecting: true }], {}));
    assert.deepEqual(calls, [{ activityId: 'reply-a', displayedRevision: 7 }]);
    await act(async () => rejectRead(new Error('read unavailable')));
    assert.match(document.body.textContent, /已读状态暂未同步/);
    await act(async () => document.querySelector('button').click());
    assert.equal(calls.length, 2);
    await render('account-two', null);
    await act(async () => rejectRead(new Error('late old-account failure'))); await settle();
    assert.equal(document.querySelector('button'), null);
    assert.doesNotMatch(document.body.textContent, /已读状态暂未同步/);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
