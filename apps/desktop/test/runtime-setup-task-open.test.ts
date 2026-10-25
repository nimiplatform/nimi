import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRuntimeSetupTaskStore,
  type RuntimeSetupTaskStore,
} from '../src/shell/renderer/features/runtime-config/runtime-setup-task-store.js';
import {
  findReusableRuntimeSetupTask,
  openOrCreateRuntimeSetupTask,
  openRuntimeSetupTaskFromEntry,
  resolveRuntimeSetupReturnTarget,
  agentCenterSetupReturnFocus,
  returnFromRuntimeSetup,
} from '../src/shell/renderer/features/runtime-config/runtime-setup-task-open.js';

function makeStore(): RuntimeSetupTaskStore {
  let counter = 0;
  return createRuntimeSetupTaskStore({
    storage: null,
    now: () => '2026-09-18T00:00:00.000Z',
    createId: (prefix) => `${prefix}-${counter++}`,
  });
}

const APP_SOURCE = {
  kind: 'app' as const,
  ownerAppId: 'app.chat',
  accountId: 'acct-1',
  returnFocus: 'apps:app.chat',
};

test('a reused setup task returns to the latest exact partner management position', () => {
  const store = makeStore();
  const first = openOrCreateRuntimeSetupTask(store, { capabilityContract: 'text.generate', source: { kind: 'local-agent', accountId: 'acct-1', returnFocus: 'chat:agent' }, openTask() {} });
  const destination = { id: 'chat', chat: { mode: 'agent', managerAnchorId: 'anchor-current', agentCenterSection: 'ai-config' } };
  const returnFocus = 'home:' + encodeURIComponent(JSON.stringify(destination));
  const second = openOrCreateRuntimeSetupTask(store, { capabilityContract: 'text.generate', source: { kind: 'local-agent', accountId: 'acct-1', returnFocus }, openTask() {} });
  assert.equal(first.taskId, second.taskId);
  assert.deepEqual(resolveRuntimeSetupReturnTarget(store.getSnapshot().tasks[0]?.source.returnFocus), { kind: 'destination', destination });
  assert.equal(resolveRuntimeSetupReturnTarget('home:%broken'), null);
});

test('a consumer entry reuses the live task for the same owner and capability', () => {
  const store = makeStore();
  const opened: string[] = [];
  const first = openOrCreateRuntimeSetupTask(store, {
    capabilityContract: 'image.generate',
    source: APP_SOURCE,
    openTask: (taskId) => opened.push(taskId),
  });
  assert.equal(first.reused, false);

  const second = openOrCreateRuntimeSetupTask(store, {
    capabilityContract: 'image.generate',
    source: APP_SOURCE,
    openTask: (taskId) => opened.push(taskId),
  });
  assert.equal(second.reused, true);
  assert.equal(second.taskId, first.taskId);
  assert.deepEqual(opened, [first.taskId, first.taskId]);
  assert.equal(store.getSnapshot().tasks.length, 1);
});

test('a different owner, account snapshot, or capability never reuses the task', () => {
  const store = makeStore();
  const base = openOrCreateRuntimeSetupTask(store, {
    capabilityContract: 'image.generate',
    source: APP_SOURCE,
    openTask: () => {},
  });
  for (const source of [
    { ...APP_SOURCE, ownerAppId: 'app.other' },
    { ...APP_SOURCE, accountId: 'acct-2' },
    { kind: 'local-agent' as const, accountId: 'acct-1' },
  ]) {
    const result = openOrCreateRuntimeSetupTask(store, {
      capabilityContract: 'image.generate',
      source,
      openTask: () => {},
    });
    assert.equal(result.reused, false);
    assert.notEqual(result.taskId, base.taskId);
  }
  const otherCapability = openOrCreateRuntimeSetupTask(store, {
    capabilityContract: 'text.generate',
    source: APP_SOURCE,
    openTask: () => {},
  });
  assert.equal(otherCapability.reused, false);
});

test('terminal and superseded tasks are never reused', () => {
  const store = makeStore();
  const first = openOrCreateRuntimeSetupTask(store, {
    capabilityContract: 'image.generate',
    source: APP_SOURCE,
    openTask: () => {},
  });
  store.updateTask(first.taskId, () => ({ status: 'done' }));
  const second = openOrCreateRuntimeSetupTask(store, {
    capabilityContract: 'image.generate',
    source: APP_SOURCE,
    openTask: () => {},
  });
  assert.equal(second.reused, false);

  const third = openOrCreateRuntimeSetupTask(store, {
    capabilityContract: 'image.generate',
    source: APP_SOURCE,
    openTask: () => {},
  });
  store.claimCapabilityUse(third.taskId, 'image.generate');
  const fourth = store.createTask({ capabilityContract: 'image.generate', source: APP_SOURCE });
  store.claimCapabilityUse(fourth.taskId, 'image.generate');
  // The superseded task is skipped even though it is still live.
  assert.equal(store.getTask(third.taskId)?.supersededBy, fourth.taskId);
  assert.equal(
    findReusableRuntimeSetupTask(store, { capabilityContract: 'image.generate', source: APP_SOURCE })?.taskId,
    fourth.taskId,
  );
});

