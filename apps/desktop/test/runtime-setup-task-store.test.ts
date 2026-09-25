import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRuntimeSetupTaskStore,
  RUNTIME_SETUP_TASKS_STORAGE_KEY,
} from '../src/shell/renderer/features/runtime-config/runtime-setup-task-store.js';

function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
    dump: () => new Map(map),
    read: (key: string) => map.get(key) ?? null,
  } as const;
}

function makeStore(storage: ReturnType<typeof createMemoryStorage>) {
  let counter = 0;
  return createRuntimeSetupTaskStore({
    storage,
    now: () => '2026-09-18T00:00:00.000Z',
    createId: (prefix) => `${prefix}-${counter++}`,
  });
}

const SOURCE = { kind: 'app' as const, ownerAppId: 'app.chat', accountId: 'acct-1', returnFocus: 'app:app.chat' };

test('review version picks survive navigation and restart without granting use authorization', () => {
  const storage = createMemoryStorage();
  const store = makeStore(storage);
  const task = store.createTask({ capabilityContract: 'text.generate', source: SOURCE });
  store.updateTask(task.taskId, () => ({
    status: 'review', draft: { recipeId: 'chosen', reviewChoices: { main: 'offer:chosen' } },
  }));
  const restored = makeStore(storage).getTask(task.taskId)!;
  assert.deepEqual(restored.draft?.reviewChoices, { main: 'offer:chosen' });
  assert.equal(restored.authorization, undefined);
});

test('recovery records persist only non-secret fields and never the authorization', () => {
  const storage = createMemoryStorage();
  const store = makeStore(storage);
  const task = store.createTask({ capabilityContract: 'image.generate', source: SOURCE });
  store.updateTask(task.taskId, () => ({
    candidateLoadoutId: 'loadout-1',
    candidateRevisionBaseline: 'r1',
    selectionRevisionBaseline: 'sel-1',
    refs: {
      installPlanIds: ['plan-1'],
      transferIds: ['session-1'],
      environmentPlanId: 'env-1',
      dependencyJobIds: ['job-1'],
      aiConfigBaselineRevision: '7',
    },
    authorization: {
      scope: {
        items: [{ kind: 'acquire-asset', id: 'offer:main', label: 'Image Model', sizeBytes: 1024 }],
        usage: { selectOnMachine: true, saveOwnerRoute: true, ownerLabel: 'app.chat' },
      },
      confirmedAt: '2026-09-18T00:00:00.000Z',
      mode: 'prepare-and-use',
    },
    status: 'review',
    nextAction: 'confirm-preparation',
  }));

  const raw = storage.read(RUNTIME_SETUP_TASKS_STORAGE_KEY);
  assert.ok(raw);
  const parsed = JSON.parse(raw) as { version: number; tasks: Record<string, unknown>[] };
  assert.equal(parsed.version, 1);
  assert.equal(parsed.tasks.length, 1);
  const persisted = parsed.tasks[0]!;
  assert.equal(persisted.authorization, undefined, 'use authorization must never be persisted');
  assert.equal(persisted.candidateLoadoutId, 'loadout-1');
  assert.deepEqual(persisted.refs, {
    installPlanIds: ['plan-1'],
    transferIds: ['session-1'],
    environmentPlanId: 'env-1',
    dependencyJobIds: ['job-1'],
    aiConfigBaselineRevision: '7',
  });
  assert.equal(raw.includes('confirmedAt'), false);
  assert.equal(raw.includes('selectOnMachine'), false);
});

