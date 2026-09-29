import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import { createAgentComposerDraftRef } from '../src/shell/renderer/features/chat/chat-agent-composer-draft.js';
import {
  isAgentTurnAdmitted,
  streamChatAgentRuntimeAgentTurn,
} from '../src/shell/renderer/features/chat/chat-agent-runtime-agent.js';

function createStore() {
  return createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
}

function project(store: ReturnType<typeof createStore>, status: 'authenticated' | 'unavailable', accountId: string | null) {
  store.getState().applyRuntimeAccountProjection({
    status,
    user: accountId ? { id: accountId } : null,
    sequence: '1',
    reasonCode: 0,
    accountReasonCode: 0,
  });
}

test('partner drafts survive A -> B -> A and every write stays with its own partner', () => {
  const store = createStore();
  const draftA = createAgentComposerDraftRef(store, 'account-1', 'agent-a');
  draftA.current = 'hello A';
  const draftB = createAgentComposerDraftRef(store, 'account-1', 'agent-b');
  assert.equal(draftB.current, '', 'A draft leaked into B');
  draftB.current = 'hello B';
  assert.equal(createAgentComposerDraftRef(store, 'account-1', 'agent-a').current, 'hello A');
  // A turn that started with A may finish after the user moved to B.
  draftA.current = '';
  assert.equal(draftB.current, 'hello B');
});

test('a temporary outage keeps drafts for the same account and hides them from another', () => {
  const store = createStore();
  project(store, 'authenticated', 'account-1');
  createAgentComposerDraftRef(store, 'account-1', 'agent-a').current = 'unsent';
  project(store, 'unavailable', null);
  const withoutAccount = createAgentComposerDraftRef(store, '', 'agent-a');
  assert.equal(withoutAccount.current, '');
  withoutAccount.current = 'ignored';
  project(store, 'authenticated', 'account-2');
  assert.equal(createAgentComposerDraftRef(store, 'account-2', 'agent-a').current, '');
  project(store, 'authenticated', 'account-1');
  assert.equal(createAgentComposerDraftRef(store, 'account-1', 'agent-a').current, 'unsent');
});

test('ending the session clears unsent drafts', () => {
  const store = createStore();
  createAgentComposerDraftRef(store, 'account-1', 'agent-a').current = 'unsent';
  store.getState().clearAuthSession();
  assert.deepEqual(store.getState().agentComposerDrafts, {});
});

function fakeConversation(input: { sent: () => void }) {
  let finish: (() => void) | undefined;
  const events = {
    cancel: async () => { finish?.(); },
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise<IteratorResult<never>>((resolve) => {
        finish = () => resolve({ done: true, value: undefined });
      }),
    }),
  };
  return {
    conversation: () => ({
      subscribe: async () => events,
      send: async () => { input.sent(); return { turnId: 'turn-1' }; },
      interruptTurn: async () => { finish?.(); return {}; },
    }),
  } as never;
}

const TURN = {
  agentHandle: 'agent-a',
  conversationAnchorId: 'anchor-1',
  threadId: 'thread-1',
  userMessageId: 'message-1',
  userText: 'hello',
  userAttachments: [],
  maxOutputTokensRequested: null,
  reasoningPreference: 'off',
} as const;

test('a turn counts as sent only once Runtime accepted it', async () => {
  const stoppedEarly = new AbortController();
  stoppedEarly.abort();
  let sends = 0;
  const early = await streamChatAgentRuntimeAgentTurn({ ...TURN, signal: stoppedEarly.signal } as never, fakeConversation({ sent: () => { sends += 1; } }));
  await assert.rejects(early.stream[Symbol.asyncIterator]().next(), /canceled before admission/u);
  assert.equal(sends, 0);
  assert.equal(isAgentTurnAdmitted(stoppedEarly.signal), false);

  const running = new AbortController();
  let markSent: (() => void) | undefined;
  const sent = new Promise<void>((resolve) => { markSent = resolve; });
  const accepted = await streamChatAgentRuntimeAgentTurn({ ...TURN, signal: running.signal } as never, fakeConversation({ sent: () => markSent?.() }));
  const pending = accepted.stream[Symbol.asyncIterator]().next().catch(() => undefined);
  await sent;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(isAgentTurnAdmitted(running.signal), true);
  running.abort();
  await pending;
});
