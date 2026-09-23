import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  NimiLoadoutRecipe,
  NimiMachineLoadout,
  NimiRuntimeLocalEnvironmentPlan,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import {
  capabilityPreparationState,
  type CapabilityInventory,
} from '../src/shell/renderer/features/runtime-config/runtime-capability-inventory.js';
import {
  buildLocalModelList,
  configurableCapabilities,
} from '../src/shell/renderer/features/runtime-config/runtime-local-model-list.js';
import { loadoutPreparationStatus } from '../src/shell/renderer/features/runtime-config/runtime-local-model-status.js';
import type { RuntimeSetupTask } from '../src/shell/renderer/features/runtime-config/runtime-setup-task-store.js';

const asset = (id: string, contentId: string, entry = `${id}.gguf`): NimiRuntimeModelAssetRecord =>
  ({
    modelAssetId: id,
    contentId,
    displayName: entry,
    entry,
    files: [{ relativePath: entry, sha256: 'x', sizeBytes: 10, nonExecutableContent: false }],
    totalSizeBytes: 10,
    contentVerified: true,
    catalogVerification: 'unknown',
    catalogVerified: false,
    unclassified: false,
    createdAt: '',
    updatedAt: '',
    latestIntegrityCheckedAt: '',
    duplicateContent: false,
    containsNonExecutableCode: false,
  });

const descriptor = (
  contentId: string,
  title: string,
  entry: string,
  logicalModelId?: string,
): NimiRuntimeLocalVerifiedAssetDescriptor =>
  ({ contentId, title, entry, templateId: `t-${contentId}`, ...(logicalModelId ? { logicalModelId } : {}) }) as NimiRuntimeLocalVerifiedAssetDescriptor;

const recipe = (
  recipeId: string,
  capability: string,
  slots: readonly { slotId: string; installed: readonly string[]; applicability?: string }[],
  applicability = 'supported',
): NimiLoadoutRecipe =>
  ({
    recipeId,
    capabilityContract: capability,
    title: recipeId,
    applicability,
    slots: slots.map((slot) => ({
      slotId: slot.slotId,
      presence: 'required',
      recommendedContentIds: [],
      recommendedVariantIds: [],
      offers: slot.installed.map((installedModelAssetId) => ({
        installedModelAssetId,
        applicability: slot.applicability ?? 'supported',
        candidate: {},
        reasons: [],
      })),
    })),
  }) as unknown as NimiLoadoutRecipe;

const loadout = (
  loadoutId: string,
  capability: string,
  axes: readonly { slotId: string; modelAssetId: string }[],
  displayName = loadoutId,
  validationState: NimiMachineLoadout['validationState'] = 'configured',
): NimiMachineLoadout =>
  ({ loadoutId, capabilityContract: capability, displayName, validationState, modelAxes: axes }) as unknown as NimiMachineLoadout;

const plan = (dependencies: readonly { id: string; required: boolean; state: string }[], state = 'ready'): NimiRuntimeLocalEnvironmentPlan =>
  ({
    state,
    dependencies: dependencies.map((item) => ({ dependencyId: item.id, dependencyFamily: 'f', required: item.required, state: item.state })),
  }) as unknown as NimiRuntimeLocalEnvironmentPlan;

