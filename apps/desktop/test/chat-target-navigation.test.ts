import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import { createHomeNavigation, validateHomeDestination } from '../src/shell/renderer/app-shell/providers/home-navigation.js';
import { createChatTargetNavigation } from '../src/shell/renderer/features/chat/chat-target-navigation.js';
import type { AgentLocalTargetSnapshot } from '../src/shell/renderer/bridge/runtime-bridge/types.js';

const target = (id: string) => ({ id, source: 'agent' }) as ConversationTargetSummary;
const snapshot = (id: string) => ({ agentHandle: id, conversationAnchorId: `anchor-${id}`, displayName: id }) as AgentLocalTargetSnapshot;
const chat = (id: string, open = true) => ({ id: 'chat' as const, chat: { mode: 'agent' as const,
  targetId: id, agentHandle: id, conversationAnchorId: `anchor-${id}`, ...(open ? { agentCenterSection: 'ai-config' as const } : {}) } });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('avatar navigation retains an open section and leaves a closed manager closed', async () => {
  for (const open of [true, false]) {
    const navigation = createHomeNavigation(); await navigation.push(chat('a', open));
    const remembered: string[] = [];
    const controller = createChatTargetNavigation({ navigation, openAgent: async t => snapshot(t.id),
      rememberAgent: value => remembered.push(value.agentHandle!), onError: error => { throw error; } });
    await controller.select(target('b'));
    assert.deepEqual(navigation.getSnapshot().current.destination, chat('b', open));
    await controller.select(target('a'));
    assert.deepEqual(navigation.getSnapshot().current.destination, chat('a', open));
    assert.deepEqual(remembered, ['b', 'a']);
    controller.dispose(); navigation.dispose();
  }
});

test('last click wins regardless of response order; losing reads never update the target cache', async () => {
  for (const first of ['b', 'c']) {
    const navigation = createHomeNavigation(); await navigation.push(chat('a'));
    const reads = { b: deferred<AgentLocalTargetSnapshot>(), c: deferred<AgentLocalTargetSnapshot>() };
    const remembered: string[] = [];
    const controller = createChatTargetNavigation({ navigation, openAgent: t => reads[t.id as 'b' | 'c'].promise,
      rememberAgent: value => remembered.push(value.agentHandle!), onError: error => { throw error; } });
    const b = controller.select(target('b')); const c = controller.select(target('c'));
    reads[first as 'b' | 'c'].resolve(snapshot(first)); await Promise.resolve();
    const last = first === 'b' ? 'c' : 'b'; reads[last].resolve(snapshot(last));
    await Promise.all([b, c]);
    assert.deepEqual(navigation.getSnapshot().current.destination, chat('c'));
    assert.deepEqual(remembered, ['c']);
    controller.dispose(); navigation.dispose();
  }
});

test('leaving, returning, disposing and late failure cannot revive a superseded avatar request', async () => {
  for (const action of ['back', 'dispose', 'human']) {
    const navigation = createHomeNavigation(); await navigation.push(chat('a'));
    const read = deferred<AgentLocalTargetSnapshot>(); const errors: unknown[] = [];
    const controller = createChatTargetNavigation({ navigation, openAgent: () => read.promise,
      rememberAgent: () => assert.fail('stale cache update'), onError: e => errors.push(e) });
    const pending = controller.select(target('b'));
    if (action === 'back') { await navigation.push({ id: 'home' }); await navigation.back(); }
    if (action === 'dispose') controller.dispose();
    if (action === 'human') await controller.select({ id: 'person', source: 'human', canonicalSessionId: 'human-thread' } as ConversationTargetSummary);
    const current = navigation.getSnapshot().current;
    read.reject(new Error('late error')); await pending;
    assert.equal(navigation.getSnapshot().current, current); assert.deepEqual(errors, []);
    controller.dispose(); navigation.dispose();
  }
});

test('current failure keeps the current partner and reports failure', async () => {
  const navigation = createHomeNavigation(); await navigation.push(chat('a'));
  const errors: unknown[] = [];
  const failure = new Error('Cannot open partner');
  const controller = createChatTargetNavigation({ navigation, openAgent: async () => { throw failure; },
    rememberAgent: () => assert.fail('failed cache update'), onError: e => errors.push(e) });
  await controller.select(target('b'));
  assert.deepEqual(navigation.getSnapshot().current.destination, chat('a')); assert.deepEqual(errors, [failure]);
});

test('Home rejects the removed whole page and accepts only Agent sidebar sections', () => {
  assert.throws(() => validateHomeDestination({ id: 'agent-center' }));
  assert.throws(() => validateHomeDestination({ id: 'chat', chat: { mode: 'ai', agentCenterSection: 'ai-config' } }));
  assert.throws(() => validateHomeDestination({ id: 'chat', chat: { mode: 'agent', agentCenterSection: 'unknown' } }));
  assert.deepEqual(validateHomeDestination(chat('a')), chat('a'));
});
