import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRuntimeSetupTaskStore,
  type RuntimeSetupTaskStore,
} from '../src/shell/renderer/features/runtime-config/runtime-setup-task-store.js';
import {
  findReusableRuntimeSetupTask,
  openOrCreateRuntimeSetupTask,
  resolveRuntimeSetupReturnTarget,
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