test('a variant without any Loadout has no configuration and lists what it can be configured for, by slot role', () => {
  const list = buildLocalModelList({
    assets: [asset('gemma-q4', 'c-gemma-q4'), asset('vae', 'c-vae')],
    catalog: [descriptor('c-gemma-q4', 'Gemma 4 text generation', 'gemma-4-e2b-it (Q4_K_M).gguf', 'gemma-4-e2b')],
    recipes: [
      recipe('r-text', 'text.generate', [{ slotId: 'main.gguf', installed: ['gemma-q4'] }]),
      recipe('r-image', 'image.generate', [
        { slotId: 'main.diffusion', installed: [] },
        { slotId: 'vae', installed: ['vae'] },
      ]),
    ],
    loadouts: [],
    selections: [],
  });
  const gemma = list.find((entry) => entry.modelKey === 'model:gemma-4-e2b');
  assert.ok(gemma);
  assert.equal(gemma.variants.length, 1);
  assert.equal(gemma.variants[0]!.configurations.length, 0);
  assert.deepEqual(gemma.variants[0]!.configurableFor.map((item) => [item.capability, item.role]), [['text.generate', 'model']]);
  assert.deepEqual(configurableCapabilities(gemma.variants[0]!), ['text.generate']);
  assert.equal(gemma.variants[0]!.quantLabel, 'Q4');
  assert.equal(gemma.variants[0]!.useNotIdentified, false);

  const vae = list.find((entry) => entry.modelKey === 'content:c-vae');
  assert.ok(vae);
  assert.deepEqual(vae.variants[0]!.configurableFor.map((item) => [item.capability, item.role]), [['image.generate', 'companion']]);
  // A companion-only match never offers the capability as something the model performs.
  assert.deepEqual(configurableCapabilities(vae.variants[0]!), []);
  assert.equal(vae.variants[0]!.useNotIdentified, false);
});

test('an unsupported recipe is not offered as configurable and the recipe bounds the slot applicability', () => {
  const list = buildLocalModelList({
    assets: [asset('a', 'c-a')],
    catalog: [],
    recipes: [recipe('r', 'text.generate', [{ slotId: 'main.gguf', installed: ['a'] }], 'unsupported')],
    loadouts: [],
    selections: [],
  });
  assert.equal(list[0]!.variants[0]!.configurableFor[0]!.applicability, 'unsupported');
  assert.deepEqual(configurableCapabilities(list[0]!.variants[0]!), []);
});

test('variants group only under a catalog logical model id; matching titles never merge', () => {
  const list = buildLocalModelList({
    assets: [asset('q4', 'c-q4'), asset('q8', 'c-q8'), asset('other', 'c-other')],
    catalog: [
      descriptor('c-q4', 'Gemma 4 text generation', 'gemma-4-e2b-it (Q4_K_M).gguf', 'gemma-4-e2b'),
      descriptor('c-q8', 'Gemma 4 text generation', 'gemma-4-e2b-it (Q8_0).gguf', 'gemma-4-e2b'),
      descriptor('c-other', 'Gemma 4 text generation', 'gemma-4-e2b-it (F16).gguf'),
    ],
    recipes: [],
    loadouts: [],
    selections: [],
  });
  const grouped = list.find((entry) => entry.modelKey === 'model:gemma-4-e2b');
  assert.ok(grouped);
  assert.deepEqual(grouped.variants.map((variant) => variant.quantLabel), ['Q4', 'Q8']);
  const separate = list.find((entry) => entry.modelKey === 'content:c-other');
  assert.ok(separate, 'a descriptor without logicalModelId stays its own entry even with the same title');
  assert.equal(separate.variants[0]!.quantLabel, 'F16');
});

test('assets sharing one content id show as one variant that keeps every asset id and its references', () => {
  const list = buildLocalModelList({
    assets: [asset('a1', 'c-shared'), asset('a2', 'c-shared')],
    catalog: [],
    recipes: [recipe('r', 'text.generate', [{ slotId: 'main.gguf', installed: ['a2'] }])],
    loadouts: [loadout('L1', 'text.generate', [{ slotId: 'main.gguf', modelAssetId: 'a1' }])],
    selections: [],
  });
  assert.equal(list.length, 1);
  const variant = list[0]!.variants[0]!;
  assert.deepEqual(variant.assetIds, ['a1', 'a2']);
  assert.deepEqual(variant.configurations.map((item) => item.loadoutId), ['L1']);
  assert.deepEqual(configurableCapabilities(variant), ['text.generate']);
});