test('return handles resolve to existing tabs and never invent a destination', () => {
  assert.deepEqual(resolveRuntimeSetupReturnTarget('apps:app.chat'), { kind: 'tab', tab: 'apps' });
  assert.deepEqual(resolveRuntimeSetupReturnTarget('apps'), { kind: 'tab', tab: 'apps' });
  assert.deepEqual(resolveRuntimeSetupReturnTarget('chat'), { kind: 'tab', tab: 'chat' });
  assert.deepEqual(resolveRuntimeSetupReturnTarget('chat:agent'), { kind: 'tab', tab: 'chat' });
  assert.deepEqual(resolveRuntimeSetupReturnTarget('runtime.aiSettings'), { kind: 'runtime' });
  assert.deepEqual(resolveRuntimeSetupReturnTarget(undefined), null);
  assert.deepEqual(resolveRuntimeSetupReturnTarget('unknown-place'), null);
});


test('setup return persists only the original anchor and section for the current-account resolver', async () => {
  const destination = { id: 'chat', chat: { mode: 'agent', managerAnchorId: 'anchor-a', agentCenterSection: 'ai-config' } } as const;
  const returnFocus = agentCenterSetupReturnFocus({ mode: 'agent', agentHandle: 'expired-a', conversationAnchorId: 'anchor-a', agentCenterSection: 'ai-config' });
  assert.ok(!returnFocus.includes('expired-a'));
  const saved = new Map<string, string>();
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); }, removeItem: (key: string) => { saved.delete(key); } };
  const original = createRuntimeSetupTaskStore({ storage });
  const opened = openOrCreateRuntimeSetupTask(original, { capabilityContract: 'text.generate', source: { kind: 'local-agent', accountId: 'acct-1', returnFocus }, openTask() {} });
  const restored = createRuntimeSetupTaskStore({ storage }).getTask(opened.taskId)!;
  const target = resolveRuntimeSetupReturnTarget(restored.source.returnFocus);
  assert.equal(target?.kind, 'destination');
  if (target?.kind !== 'destination') throw new Error('Saved return position missing');
  assert.deepEqual(target.destination, destination);
  const stale = resolveRuntimeSetupReturnTarget('home:' + encodeURIComponent(JSON.stringify({ id: 'chat', chat: { mode: 'agent', agentHandle: 'expired', conversationAnchorId: 'anchor-a' } })));
  assert.equal(stale, null);
  assert.throws(() => agentCenterSetupReturnFocus({ mode: 'agent' }));
  assert.equal(resolveRuntimeSetupReturnTarget('home:' + encodeURIComponent(JSON.stringify({ id: 'agent-center' }))), null);
});

test('returning from a setup detour preserves Back to the original chat', async () => {
  const { createHomeNavigation, homeRuntimeDestination } = await import('../src/shell/renderer/app-shell/providers/home-navigation.js');
  const navigation = createHomeNavigation();
  const chat = { id: 'chat', chat: { mode: 'agent', agentHandle: 'a', conversationAnchorId: 'anchor-a' } } as const;
  const manager = { ...chat, chat: { ...chat.chat, agentCenterSection: 'ai-config' } } as const;
  await navigation.push(chat);
  await navigation.push(manager);
  await navigation.push(homeRuntimeDestination('aiSettings'));
  await navigation.push(homeRuntimeDestination('aiSettings', { capabilityContract: 'text.generate' }));
  await returnFromRuntimeSetup(navigation, manager);
  assert.deepEqual(navigation.getSnapshot().current.destination, manager);
  await navigation.back();
  assert.deepEqual(navigation.getSnapshot().current.destination, chat);
});


test('a delayed configuration source cannot create or rewrite a task after leaving its entry', async () => {
  const { createHomeNavigation } = await import('../src/shell/renderer/app-shell/providers/home-navigation.js');
  const navigation = createHomeNavigation();
  const manager = { id: 'chat', chat: { mode: 'agent', agentHandle: 'current', conversationAnchorId: 'anchor-current', agentCenterSection: 'ai-config' } } as const;
  await navigation.push(manager);
  const store = makeStore();
  const opened: string[] = [];
  for (const existing of [false, true]) {
    if (existing) openOrCreateRuntimeSetupTask(store, { capabilityContract: 'text.generate', source: APP_SOURCE, openTask() {} });
    let finish!: (source: typeof APP_SOURCE) => void;
    const read = new Promise<typeof APP_SOURCE>(resolve => { finish = resolve; });
    const pending = openRuntimeSetupTaskFromEntry(store, { navigation, capabilityContract: 'text.generate', loadSource: () => read, openTask: id => opened.push(id) });
    await navigation.push({ id: 'chat' });
    // Returning to the same history entry does not revive its old request.
    await navigation.back();
    finish({ ...APP_SOURCE, returnFocus: 'stale' });
    assert.equal(await pending, null);
    assert.equal(opened.length, 0);
    assert.equal(store.getSnapshot().tasks.length, existing ? 1 : 0);
    if (existing) assert.equal(store.getSnapshot().tasks[0]?.source.returnFocus, APP_SOURCE.returnFocus);
  }
  const active = await openRuntimeSetupTaskFromEntry(store, { navigation, capabilityContract: 'text.generate', loadSource: async () => APP_SOURCE, openTask: id => opened.push(id) });
  assert.ok(active?.reused);
  assert.deepEqual(opened, [active.taskId]);
});
