import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY,
  clearAgentConversationAnchorBinding,
  getAgentConversationAnchorBinding,
  persistAgentConversationAnchorBinding,
  subscribeAgentConversationAnchorBindings,
} from '../src/shell/renderer/app-shell/providers/agent-conversation-anchor-binding-storage';

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

test('agent conversation anchor binding persists only explicit anchor pointers', () => {
  const storage = installMemoryStorage();

  const binding = persistAgentConversationAnchorBinding({
    threadId: ' thread-1 ',
    ownerUserId: ' user-a ',
    realmAgentId: ' agent-alpha ',
    localAgentRef: ' local-agent:user-a:agent-alpha ',
    conversationAnchorId: ' anchor-1 ',
    updatedAtMs: 10.7,
  });

  assert.deepEqual(binding, {
    threadId: 'thread-1',
    ownerUserId: 'user-a',
    realmAgentId: 'agent-alpha',
    localAgentRef: 'local-agent:user-a:agent-alpha',
    conversationAnchorId: 'anchor-1',
    updatedAtMs: 10,
  });

  const persisted = JSON.parse(storage.getItem(AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY) || '[]') as Array<Record<string, unknown>>;
  assert.deepEqual(persisted, [binding]);
  assert.deepEqual(getAgentConversationAnchorBinding('thread-1'), binding);
});

test('agent conversation anchor binding hydrates from storage without same-agent fallback', () => {
  const storage = installMemoryStorage();
  storage.setItem(AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY, JSON.stringify([
    {
      threadId: 'thread-a',
      ownerUserId: 'user-a',
    realmAgentId: 'agent-alpha',
    localAgentRef: 'local-agent:user-a:agent-alpha',
      conversationAnchorId: 'anchor-a',
      updatedAtMs: 1,
    },
    {
      threadId: 'thread-b',
      ownerUserId: 'user-a',
    realmAgentId: 'agent-alpha',
    localAgentRef: 'local-agent:user-a:agent-alpha',
      conversationAnchorId: 'anchor-b',
      updatedAtMs: 2,
    },
  ]));

  assert.equal(getAgentConversationAnchorBinding('thread-missing'), null);
  assert.equal(getAgentConversationAnchorBinding('thread-a')?.conversationAnchorId, 'anchor-a');
  assert.equal(getAgentConversationAnchorBinding('thread-b')?.conversationAnchorId, 'anchor-b');
});

test('agent conversation anchor binding keeps same realmAgentId separate across owners', () => {
  installMemoryStorage();

  persistAgentConversationAnchorBinding({
    threadId: 'thread-owner-a',
    ownerUserId: 'owner-a',
    realmAgentId: 'agent-shared',
    localAgentRef: 'local-agent:owner-a:agent-shared',
    conversationAnchorId: 'anchor-owner-a',
    updatedAtMs: 10,
  });
  persistAgentConversationAnchorBinding({
    threadId: 'thread-owner-b',
    ownerUserId: 'owner-b',
    realmAgentId: 'agent-shared',
    localAgentRef: 'local-agent:owner-b:agent-shared',
    conversationAnchorId: 'anchor-owner-b',
    updatedAtMs: 11,
  });

  assert.deepEqual(getAgentConversationAnchorBinding('thread-owner-a'), {
    threadId: 'thread-owner-a',
    ownerUserId: 'owner-a',
    realmAgentId: 'agent-shared',
    localAgentRef: 'local-agent:owner-a:agent-shared',
    conversationAnchorId: 'anchor-owner-a',
    updatedAtMs: 10,
  });
  assert.deepEqual(getAgentConversationAnchorBinding('thread-owner-b'), {
    threadId: 'thread-owner-b',
    ownerUserId: 'owner-b',
    realmAgentId: 'agent-shared',
    localAgentRef: 'local-agent:owner-b:agent-shared',
    conversationAnchorId: 'anchor-owner-b',
    updatedAtMs: 11,
  });
});

test('agent conversation anchor binding drops malformed persisted entries and clears invalid pointers', () => {
  const storage = installMemoryStorage();
  storage.setItem(AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY, JSON.stringify([
    {
      threadId: 'thread-valid',
      ownerUserId: 'user-a',
    realmAgentId: 'agent-alpha',
    localAgentRef: 'local-agent:user-a:agent-alpha',
      conversationAnchorId: 'anchor-valid',
      updatedAtMs: 3,
    },
    {
      threadId: 'thread-invalid',
      ownerUserId: 'user-a',
    realmAgentId: 'agent-alpha',
    localAgentRef: 'local-agent:user-a:agent-alpha',
      conversationAnchorId: '',
      updatedAtMs: 4,
    },
  ]));

  assert.equal(getAgentConversationAnchorBinding('thread-invalid'), null);
  assert.equal(getAgentConversationAnchorBinding('thread-valid')?.conversationAnchorId, 'anchor-valid');

  clearAgentConversationAnchorBinding('thread-valid');

  assert.equal(getAgentConversationAnchorBinding('thread-valid'), null);
  assert.equal(storage.getItem(AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY), null);
});

test('agent conversation anchor binding notifies same-window subscribers', () => {
  installMemoryStorage();
  let notifications = 0;
  const unsubscribe = subscribeAgentConversationAnchorBindings(() => {
    notifications += 1;
  });

  try {
    persistAgentConversationAnchorBinding({
      threadId: 'thread-live',
      ownerUserId: 'user-a',
    realmAgentId: 'agent-alpha',
    localAgentRef: 'local-agent:user-a:agent-alpha',
      conversationAnchorId: 'anchor-live',
      updatedAtMs: 5,
    });
    clearAgentConversationAnchorBinding('thread-live');
  } finally {
    unsubscribe();
  }

  assert.equal(notifications, 2);
});