test('restart recovery drops use confirmation and forces re-verification', () => {
  const storage = createMemoryStorage();
  const first = makeStore(storage);
  const preparing = first.createTask({ capabilityContract: 'image.generate', source: SOURCE });
  first.updateTask(preparing.taskId, () => ({
    status: 'preparing',
    candidateLoadoutId: 'loadout-1',
    authorization: {
      scope: { items: [], usage: { selectOnMachine: true, saveOwnerRoute: false } },
      confirmedAt: '2026-09-18T00:00:00.000Z',
      mode: 'prepare-and-use',
    },
  }));
  const reviewing = first.createTask({ capabilityContract: 'text.embed', source: SOURCE });
  first.updateTask(reviewing.taskId, () => ({ status: 'review', candidateLoadoutId: 'loadout-2' }));
  const done = first.createTask({ capabilityContract: 'audio.synthesize', source: SOURCE });
  first.updateTask(done.taskId, () => ({ status: 'done' }));

  const restored = makeStore(storage);
  const recoveredPreparing = restored.getTask(preparing.taskId);
  assert.equal(recoveredPreparing?.status, 'needs-attention');
  assert.equal(recoveredPreparing?.nextAction, 'reverify');
  assert.equal(recoveredPreparing?.failure?.stage, 'restart-recovery');
  assert.equal(recoveredPreparing?.authorization, undefined);
  const recoveredReview = restored.getTask(reviewing.taskId);
  assert.equal(recoveredReview?.status, 'draft');
  assert.equal(recoveredReview?.candidateLoadoutId, 'loadout-2');
  assert.equal(restored.getTask(done.taskId)?.status, 'done');
});

test('capability claims stay unique and superseding marks the previous task', () => {
  const storage = createMemoryStorage();
  const store = makeStore(storage);
  const taskA = store.createTask({ capabilityContract: 'image.generate', source: SOURCE });
  const taskB = store.createTask({ capabilityContract: 'image.generate', source: SOURCE });

  assert.equal(store.claimCapabilityUse(taskA.taskId, 'image.generate'), true);
  assert.equal(store.isCapabilityUseCurrent(taskA.taskId, 'image.generate'), true);

  assert.equal(store.claimCapabilityUse(taskB.taskId, 'image.generate'), true);
  assert.equal(store.isCapabilityUseCurrent(taskB.taskId, 'image.generate'), true);
  assert.equal(store.isCapabilityUseCurrent(taskA.taskId, 'image.generate'), false);
  assert.equal(store.getTask(taskA.taskId)?.supersededBy, taskB.taskId);
  assert.deepEqual(store.getSnapshot().capabilityClaims, { 'image.generate': taskB.taskId });

  // A superseded task cannot reclaim; a terminal task cannot claim.
  assert.equal(store.claimCapabilityUse(taskA.taskId, 'image.generate'), false);
  store.updateTask(taskB.taskId, () => ({ status: 'done' }));
  assert.equal(store.isCapabilityUseCurrent(taskB.taskId, 'image.generate'), false);
});

test('supersedeCapability invalidates only the previous pending use', () => {
  const storage = createMemoryStorage();
  const store = makeStore(storage);
  const oldTask = store.createTask({ capabilityContract: 'text.generate', source: SOURCE });
  const newTask = store.createTask({ capabilityContract: 'text.generate', source: SOURCE });
  store.claimCapabilityUse(oldTask.taskId, 'text.generate');

  store.supersedeCapability('text.generate', newTask.taskId);
  assert.equal(store.getTask(oldTask.taskId)?.supersededBy, newTask.taskId);
  assert.equal(store.isCapabilityUseCurrent(oldTask.taskId, 'text.generate'), false);
  assert.equal(store.isCapabilityUseCurrent(newTask.taskId, 'text.generate'), true);
  // The old task itself is not stopped or deleted; its resources stay queryable.
  assert.equal(store.getTask(oldTask.taskId)?.status, 'draft');
});

test('stopTask blocks the task and releases the capability claim; dismiss keeps only terminal records out', () => {
  const storage = createMemoryStorage();
  const store = makeStore(storage);
  const task = store.createTask({ capabilityContract: 'image.generate', source: SOURCE });
  store.updateTask(task.taskId, () => ({ refs: { installPlanIds: ['plan-9'], transferIds: [], dependencyJobIds: [] } }));
  store.claimCapabilityUse(task.taskId, 'image.generate');

  const stopped = store.stopTask(task.taskId);
  assert.equal(stopped?.status, 'stopped');
  assert.deepEqual(store.getSnapshot().capabilityClaims, {});
  assert.equal(store.getTask(task.taskId)?.refs.installPlanIds[0], 'plan-9');
  // Stopping again and mutating a terminal task are no-ops for status.
  assert.equal(store.stopTask(task.taskId), null);
  assert.equal(store.dismissTask(task.taskId), true);
  assert.equal(store.getTask(task.taskId), undefined);
  // A non-terminal task cannot be dismissed.
  const live = store.createTask({ capabilityContract: 'text.embed', source: SOURCE });
  assert.equal(store.dismissTask(live.taskId), false);
});

