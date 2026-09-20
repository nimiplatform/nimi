import assert from 'node:assert/strict';
import test from 'node:test';
import {
  capabilityPreparationState,
  type CapabilityInventory,
} from '../src/shell/renderer/features/runtime-config/runtime-capability-inventory.js';
import type { RuntimeSetupTask } from '../src/shell/renderer/features/runtime-config/runtime-setup-task-store.js';

const capability = 'image.generate';
function inventory(selected = true, ready = true): CapabilityInventory {
  return {
    aggregate: {
      loadouts: [{ loadoutId: 'A', capabilityContract: capability, validationState: 'configured' }],
      selections: selected ? [{ capabilityContract: capability, loadoutId: 'A' }] : [],
      selectionRevisions: {},
    },
    recipes: [],
    environments: {
      [capability]: {
        state: 'ready',
        dependencies: [{ required: true, state: ready ? 'ready_managed' : 'needs_confirmation' }],
      },
    },
  } as unknown as CapabilityInventory;
}

function task(status: RuntimeSetupTask['status'], candidate = 'B'): RuntimeSetupTask {
  return {
    taskId: 'task',
    capabilityContract: capability,
    status,
    candidateLoadoutId: candidate,
    source: { kind: 'runtime', accountId: 'a' },
    refs: { installPlanIds: [], transferIds: [], dependencyJobIds: [] },
    nextAction: 'choose-model',
    createdAt: '1',
    updatedAt: '1',
  };
}

test('saved resources without a current selection are not prepared for use', () => {
  assert.equal(
    capabilityPreparationState({ capability, inventory: inventory(false), tasks: [] }).state,
    'unset',
  );
});
test('a configured selection still requires its environment', () => {
  assert.equal(
    capabilityPreparationState({ capability, inventory: inventory(true, false), tasks: [] }).state,
    'attention',
  );
  assert.equal(capabilityPreparationState({ capability, inventory: inventory(), tasks: [] }).state, 'ready');
});
test('preparing or failing B preserves ready A and exposes the replacement', () => {
  for (const status of ['preparing', 'failed'] as const) {
    const result = capabilityPreparationState({ capability, inventory: inventory(), tasks: [task(status)] });
    assert.equal(result.state, 'ready');
    assert.equal(result.replacement, true);
    assert.equal(result.task?.status, status);
  }
});
test('after selection changed, partial consumer failure describes the actual current model', () => {
  const current = inventory();
  const result = capabilityPreparationState({
    capability,
    inventory: current,
    tasks: [
      {
        ...task('failed', 'A'),
        failure: { stage: 'save-route', message: 'save failed', machineSelected: true },
      },
    ],
  });
  assert.equal(result.state, 'ready');
  assert.equal(result.replacement, false);
  assert.equal(result.task?.failure?.machineSelected, true);
});

test('offline and unread state never become unset or a false ready claim', () => {
  assert.equal(
    capabilityPreparationState({ capability, inventory: inventory(), tasks: [], unavailable: true }).state,
    'unknown',
  );

  assert.equal(capabilityPreparationState({ capability, inventory: undefined, tasks: [] }).state, 'unknown');
});

test('a draft or prepare-only result does not mean a download is in progress', () => {
  for (const status of ['draft', 'review', 'prepared'] as const)
    assert.equal(
      capabilityPreparationState({ capability, inventory: inventory(false), tasks: [task(status)] }).state,
      'unset',
  );
  assert.equal(
    capabilityPreparationState({ capability, inventory: inventory(false), tasks: [task('preparing')] }).state,
    'preparing',
  );
});

test('completed replacement does not resurrect an older unfinished draft in the capability rail', () => {
  const result = capabilityPreparationState({ capability, inventory: inventory(), tasks: [task('draft'), task('done', 'A')] });
  assert.equal(result.state, 'ready');
  assert.equal(result.task, undefined);
});