test('several saved configurations for one variant and capability each keep their own row, default first', () => {
  const list = buildLocalModelList({
    assets: [asset('a', 'c-a')],
    catalog: [],
    recipes: [],
    loadouts: [
      loadout('L-custom', 'text.generate', [{ slotId: 'main.gguf', modelAssetId: 'a' }], 'Custom'),
      loadout('L-default', 'text.generate', [{ slotId: 'main.gguf', modelAssetId: 'a' }], 'Default'),
      loadout('L-embed', 'text.embed', [{ slotId: 'main.gguf', modelAssetId: 'a' }], 'Embed', 'unresolved'),
    ],
    selections: [{ capabilityContract: 'text.generate', loadoutId: 'L-default', effectiveDefaults: {} }],
  });
  const configurations = list[0]!.variants[0]!.configurations;
  assert.deepEqual(
    configurations.map((item) => [item.loadoutId, item.isDefault]),
    [['L-default', true], ['L-embed', false], ['L-custom', false]],
  );
  // Referenced by a Loadout but not offered by any recipe: still identified, not a use-not-identified row.
  assert.equal(list[0]!.variants[0]!.useNotIdentified, false);
});

test('equivalent saved configurations keep their own identities and status rows, default first', () => {
  const same = (loadoutId: string) => ({
    ...loadout(loadoutId, 'text.generate', [{ slotId: 'main.gguf', modelAssetId: 'a' }], 'Gemma 4 text generation'),
    recipeId: 'r', recipeRevision: '1', implementation: { implementationId: 'i' }, options: {}, createdAt: loadoutId,
  }) as unknown as NimiMachineLoadout;
  const list = buildLocalModelList({
    assets: [asset('a', 'c-a')],
    catalog: [],
    recipes: [],
    loadouts: [same('L1'), same('L2'), same('L3'), { ...same('L4'), displayName: 'Renamed' } as NimiMachineLoadout],
    selections: [{ capabilityContract: 'text.generate', loadoutId: 'L2', effectiveDefaults: {} }],
  });
  assert.deepEqual(
    list[0]!.variants[0]!.configurations.map((item) => [item.loadoutId, item.isDefault]),
    [['L2', true], ['L1', false], ['L3', false], ['L4', false]],
  );
});

test('an asset with no catalog match, no recipe offer and no Loadout is listed as use not identified', () => {
  const list = buildLocalModelList({
    assets: [asset('mystery', 'c-mystery', 'mystery-model.safetensors')],
    catalog: [],
    recipes: [],
    loadouts: [],
    selections: [],
  });
  assert.equal(list.length, 1);
  assert.equal(list[0]!.variants[0]!.useNotIdentified, true);
  assert.equal(list[0]!.variants[0]!.title, 'mystery-model');
  assert.equal(list[0]!.variants[0]!.format, 'Safetensors');
});

test('models with a default configuration list first, unidentified assets last', () => {
  const list = buildLocalModelList({
    assets: [asset('z-unknown', 'c-z'), asset('b', 'c-b'), asset('a', 'c-a')],
    catalog: [],
    recipes: [recipe('r', 'text.generate', [{ slotId: 'main.gguf', installed: ['a'] }])],
    loadouts: [loadout('L', 'text.generate', [{ slotId: 'main.gguf', modelAssetId: 'b' }])],
    selections: [{ capabilityContract: 'text.generate', loadoutId: 'L', effectiveDefaults: {} }],
  });
  assert.deepEqual(list.map((entry) => entry.modelKey), ['content:c-b', 'content:c-a', 'content:c-z']);
});

const configured = loadout('L', 'text.generate', []);

test('an unchecked, running or failed environment check is unknown, never prepared and never a missing-component diagnosis', () => {
  for (const check of [{ kind: 'not-checked' }, { kind: 'checking' }, { kind: 'failed', message: 'boom' }] as const) {
    const status = loadoutPreparationStatus({ loadout: configured, check });
    assert.equal(status.state, 'unknown');
    assert.deepEqual(status.missingDependencyIds, []);
  }
  assert.equal(loadoutPreparationStatus({ loadout: configured, check: { kind: 'not-checked' } }).reason, 'not-checked');
  assert.equal(loadoutPreparationStatus({ loadout: configured, check: { kind: 'failed' } }).reason, 'check-failed');
});

