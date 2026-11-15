import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import { createHomeNavigation, validateHomeDestination } from '../src/shell/renderer/app-shell/providers/home-navigation.js';
import { createChatTargetNavigation } from '../src/shell/renderer/features/chat/chat-target-navigation.js';
import type { AgentLocalTargetSnapshot } from '../src/shell/renderer/bridge/runtime-bridge/types.js';

const target = (id: string) => ({ id, source: 'agent' }) as ConversationTargetSummary;
const human = (id: string) => ({ id, title: id, source: 'human', canonicalSessionId: '' }) as ConversationTargetSummary;
const snapshot = (id: string) => ({ agentHandle: id, conversationAnchorId: `anchor-${id}`, displayName: id }) as AgentLocalTargetSnapshot;
const chat = (id: string, open = true) => ({ id: 'chat' as const, chat: { mode: 'agent' as const,
  targetId: id, agentHandle: id, conversationAnchorId: `anchor-${id}`, ...(open ? { agentCenterSection: 'ai-config' as const } : {}) } });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('a friend without history opens a real thread; a late open cannot select the wrong friend', async () => {
  const navigation = createHomeNavigation();
  const reads = { b: deferred<string>(), c: deferred<string>() };
  const requested: string[] = [];
  const controller = createChatTargetNavigation({ navigation,
    openHuman: id => { requested.push(id); return reads[id as 'b' | 'c'].promise; },
    onError: error => { throw error; } });
  const b = controller.select(human('b'));
  const c = controller.select(human('c'));
  reads.c.resolve('thread-c'); await c;
  reads.b.resolve('thread-b'); await b;
  assert.deepEqual(requested, ['b', 'c']);
  assert.deepEqual(navigation.getSnapshot().current.destination, { id: 'friends', chat: { mode: 'human', targetId: 'c', threadId: 'thread-c' } });
  controller.dispose(); navigation.dispose();
});

test('failed first chat keeps the origin and reports the failure', async () => {
  const navigation = createHomeNavigation(); const origin = navigation.getSnapshot().current;
  const failure = new Error('Cannot contact this user'); const errors: unknown[] = [];
  const controller = createChatTargetNavigation({ navigation, openHuman: async () => { throw failure; },
    onError: error => errors.push(error) });
  await controller.select(human('b'));
  assert.equal(navigation.getSnapshot().current, origin); assert.deepEqual(errors, [failure]);
  controller.dispose(); navigation.dispose();
});

test('removed Home Agent routes reject instead of falling back to Nimi Chat', () => {
  assert.throws(() => validateHomeDestination({ id: 'chat', chat: { mode: 'agent', agentHandle: 'a', conversationAnchorId: 'anchor-a' } }));
  assert.throws(() => validateHomeDestination({ id: 'chat', chat: { mode: 'human' } }));
  assert.throws(() => validateHomeDestination({ id: 'friends', chat: { mode: 'ai' } }));
  assert.equal(validateHomeDestination({ id: 'friends' }).chat?.mode, 'human');
  assert.equal(validateHomeDestination({ id: 'chat' }).chat?.mode, 'ai');
});

test('a partner target cannot become a Home chat destination', async () => {
  const navigation = createHomeNavigation(); const origin = navigation.getSnapshot().current; const errors: unknown[] = [];
  const controller = createChatTargetNavigation({ navigation, openHuman: async () => { throw new Error('Not a human'); }, onError: error => errors.push(error) });
  await controller.select(target('a'));
  assert.equal(navigation.getSnapshot().current, origin); assert.equal(errors.length, 1);
  controller.dispose(); navigation.dispose();
});
