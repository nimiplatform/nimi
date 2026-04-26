import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY,
  clearAgentConversationAnchorBinding,
  getAgentConversationAnchorBinding,
  persistAgentConversationAnchorBinding,
} from '../src/shell/renderer/features/chat/chat-agent-anchor-binding-storage';

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
    agentId: ' agent-alpha ',
    conversationAnchorId: ' anchor-1 ',
    updatedAtMs: 10.7,
  });

  assert.deepEqual(binding, {
    threadId: 'thread-1',
    agentId: 'agent-alpha',
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
      agentId: 'agent-alpha',
      conversationAnchorId: 'anchor-a',
      updatedAtMs: 1,
    },
    {
      threadId: 'thread-b',
      agentId: 'agent-alpha',
      conversationAnchorId: 'anchor-b',
      updatedAtMs: 2,
    },
  ]));

  assert.equal(getAgentConversationAnchorBinding('thread-missing'), null);
  assert.equal(getAgentConversationAnchorBinding('thread-a')?.conversationAnchorId, 'anchor-a');
  assert.equal(getAgentConversationAnchorBinding('thread-b')?.conversationAnchorId, 'anchor-b');
});

test('agent conversation anchor binding drops malformed persisted entries and clears invalid pointers', () => {
  const storage = installMemoryStorage();
  storage.setItem(AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY, JSON.stringify([
    {
      threadId: 'thread-valid',
      agentId: 'agent-alpha',
      conversationAnchorId: 'anchor-valid',
      updatedAtMs: 3,
    },
    {
      threadId: 'thread-invalid',
      agentId: 'agent-alpha',
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