test('capability claims restore only for live, non-superseded tasks', () => {
  const storage = createMemoryStorage();
  const first = makeStore(storage);
  const live = first.createTask({ capabilityContract: 'image.generate', source: SOURCE });
  first.claimCapabilityUse(live.taskId, 'image.generate');
  const done = first.createTask({ capabilityContract: 'text.embed', source: SOURCE });
  first.claimCapabilityUse(done.taskId, 'text.embed');
  first.updateTask(done.taskId, () => ({ status: 'done' }));

  const restored = makeStore(storage);
  assert.deepEqual(restored.getSnapshot().capabilityClaims, { 'image.generate': live.taskId });
});

test('task drafts persist only non-secret fields and survive a restart', () => {
  const storage = createMemoryStorage();
  const store = makeStore(storage);
  const task = store.createTask({ capabilityContract: 'image.generate', source: SOURCE });
  store.updateTask(task.taskId, () => ({
    draft: {
      recipeId: 'image.recipe',
      route: 'cloud',
      options: { steps: 30, guidance: 4.5 },
      axes: [{ slotId: 'main.diffusion', modelAssetId: 'asset-1', expectedContentId: 'sha256:model-content' }],
      disabledOptionalSlots: ['companion.mmproj'],
      preferredOffers: { 'main.diffusion': 'offer:q8' },
      cloudConnectorRef: 'conn-1',
      cloudTargetLabel: 'gpt-5',
      cloudTargetKey: '["conn-1"]',
      profileId: 'profile.shared-1',
    },
  }));

  const raw = storage.read(RUNTIME_SETUP_TASKS_STORAGE_KEY);
  assert.ok(raw);
  const parsed = JSON.parse(raw) as { tasks: Record<string, unknown>[] };
  const persisted = parsed.tasks[0]!;
  assert.deepEqual(persisted.draft, {
    recipeId: 'image.recipe',
    route: 'cloud',
    options: { steps: 30, guidance: 4.5 },
    axes: [{ slotId: 'main.diffusion', modelAssetId: 'asset-1', expectedContentId: 'sha256:model-content' }],
    disabledOptionalSlots: ['companion.mmproj'],
    preferredOffers: { 'main.diffusion': 'offer:q8' },
    cloudConnectorRef: 'conn-1',
    cloudTargetLabel: 'gpt-5',
    cloudTargetKey: '["conn-1"]',
    profileId: 'profile.shared-1',
  });

  const restored = makeStore(storage);
  assert.deepEqual(restored.getTask(task.taskId)?.draft, persisted.draft);
});

test('malformed draft fields are dropped on restore without breaking the task', () => {
  const storage = createMemoryStorage();
  const store = makeStore(storage);
  const task = store.createTask({ capabilityContract: 'image.generate', source: SOURCE });
  store.updateTask(task.taskId, () => ({
    draft: {
      recipeId: 'image.recipe',
      axes: [
        { slotId: 'main.diffusion', modelAssetId: 'asset-1', expectedContentId: 'sha256:model-content' },
        // Half-bound axes are not a legal draft and must not survive a restart.
        { slotId: 'broken', modelAssetId: '', expectedContentId: '' },
      ],
      route: 'local',
    },
  }));
  const raw = JSON.parse(storage.read(RUNTIME_SETUP_TASKS_STORAGE_KEY)!) as { tasks: { draft: Record<string, unknown> }[] };
  raw.tasks[0]!.draft.axes = [
    { slotId: 'main.diffusion', modelAssetId: 'asset-1', expectedContentId: 'sha256:model-content' },
    { slotId: 'broken' },
  ];
  storage.setItem(RUNTIME_SETUP_TASKS_STORAGE_KEY, JSON.stringify(raw));

  const restored = makeStore(storage);
  assert.deepEqual(restored.getTask(task.taskId)?.draft?.axes, [
    { slotId: 'main.diffusion', modelAssetId: 'asset-1', expectedContentId: 'sha256:model-content' },
  ]);
  assert.equal(restored.getTask(task.taskId)?.draft?.recipeId, 'image.recipe');
});

