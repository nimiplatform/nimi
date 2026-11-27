import assert from 'node:assert/strict';
import test from 'node:test';
import type { NimiLoadoutRecipe, NimiMachineLoadout, NimiRuntimeLocalVerifiedAssetDescriptor, NimiRuntimeModelAssetRecord } from '@nimiplatform/sdk/runtime';
import { AppPackageJobPhase } from '@nimiplatform/sdk/runtime/wire-types';
import { capabilityModelIdentity, deriveLoadoutDefaultDisplayName, exactRecommendedSlotOffer, recipeResourceSummary, setupPlanNeedsPreparation } from '../src/shell/renderer/features/runtime-config/runtime-capability-presentation.js';
import type { RuntimeSetupPreparationPlan } from '../src/shell/renderer/features/runtime-config/runtime-setup-task-runner.js';
import { appJobLane, groupTransferAttempts, interruptionReasonKey, transferLane } from '../src/shell/renderer/features/runtime-config/global-downloads-presentation.js';

const fixtureImportUlid = '01' + 'A'.repeat(24);

const recipe = (contents: string[]) => ({
  recipeId: 'recipe', title: 'Readable model',
  slots: contents.map(content => ({ presence: 'required', recommendedContentIds: [content], recommendedVariantIds: [`variant-${content}`] })),
}) as unknown as NimiLoadoutRecipe;
const catalog = (contents: string[]) => contents.map(content => ({ contentId: content, templateId: `variant-${content}`, totalSizeBytes: 100 })) as NimiRuntimeLocalVerifiedAssetDescriptor[];

test('a sole installed offer for a different quant cannot satisfy an exact recommendation', () => {
  const slot = {
    recommendedVariantIds: ['variant-Q8'], recommendedContentIds: ['Q8'],
    offers: [{ applicability: 'supported', installedModelAssetId: 'asset-Q4', candidate: { title: 'Model', variantLabel: 'q4.gguf' } }],
  } as unknown as NimiLoadoutRecipe['slots'][number];
  const assets = [{ modelAssetId: 'asset-Q4', contentId: 'Q4', contentVerified: true }] as NimiRuntimeModelAssetRecord[];
  const descriptor = { ...catalog(['Q8'])[0]!, title: 'Model', entry: 'q8.gguf' };
  const result = exactRecommendedSlotOffer(slot, [descriptor], assets);
  assert.ok(result);
  assert.equal(result.offer, undefined);
  assert.equal(result.installedAsset, undefined);
  const available = {
    ...slot.offers[0]!, installedModelAssetId: '', candidate: { ...slot.offers[0]!.candidate, variantLabel: 'q8.gguf', installable: true },
  };
  const imported = [{ ...assets[0]!, contentId: 'Q8' }];
  const acquisition = exactRecommendedSlotOffer({ ...slot, offers: [available] }, [descriptor], imported);
  assert.equal(acquisition?.descriptor.templateId, 'variant-Q8');
  assert.equal(acquisition?.offer, undefined, 'a title and filename do not bind an opaque offer');
  assert.equal(acquisition?.installedAsset, undefined, 'identical bytes from another distribution do not waive the review');
});

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

test('generic recipe identity resolves bound model asset name and avoids guessing on shared catalog contentId', () => {
  const genericRecipe = {
    recipeId: 'llama.cpp/text-generate/v3',
    title: 'llama.cpp GGUF text generation',
    slots: [
      { slotId: 'main.gguf', presence: 'required', recommendedContentIds: [], recommendedVariantIds: [], offers: [] },
    ],
  } as unknown as NimiLoadoutRecipe;
  const boundLoadout = {
    recipeId: 'llama.cpp/text-generate/v3',
    displayName: 'llama.cpp GGUF text generation',
    modelAxes: [{ slotId: 'main.gguf', modelAssetId: 'asset-qwen', expectedContentId: 'sha256:qwen', presence: 'required' }],
  } as unknown as NimiMachineLoadout;
  const qwenAsset = {
    modelAssetId: 'asset-qwen',
    contentId: 'sha256:qwen',
    displayName: `Qwen3-8B-Q4_K_M-${fixtureImportUlid}`,
    entry: 'Qwen3-8B-Q4_K_M.gguf',
    totalSizeBytes: 5_000_000_000,
    contentVerified: true,
    files: [],
  } as unknown as NimiRuntimeModelAssetRecord;
  const identity = capabilityModelIdentity(boundLoadout, [genericRecipe], [], [qwenAsset]);
  assert.match(identity.shortTitle, /Qwen3/i);
  assert.ok(!identity.shortTitle.includes(fixtureImportUlid));
  assert.equal(deriveLoadoutDefaultDisplayName(genericRecipe, boundLoadout.modelAxes, [], [qwenAsset]), 'Qwen3 8B · Q4');

  // Shared contentId across two distinct logical models must NOT pick the first catalog entry blindly.
  const ambiguousCatalog = [
    { contentId: 'sha256:shared', templateId: 'tmpl-a', logicalModelId: 'model-a', title: 'Model A', entry: 'model.bin', totalSizeBytes: 100 },
    { contentId: 'sha256:shared', templateId: 'tmpl-b', logicalModelId: 'model-b', title: 'Model B', entry: 'model.bin', totalSizeBytes: 100 },
  ] as unknown as NimiRuntimeLocalVerifiedAssetDescriptor[];
  const sharedAsset = { ...qwenAsset, modelAssetId: 'asset-shared', contentId: 'sha256:shared', displayName: 'VeVo2 Voice' } as unknown as NimiRuntimeModelAssetRecord;
  const sharedLoadout = {
    ...boundLoadout,
    modelAxes: [{ slotId: 'main.gguf', modelAssetId: 'asset-shared', expectedContentId: 'sha256:shared', presence: 'required' }],
  } as unknown as NimiMachineLoadout;
  const sharedIdentity = capabilityModelIdentity(sharedLoadout, [genericRecipe], ambiguousCatalog, [sharedAsset]);
  assert.equal(sharedIdentity.descriptor, undefined);
  assert.equal(sharedIdentity.shortTitle, 'VeVo2 Voice');
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
  // Independent acquisitions stay distinct, with the most recently updated first.
  assert.deepEqual(groupTransferAttempts(rows).map((group) => group.latest.installSessionId), ['second', 'first']);
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

test('cleanAssetDisplayName strips both uppercase and lowercase importer ULID suffixes', async () => {
  const { cleanAssetDisplayName } = await import('../src/shell/renderer/features/runtime-config/runtime-config-loadout-model-display.js');
  assert.equal(cleanAssetDisplayName(`local-import-qwen3-4b-q4-k-m-${fixtureImportUlid.toLowerCase()}`), 'local-import-qwen3-4b-q4-k-m');
  assert.equal(cleanAssetDisplayName(`local-import-gemma-4-26b-a4b-it-q8-0-${fixtureImportUlid}`), 'local-import-gemma-4-26b-a4b-it-q8-0');
});
