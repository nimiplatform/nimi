import assert from 'node:assert/strict';
import test from 'node:test';
import type { NimiLoadoutRecipe, NimiMachineLoadout, NimiRuntimeLocalVerifiedAssetDescriptor, NimiRuntimeModelAssetRecord } from '@nimiplatform/sdk/runtime';
import { AppPackageJobPhase } from '@nimiplatform/sdk/runtime/wire-types';
import { capabilityModelIdentity, distinctSavedLoadouts, recipeResourceSummary, setupPlanNeedsPreparation } from '../src/shell/renderer/features/runtime-config/runtime-capability-presentation.js';
import type { RuntimeSetupPreparationPlan } from '../src/shell/renderer/features/runtime-config/runtime-setup-task-runner.js';
import { appJobLane, groupTransferAttempts, interruptionReasonKey, transferLane } from '../src/shell/renderer/features/runtime-config/global-downloads-presentation.js';

const recipe = (contents: string[]) => ({
  recipeId: 'recipe', title: 'Readable model',
  slots: contents.map(content => ({ presence: 'required', recommendedContentIds: [content], recommendedVariantIds: [`variant-${content}`] })),
}) as unknown as NimiLoadoutRecipe;
const catalog = (contents: string[]) => contents.map(content => ({ contentId: content, templateId: `variant-${content}`, totalSizeBytes: 100 })) as NimiRuntimeLocalVerifiedAssetDescriptor[];

test('model preparation distinguishes cached files from download cost and counts shared content once', () => {
  const result = recipeResourceSummary(recipe(['a', 'b', 'b']), catalog(['a', 'b']), [{ contentId: 'a', contentVerified: true }] as NimiRuntimeModelAssetRecord[]);
  assert.equal(result.bytes, 100);
  assert.equal(result.totalBytes, 200);
  assert.equal(result.ready, 1);
  assert.equal(result.missing, 1);
});

test('unknown or ambiguous model files never appear as a zero-byte download', () => {
  assert.equal(recipeResourceSummary(recipe(['a']), [], []).bytes, null);
  const source = recipe(['a']);
  const ambiguous = { ...source, slots: [{ ...source.slots[0]!, recommendedContentIds: ['a', 'b'] }] };
  assert.equal(recipeResourceSummary(ambiguous, catalog(['a', 'b']), []).bytes, null);
  const wrongVariant = [{ ...catalog(['a'])[0]!, templateId: 'another-variant' }];
  assert.equal(recipeResourceSummary(recipe(['a']), wrongVariant, []).totalBytes, null);
});

test('unverified local content still requires preparation', () => {
  const result = recipeResourceSummary(recipe(['a']), catalog(['a']), [{ contentId: 'a', contentVerified: false }] as unknown as NimiRuntimeModelAssetRecord[]);
  assert.equal(result.bytes, 100);
  assert.equal(result.ready, 0);
});

test('capability title preserves the model identity separately from a custom configuration name', () => {
  const result = capabilityModelIdentity({ recipeId: 'recipe', displayName: 'My custom settings', modelAxes: [] } as unknown as NimiMachineLoadout, [recipe([])]);
  assert.equal(result.title, 'Readable model');
  assert.equal(result.alias, 'My custom settings');
});

test('downloads separate interrupted work from canceled history and resumable work', () => {
  assert.equal(transferLane('failed'), 'attention');
  assert.equal(transferLane('cancelled'), 'history');
  assert.equal(transferLane('completed'), 'history');
  assert.equal(transferLane('paused'), 'active');
  assert.equal(appJobLane(AppPackageJobPhase.FAILED), 'attention');
  assert.equal(appJobLane(AppPackageJobPhase.CANCELED), 'history');
});