test('owner saves serialize per owner, release after failure, and are never persisted', async () => {
  const storage = createMemoryStorage();
  const store = makeStore(storage);
  const calls: string[] = [];
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const first = store.runOwnerRouteSave('owner-a', async () => {
    calls.push('a-first');
    await waiting;
    throw new Error('write failed');
  });
  const failure = assert.rejects(first, /write failed/u);
  const second = store.runOwnerRouteSave('owner-a', async () => { calls.push('a-second'); });
  await store.runOwnerRouteSave('owner-b', async () => { calls.push('b'); });
  assert.deepEqual(calls, ['a-first', 'b']);

  store.createTask({ capabilityContract: 'image.generate', source: SOURCE });
  const raw = storage.read(RUNTIME_SETUP_TASKS_STORAGE_KEY);
  assert.ok(raw);
  assert.equal(raw.includes('ownerRouteSaves'), false);
  const restored = makeStore(storage);
  await restored.runOwnerRouteSave('owner-a', async () => { calls.push('restored-a'); });
  release();
  await Promise.all([failure, second]);
  assert.deepEqual(calls, ['a-first', 'b', 'restored-a', 'a-second']);
});

test('task drafts persist pending axes with their declared identity and drop malformed entries', () => {
  const storage = createMemoryStorage();
  const store = makeStore(storage);
  const task = store.createTask({ capabilityContract: 'image.generate', source: SOURCE });
  store.updateTask(task.taskId, () => ({
    draft: {
      recipeId: 'image.recipe',
      route: 'local',
      pendingAxes: [
        {
          slotId: 'main.diffusion',
          contentId: 'sha256:pending-content',
          expectedHash: 'sha256:ff',
          templateId: 'complete-model-template',
          source: { repo: 'example/image', revision: 'main', file: 'model.gguf', sizeBytes: 2048 },
        },
      ],
    },
  }));

  const persisted = JSON.parse(storage.read(RUNTIME_SETUP_TASKS_STORAGE_KEY)!) as { tasks: { draft: Record<string, unknown> }[] };
  assert.deepEqual(persisted.tasks[0]!.draft.pendingAxes, [
    {
      slotId: 'main.diffusion',
      contentId: 'sha256:pending-content',
      expectedHash: 'sha256:ff',
      templateId: 'complete-model-template',
      source: { repo: 'example/image', revision: 'main', file: 'model.gguf', sizeBytes: 2048 },
    },
  ]);

  assert.equal(makeStore(storage).getTask(task.taskId)?.draft?.pendingAxes?.[0]?.templateId, 'complete-model-template');

  // Malformed pending axes (missing identity, half-shaped source) are dropped.
  persisted.tasks[0]!.draft.pendingAxes = [
    { slotId: 'main.diffusion', contentId: 'sha256:pending-content', expectedHash: 'sha256:ff' },
    { slotId: '', contentId: '' },
    { slotId: 'broken' },
    { slotId: 'half-source', contentId: 'sha256:x', source: { repo: 'example/image' } },
  ];
  storage.setItem(RUNTIME_SETUP_TASKS_STORAGE_KEY, JSON.stringify(persisted));

  const restored = makeStore(storage);
  assert.deepEqual(restored.getTask(task.taskId)?.draft?.pendingAxes, [
    { slotId: 'main.diffusion', contentId: 'sha256:pending-content', expectedHash: 'sha256:ff' },
    { slotId: 'half-source', contentId: 'sha256:x' },
  ]);
});

test('restart retains partial completion and portable cloud recommendation', () => {
  const storage = createMemoryStorage();
  const store = makeStore(storage);
  const task = store.createTask({ capabilityContract: 'text.generate', source: SOURCE });
  const recommendation = {
    implementation: { implementationId: 'cloud.text', driverId: 'driver.text', driverDialect: 'text/v1' },
    providerModelTarget: { providerModelId: 'shared-model' },
  };
  store.updateTask(task.taskId, () => ({
    status: 'failed',
    failure: { stage: 'save-route', message: 'response lost', machineSelected: true, ownerSaveState: 'unknown' },
    draft: { route: 'cloud', cloudRecommendation: recommendation },
  }));
  const restored = makeStore(storage).getTask(task.taskId)!;
  assert.deepEqual(restored.draft?.cloudRecommendation, recommendation);
  assert.deepEqual(restored.failure, {
    stage: 'save-route', message: 'response lost', machineSelected: true, ownerSaveState: 'unknown',
  });
});