test('a completed check decides ready or attention from required dependencies and names the missing ones', () => {
  const ready = loadoutPreparationStatus({
    loadout: configured,
    check: { kind: 'checked', plan: plan([{ id: 'llama', required: true, state: 'ready_managed' }, { id: 'opt', required: false, state: 'missing' }]) },
  });
  assert.equal(ready.state, 'ready');
  const missing = loadoutPreparationStatus({
    loadout: configured,
    check: { kind: 'checked', plan: plan([{ id: 'llama', required: true, state: 'needs_confirmation' }]) },
  });
  assert.equal(missing.state, 'attention');
  assert.equal(missing.reason, 'environment-missing');
  assert.deepEqual(missing.missingDependencyIds, ['llama']);
  const unsupported = loadoutPreparationStatus({ loadout: configured, check: { kind: 'checked', plan: plan([], 'unsupported') } });
  assert.equal(unsupported.state, 'attention');
  assert.equal(unsupported.reason, 'environment-unsupported');
});

test('an incomplete configuration needs attention before any environment fact applies', () => {
  const status = loadoutPreparationStatus({
    loadout: loadout('L', 'text.generate', [], 'L', 'unresolved'),
    check: { kind: 'checked', plan: plan([{ id: 'llama', required: true, state: 'ready_managed' }]) },
  });
  assert.equal(status.state, 'attention');
  assert.equal(status.reason, 'configuration-incomplete');
});

test('a setup task targeting this Loadout reports preparing or attention, and only for this Loadout', () => {
  const task = (status: RuntimeSetupTask['status'], candidate: string): RuntimeSetupTask => ({
    taskId: `t-${candidate}`,
    capabilityContract: 'text.generate',
    status,
    candidateLoadoutId: candidate,
    source: { kind: 'runtime', accountId: 'a' },
    refs: { installPlanIds: [], transferIds: [], dependencyJobIds: [] },
    nextAction: 'choose-model',
    createdAt: '1',
    updatedAt: '1',
  });
  const readyPlan = plan([{ id: 'llama', required: true, state: 'ready_managed' }]);
  assert.equal(loadoutPreparationStatus({ loadout: configured, check: { kind: 'checked', plan: readyPlan }, tasks: [task('preparing', 'L')] }).state, 'preparing');
  assert.equal(loadoutPreparationStatus({ loadout: configured, check: { kind: 'checked', plan: readyPlan }, tasks: [task('failed', 'L')] }).state, 'attention');
  assert.equal(loadoutPreparationStatus({ loadout: configured, check: { kind: 'checked', plan: readyPlan }, tasks: [task('preparing', 'OTHER')] }).state, 'ready');
  assert.equal(loadoutPreparationStatus({ loadout: configured, check: { kind: 'checked', plan: readyPlan }, tasks: [task('done', 'L')] }).state, 'ready');
});

test('the same Loadout and plan yield the same state as the capability rail', () => {
  const capability = 'text.generate';
  for (const depState of ['ready_managed', 'needs_confirmation']) {
    const environment = plan([{ id: 'llama', required: true, state: depState }]);
    const inventory = {
      aggregate: { loadouts: [configured], selections: [{ capabilityContract: capability, loadoutId: 'L' }], selectionRevisions: {} },
      recipes: [],
      environments: { [capability]: environment },
    } as unknown as CapabilityInventory;
    const rail = capabilityPreparationState({ capability, inventory, tasks: [] }).state;
    const row = loadoutPreparationStatus({ loadout: configured, check: { kind: 'checked', plan: environment } }).state;
    assert.equal(row, rail);
  }
});
