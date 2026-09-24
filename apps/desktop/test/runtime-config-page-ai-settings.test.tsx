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

test('an unconfirmed draft or review is neither surfaced nor a replacement of the ready model', () => {
  for (const pending of [{ ...task('draft'), candidateLoadoutId: undefined }, task('draft'), task('review')]) {
    const result = capabilityPreparationState({ capability, inventory: inventory(), tasks: [pending] });
    assert.equal(result.state, 'ready');
    assert.equal(result.replacement, false);
    assert.equal(result.task, undefined);
  }
});

test('a newer unconfirmed review does not hide a confirmed preparation that is still running', () => {
  const result = capabilityPreparationState({
    capability,
    inventory: inventory(false),
    tasks: [task('preparing'), task('review', 'C')],
  });
  assert.equal(result.state, 'preparing');
  assert.equal(result.task?.status, 'preparing');
});

test('completed replacement does not resurrect an older unfinished draft in the capability rail', () => {
  const result = capabilityPreparationState({ capability, inventory: inventory(), tasks: [task('draft'), task('done', 'A')] });
  assert.equal(result.state, 'ready');
  assert.equal(result.task, undefined);
});

test('downloaded recommended files are surfaced on an unset capability without claiming readiness', async () => {
  const { capabilityRecommendedFilesOnDevice } = await import(
    '../src/shell/renderer/features/runtime-config/runtime-capability-presentation.js'
  );
  // Only Runtime's exact installed-offer identity counts; equal content bytes
  // imported under another distribution do not.
  const recipe = (applicability: string, installedModelAssetId?: string) => ({
    recipeId: 'r',
    capabilityContract: capability,
    applicability,
    slots: [{
      presence: 'required', recommendedContentIds: ['c1'], recommendedVariantIds: ['v1'],
      offers: [{
        applicability: 'supported', reasons: [],
        candidate: { offerRef: 'offer-v1', installable: true, totalSizeBytes: 10, downloadSizeBytes: 6 },
        ...(installedModelAssetId ? { installedModelAssetId } : {}),
      }],
    }],
  });
  const helper = (recipes: unknown[]) => capabilityRecommendedFilesOnDevice(capability, recipes as never);
  assert.equal(helper([recipe('supported', 'asset-1')]), true);
  assert.equal(helper([recipe('supported')]), false);
  assert.equal(helper([recipe('unsupported', 'asset-1')]), false);
  assert.equal(helper([]), false);
  // Files on device never change the preparation state itself.
  assert.equal(
    capabilityPreparationState({ capability, inventory: inventory(false), tasks: [] }).state,
    'unset',
  );
});

test('the overview names the downloaded recipe and a direct enable only when nothing needs preparing', async () => {
  const { capabilityRecommendedRecipeOnDevice, setupPlanAllowsDirectUse } = await import(
    '../src/shell/renderer/features/runtime-config/runtime-capability-presentation.js'
  );
  const recipe = (recipeId: string, applicability: string, installed = true) => ({
    recipeId,
    capabilityContract: capability,
    applicability,
    slots: [{
      presence: 'required', recommendedContentIds: ['c1'], recommendedVariantIds: ['v1'],
      offers: [{
        applicability: 'supported', reasons: [],
        candidate: { offerRef: `offer-${recipeId}`, installable: true, totalSizeBytes: 10 },
        ...(installed ? { installedModelAssetId: `asset-${recipeId}` } : {}),
      }],
    }],
  });
  const pick = (recipes: unknown[]) => capabilityRecommendedRecipeOnDevice(capability, recipes as never);
  // The first supported recipe with every required offer installed wins; an
  // unsupported or incomplete recipe is skipped rather than blocking.
  assert.equal(pick([recipe('a', 'unsupported'), recipe('b', 'supported', false), recipe('c', 'supported')])?.recipeId, 'c');
  assert.equal(pick([recipe('a', 'supported', false)]), null);

  const plan = (overrides: Record<string, unknown>) => ({
    reuse: [], acquire: [], awaitingChoice: [], unavailable: [], components: [], options: [],
    environmentPlanId: 'env', candidateRevision: '1', selectionRevisionPresent: false,
    ...overrides,
  });
  assert.equal(setupPlanAllowsDirectUse(plan({}) as never), true);
  assert.equal(setupPlanAllowsDirectUse(plan({ acquire: [{ slotId: 's', label: '', offer: { installedModelAssetId: 'asset' } }] }) as never), true);
  // Anything that would download, install, ask or is unavailable keeps the review screen.
  assert.equal(setupPlanAllowsDirectUse(plan({ components: [{ dependencyFamily: 'f', dependencyId: 'd', label: '', state: 'missing', required: true }] }) as never), false);
  assert.equal(setupPlanAllowsDirectUse(plan({ acquire: [{ slotId: 's', label: '', offer: {} }] }) as never), false);
  assert.equal(setupPlanAllowsDirectUse(plan({ awaitingChoice: [{ slotId: 's', label: '', options: [] }] }) as never), false);
  assert.equal(setupPlanAllowsDirectUse(plan({ unavailable: [{ slotId: 's', label: '' }] }) as never), false);
  assert.equal(setupPlanAllowsDirectUse(plan({ environmentUnavailable: { reasonCode: 'AI_LOADOUT_DRIVER_UNAVAILABLE' } }) as never), false);
});
