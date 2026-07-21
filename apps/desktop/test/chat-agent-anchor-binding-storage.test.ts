import assert from 'node:assert/strict';
import test from 'node:test';

import { createAgentConversationAnchorBindingStore } from '../src/shell/renderer/app-shell/providers/agent-conversation-anchor-binding-storage';

const anchorBindings = createAgentConversationAnchorBindingStore(() => 0);
const clearAllAgentConversationAnchorBindings = anchorBindings.clearAll;
const clearAgentConversationAnchorBinding = anchorBindings.clear;
const getAgentConversationAnchorBinding = anchorBindings.get;
const persistAgentConversationAnchorBinding = anchorBindings.persist;
const subscribeAgentConversationAnchorBindings = anchorBindings.subscribe;

const LEGACY_AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY = 'nimi.chat.agent.anchor-bindings.v2';

class MemoryStorage implements Storage {
  readonly store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

function installMemoryStorage(): MemoryStorage {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  return storage;
}

function resetAgentConversationAnchorBindings(): void {
  clearAllAgentConversationAnchorBindings();
  delete (globalThis as { localStorage?: Storage }).localStorage;
}

test('agent conversation anchor binding keeps only explicit anchor pointers in memory', () => {
  resetAgentConversationAnchorBindings();
  const storage = installMemoryStorage();

  const binding = persistAgentConversationAnchorBinding({
    ownerUserId: ' user-a ',
    runtimeSourceRef: ' agent-alpha ',
    localAgentRef: ' local-agent:user-a:agent-alpha ',
    conversationAnchorId: ' anchor-1 ',
    threadId: ' runtime-thread-1 ',
    updatedAtMs: 10.7,
  });

  assert.deepEqual(binding, {
    ownerUserId: 'user-a',
    runtimeSourceRef: 'agent-alpha',
    localAgentRef: 'local-agent:user-a:agent-alpha',
    conversationAnchorId: 'anchor-1',
    threadId: 'runtime-thread-1',
    updatedAtMs: 10,
  });

  assert.equal(storage.length, 0);
  assert.deepEqual(getAgentConversationAnchorBinding('local-agent:user-a:agent-alpha'), binding);
});

test('agent conversation anchor binding ignores legacy persisted localStorage entries', () => {
  resetAgentConversationAnchorBindings();
  const storage = installMemoryStorage();
  storage.setItem(LEGACY_AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY, JSON.stringify([
    {
      ownerUserId: 'user-a',
      runtimeSourceRef: 'agent-alpha',
      localAgentRef: 'local-agent:user-a:agent-alpha',
      conversationAnchorId: 'anchor-a',
      updatedAtMs: 1,
    },
    {
      ownerUserId: 'user-a',
      runtimeSourceRef: 'agent-alpha',
      localAgentRef: 'local-agent:user-a:agent-alpha',
      conversationAnchorId: 'anchor-b',
      updatedAtMs: 2,
    },
  ]));

  assert.equal(getAgentConversationAnchorBinding('local-agent:user-a:agent-missing'), null);
  assert.equal(getAgentConversationAnchorBinding('local-agent:user-a:agent-alpha'), null);
});

test('agent conversation anchor binding keeps same runtimeSourceRef separate across owners', () => {
  resetAgentConversationAnchorBindings();

  persistAgentConversationAnchorBinding({
    ownerUserId: 'owner-a',
    runtimeSourceRef: 'agent-shared',
    localAgentRef: 'local-agent:owner-a:agent-shared',
    conversationAnchorId: 'anchor-owner-a',
    threadId: 'runtime-thread-owner-a',
    updatedAtMs: 10,
  });
  persistAgentConversationAnchorBinding({
    ownerUserId: 'owner-b',
    runtimeSourceRef: 'agent-shared',
    localAgentRef: 'local-agent:owner-b:agent-shared',
    conversationAnchorId: 'anchor-owner-b',
    threadId: 'runtime-thread-owner-b',
    updatedAtMs: 11,
  });

  assert.deepEqual(getAgentConversationAnchorBinding('local-agent:owner-a:agent-shared'), {
    ownerUserId: 'owner-a',
    runtimeSourceRef: 'agent-shared',
    localAgentRef: 'local-agent:owner-a:agent-shared',
    conversationAnchorId: 'anchor-owner-a',
    threadId: 'runtime-thread-owner-a',
    updatedAtMs: 10,
  });
  assert.deepEqual(getAgentConversationAnchorBinding('local-agent:owner-b:agent-shared'), {
    ownerUserId: 'owner-b',
    runtimeSourceRef: 'agent-shared',
    localAgentRef: 'local-agent:owner-b:agent-shared',
    conversationAnchorId: 'anchor-owner-b',
    threadId: 'runtime-thread-owner-b',
    updatedAtMs: 11,
  });
});

test('agent conversation anchor binding rejects malformed explicit pointers and clears valid pointers', () => {
  resetAgentConversationAnchorBindings();

  assert.throws(() => persistAgentConversationAnchorBinding({
    ownerUserId: 'user-a',
    runtimeSourceRef: 'agent-alpha',
    localAgentRef: 'local-agent:user-a:agent-alpha',
    conversationAnchorId: '',
    threadId: 'runtime-thread-invalid',
    updatedAtMs: 4,
  }), /agent conversation anchor binding is invalid/);

  assert.throws(() => persistAgentConversationAnchorBinding({
    ownerUserId: 'user-a',
    runtimeSourceRef: 'agent-alpha',
    localAgentRef: 'local-agent:user-a:agent-alpha',
    conversationAnchorId: 'anchor-without-runtime-thread',
    threadId: '',
    updatedAtMs: 4,
  }), /agent conversation anchor binding is invalid/);

  persistAgentConversationAnchorBinding({
    ownerUserId: 'user-a',
    runtimeSourceRef: 'agent-alpha',
    localAgentRef: 'local-agent:user-a:agent-alpha',
    conversationAnchorId: 'anchor-valid',
    threadId: 'runtime-thread-valid',
    updatedAtMs: 3,
  });

  clearAgentConversationAnchorBinding('local-agent:user-a:agent-alpha');

  assert.equal(getAgentConversationAnchorBinding('local-agent:user-a:agent-alpha'), null);
});

test('agent conversation anchor binding notifies same-window subscribers', () => {
  resetAgentConversationAnchorBindings();
  let notifications = 0;
  const unsubscribe = subscribeAgentConversationAnchorBindings(() => {
    notifications += 1;
  });

  try {
    persistAgentConversationAnchorBinding({
      ownerUserId: 'user-a',
      runtimeSourceRef: 'agent-alpha',
      localAgentRef: 'local-agent:user-a:agent-alpha',
      conversationAnchorId: 'anchor-live',
      threadId: 'runtime-thread-live',
      updatedAtMs: 5,
    });
    clearAgentConversationAnchorBinding('local-agent:user-a:agent-alpha');
  } finally {
    unsubscribe();
  }

  assert.equal(notifications, 2);
});