test('identical source labels and related content never merge independent acquisition identities', () => {
  const common = { modelAssetId: '', phase: 'download', bytesReceived: 0, bytesReused: 0, bytesVerified: 0,
    state: 'failed' as const, availableActions: [], cleanupPending: false, retryable: false, createdAt: '2026-09-20T00:00:00Z' };
  const rows = [
    { ...common, installSessionId: 'first', sourceLabel: 'same/name', sessionKind: 'download', updatedAt: '2026-09-20T00:00:00Z' },
    { ...common, installSessionId: 'second', sourceLabel: 'same/name', sessionKind: 'download', relatedInstallSessionId: 'first', updatedAt: '2026-09-20T00:01:00Z' },
  ] satisfies Parameters<typeof groupTransferAttempts>[0];
  assert.deepEqual(groupTransferAttempts(rows).map((group) => group.latest.installSessionId), ['first', 'second']);
});

test('content conflicts direct the user to the existing operation instead of retrying a new download', () => {
  assert.equal(interruptionReasonKey('AI_LOCAL_TRANSFER_RESUME_REQUIRED'), 'runtimeConfig.downloads.reason.resumeRequired');
  assert.equal(interruptionReasonKey('AI_LOCAL_TRANSFER_IN_PROGRESS'), 'runtimeConfig.downloads.reason.inProgress');
});

test('the use action only skips preparation wording when chosen files and required environment are already available', () => {
  const plan = { acquire: [], awaitingChoice: [], components: [] } as unknown as RuntimeSetupPreparationPlan;
  assert.equal(setupPlanNeedsPreparation(plan, {}), false);
  assert.equal(setupPlanNeedsPreparation({ ...plan, components: [{ required: true, state: 'missing', dependencyFamily: 'engine', dependencyId: 'engine', label: 'Engine' }] }, {}), true);
  const choicePlan = { ...plan, awaitingChoice: [{ slotId: 'main', label: 'Main', options: [{ offerRef: 'cached', installedModelAssetId: 'asset', title: 'Model', variantLabel: 'Variant', sizeBytes: 100 }] }] } satisfies RuntimeSetupPreparationPlan;
  assert.equal(setupPlanNeedsPreparation(choicePlan, {}), true);
  assert.equal(setupPlanNeedsPreparation(choicePlan, { main: 'cached' }), false);
});

test('saved configurations that run exactly the same thing are shown once, preferring the selected one', () => {
  const axes = [{ slotId: 'main.gguf', modelAssetId: 'asset-a', expectedContentId: 'sha256:a' }] as unknown as NimiMachineLoadout['modelAxes'];
  const same = (loadoutId: string, createdAt: string, extra: Partial<NimiMachineLoadout> = {}) => ({
    loadoutId, createdAt, capabilityContract: 'text.generate', recipeId: 'recipe', recipeRevision: '1',
    implementation: { implementationId: 'impl', driverId: 'driver', driverDialect: 'dialect' },
    options: {}, displayName: 'Gemma 4 text generation', modelAxes: axes,
    provenance: { desktop_setup_task_id: loadoutId }, ...extra,
  }) as unknown as NimiMachineLoadout;
  const loadouts = [
    same('newest', '2026-09-21T09:59:58Z'),
    same('oldest', '2026-09-21T07:44:11Z'),
    same('middle', '2026-09-21T08:24:31Z'),
    same('other-file', '2026-09-21T08:00:00Z', { modelAxes: [{ ...axes[0]!, modelAssetId: 'asset-b', expectedContentId: 'sha256:b' }] as unknown as NimiMachineLoadout['modelAxes'] }),
    same('renamed', '2026-09-21T08:00:00Z', { displayName: 'My tuned Gemma' }),
    same('tuned', '2026-09-21T08:00:00Z', { options: { temperature: 0.2 } }),
  ];
  // Without a selection the oldest exact duplicate stands for the group.
  assert.deepEqual(distinctSavedLoadouts(loadouts).map(item => item.loadoutId), ['oldest', 'other-file', 'renamed', 'tuned']);
  // The selected duplicate is the one shown, so its "current" badge stays visible.
  assert.deepEqual(distinctSavedLoadouts(loadouts, 'middle').map(item => item.loadoutId), ['middle', 'other-file', 'renamed', 'tuned']);
  // A selection outside the group leaves the group's survivor unchanged.
  assert.deepEqual(distinctSavedLoadouts(loadouts, 'tuned').map(item => item.loadoutId), ['oldest', 'other-file', 'renamed', 'tuned']);
});
