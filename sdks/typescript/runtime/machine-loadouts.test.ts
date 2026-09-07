import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LoadoutValidationState,
  LocalCapabilityReason,
  LocalCapabilityRequirementPresence,
  LocalCapabilityRequirementResolution,
  LocalRecommendationApplicability,
  TextBehaviorConfigurationState,
  TextBehaviorKind,
  ToolChoiceMode,
  ToolSpecKind,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import {
  createNimiMachineLoadoutClient,
  type NimiMachineLoadoutRpcClient,
} from './machine-loadouts';

const contentId = `sha256:${'a'.repeat(64)}`;
const loadout = {
  loadoutId: 'loadout_1', capabilityContract: 'text.generate',
  implementation: { implementationId: 'local.text.generate.llama-cpp', driverId: 'nimi.runtime.driver.llama-cpp', driverDialect: 'llama.cpp/text-generate/v1' },
  recipeId: 'llama.text-generate.gemma-4-e2b-it.v1', recipeRevision: '1', options: undefined,
  modelAxes: [
    {
      slotId: 'main.gguf', displayLabel: 'Main model', modelAssetId: 'model_1', expectedContentId: contentId,
      recipeCompatible: true, reasons: [], presence: LocalCapabilityRequirementPresence.REQUIRED,
      conditionalFeatures: [], resolution: LocalCapabilityRequirementResolution.CONFIGURED,
    },
    {
      slotId: 'companion.mmproj', displayLabel: 'Vision projector', modelAssetId: '', expectedContentId: '',
      recipeCompatible: true, reasons: [], presence: LocalCapabilityRequirementPresence.OPTIONAL_CONDITIONAL,
      conditionalFeatures: ['input.image'], resolution: LocalCapabilityRequirementResolution.NOT_CONFIGURED,
    },
  ],
  recipeCustody: [], implementationSupportedFeatures: ['input.image'], configuredFeatures: [],
  textBehaviors: [{
    kind: TextBehaviorKind.TOOL_USE,
    implementationSupported: true,
    configurationState: TextBehaviorConfigurationState.CONFIGURED,
    reasons: [LocalCapabilityReason.CONDITIONAL_BINDING_MISSING],
    implementationToolUse: {
      supportedToolSpecKinds: [ToolSpecKind.FUNCTION],
      supportedToolChoiceModes: [ToolChoiceMode.AUTO, ToolChoiceMode.TOOL],
      supportsSingleCall: true,
      supportsMultipleCalls: true,
      supportsParallelCalls: false,
      supportsSync: true,
      supportsStream: true,
      supportsToolOnlyResponse: true,
      supportsToolResultRoundTrip: true,
      supportsMixedTextAndToolCalls: true,
    },
    configuredToolUse: {
      supportedToolSpecKinds: [ToolSpecKind.FUNCTION],
      supportedToolChoiceModes: [ToolChoiceMode.AUTO],
      supportsSingleCall: true,
      supportsMultipleCalls: false,
      supportsParallelCalls: false,
      supportsSync: true,
      supportsStream: false,
      supportsToolOnlyResponse: true,
      supportsToolResultRoundTrip: true,
      supportsMixedTextAndToolCalls: false,
    },
  }],
  validationState: LoadoutValidationState.CONFIGURED,
  reasons: [], displayName: 'Gemma', provenance: undefined,
  createdAt: '2026-08-15T00:00:00Z', updatedAt: '2026-08-15T00:00:00Z',
};

const recipe = {
  recipeId: loadout.recipeId, revision: '1', title: 'Gemma 4 E2B text generation', capabilityContract: 'text.generate',
  implementation: loadout.implementation, defaultOptions: undefined, implementationSupportedFeatures: [],
  applicability: LocalRecommendationApplicability.SUPPORTED,
  reasons: [],
  slots: [
    {
      slotId: 'main.gguf', displayLabel: 'Main model', modelContract: undefined,
      recommendedContentIds: [contentId], recommendedVariantIds: ['variant_main'],
      offers: [{
        candidate: {
          offerRef: 'offer_main', sourceLabel: 'verified', title: 'Gemma', description: '',
          categories: ['chat'], modelType: 'chat', variantLabel: 'model.gguf', format: 'gguf',
          totalSizeBytes: 2048n, license: 'apache-2.0', tags: [], downloads: 10n, likes: 1n,
          lastModified: '', verified: true, installed: true, installable: true,
        },
        applicability: LocalRecommendationApplicability.SUPPORTED,
        reasons: [], installedModelAssetId: 'model_1',
      }], applicability: LocalRecommendationApplicability.SUPPORTED, reasons: [],
      presence: LocalCapabilityRequirementPresence.REQUIRED,
      conditionalFeatures: [],
    },
    {
      slotId: 'companion.mmproj', displayLabel: 'Vision projector', modelContract: undefined,
      recommendedContentIds: [], recommendedVariantIds: [],
      offers: [], applicability: LocalRecommendationApplicability.UNKNOWN, reasons: [],
      presence: LocalCapabilityRequirementPresence.OPTIONAL_CONDITIONAL,
      conditionalFeatures: ['input.image'],
    },
  ],
};

test('Loadout SDK exposes only prepare/commit/update/select/delete mutation semantics', async () => {
  const calls: Array<{ method: string; request: Record<string, unknown>; options?: RuntimeTypedCallOptions }> = [];
  const rpc = {
    async listLoadoutRecipes(request: Record<string, unknown>) { calls.push({ method: 'listLoadoutRecipes', request }); return { recipes: [recipe] }; },
    async getMachineLoadouts(request: Record<string, unknown>) { calls.push({ method: 'getMachineLoadouts', request }); return { aggregate: { loadouts: [loadout], selections: [] } }; },
    async getLoadout(request: Record<string, unknown>) { calls.push({ method: 'getLoadout', request }); return { loadout }; },
    async prepareLoadout(request: Record<string, unknown>, options?: RuntimeTypedCallOptions) { calls.push({ method: 'prepareLoadout', request, options }); return { prepareId: 'prepare_1', proposedLoadout: loadout, expiresAt: '2026-08-15T00:10:00Z', impact: { capabilityContract: 'text.generate', loadoutId: 'loadout_1', changesFutureLocalExecution: false, confirmationRequired: false } }; },
    async commitLoadout(request: Record<string, unknown>, options?: RuntimeTypedCallOptions) { calls.push({ method: 'commitLoadout', request, options }); return { loadout }; },
    async updateLoadout(request: Record<string, unknown>, options?: RuntimeTypedCallOptions) { calls.push({ method: 'updateLoadout', request, options }); return { loadout }; },
    async selectLoadout(request: Record<string, unknown>, options?: RuntimeTypedCallOptions) { calls.push({ method: 'selectLoadout', request, options }); return (request.loadoutId ? { selection: { capabilityContract: 'text.generate', loadoutId: 'loadout_1', effectiveDefaults: undefined } } : { selection: undefined }); },
    async deleteLoadout(request: Record<string, unknown>, options?: RuntimeTypedCallOptions) { calls.push({ method: 'deleteLoadout', request, options }); return {}; },
  } as unknown as NimiMachineLoadoutRpcClient;
  const client = createNimiMachineLoadoutClient({ runtime: rpc });
  assert.equal('clearSelection' in client, false);

  const listedRecipe = (await client.listRecipes('text.generate'))[0];
  assert.equal(listedRecipe?.recipeId, recipe.recipeId);
  assert.equal(listedRecipe?.applicability, 'supported');
  assert.deepEqual(listedRecipe?.slots[0], {
    slotId: 'main.gguf',
    displayLabel: 'Main model',
    recommendedContentIds: [contentId],
    recommendedVariantIds: ['variant_main'],
    offers: [{
      candidate: {
        offerRef: 'offer_main',
        sourceLabel: 'verified',
        title: 'Gemma',
        description: '',
        categories: ['chat'],
        modelType: 'chat',
        variantLabel: 'model.gguf',
        format: 'gguf',
        totalSizeBytes: 2048,
        license: 'apache-2.0',
        tags: [],
        downloads: 10,
        likes: 1,
        verified: true,
        installed: true,
        installable: true,
      },
      applicability: 'supported',
      reasons: [],
      installedModelAssetId: 'model_1',
    }],
    applicability: 'supported',
    reasons: [],
    modelContract: {},
    presence: 'required',
    conditionalFeatures: [],
  });
  assert.deepEqual(listedRecipe?.slots[1], {
    slotId: 'companion.mmproj',
    displayLabel: 'Vision projector',
    recommendedContentIds: [],
    recommendedVariantIds: [],
    offers: [],
    applicability: 'unknown',
    reasons: [],
    modelContract: {},
    presence: 'optional-conditional',
    conditionalFeatures: ['input.image'],
  });
  const projectedLoadout = await client.getLoadout('loadout_1');
  assert.deepEqual(projectedLoadout.modelAxes[0], {
    slotId: 'main.gguf',
    displayLabel: 'Main model',
    modelAssetId: 'model_1',
    expectedContentId: contentId,
    recipeCompatible: true,
    reasons: [],
    presence: 'required',
    conditionalFeatures: [],
    resolution: 'configured',
  });
  assert.deepEqual(projectedLoadout.modelAxes[1], {
    slotId: 'companion.mmproj',
    displayLabel: 'Vision projector',
    modelAssetId: '',
    expectedContentId: '',
    recipeCompatible: true,
    reasons: [],
    presence: 'optional-conditional',
    conditionalFeatures: ['input.image'],
    resolution: 'not-configured',
  });
  assert.deepEqual(projectedLoadout.implementationSupportedFeatures, ['input.image']);
  assert.deepEqual(projectedLoadout.configuredFeatures, []);
  assert.deepEqual(projectedLoadout.textBehaviors[0], {
    kind: 'tool-use',
    implementationSupported: true,
    configurationState: 'configured',
    reasons: ['CONDITIONAL_BINDING_MISSING'],
    implementationToolUse: {
      supportedToolSpecKinds: ['function'],
      supportedToolChoiceModes: ['auto', 'tool'],
      supportsSingleCall: true,
      supportsMultipleCalls: true,
      supportsParallelCalls: false,
      supportsSync: true,
      supportsStream: true,
      supportsToolOnlyResponse: true,
      supportsToolResultRoundTrip: true,
      supportsMixedTextAndToolCalls: true,
    },
    configuredToolUse: {
      supportedToolSpecKinds: ['function'],
      supportedToolChoiceModes: ['auto'],
      supportsSingleCall: true,
      supportsMultipleCalls: false,
      supportsParallelCalls: false,
      supportsSync: true,
      supportsStream: false,
      supportsToolOnlyResponse: true,
      supportsToolResultRoundTrip: true,
      supportsMixedTextAndToolCalls: false,
    },
  });
  const prepared = await client.prepare({ capabilityContract: 'text.generate', recipeId: recipe.recipeId, displayName: 'Gemma', modelAxes: [{ slotId: 'main.gguf', modelAssetId: 'model_1', expectedContentId: contentId }] });
  assert.equal(prepared.prepareId, 'prepare_1');
  const prepareCall = calls.find((call) => call.method === 'prepareLoadout');
  assert.deepEqual((prepareCall?.request.modelAxes as unknown[]).length, 1);
  assert.equal('path' in prepareCall!.request, false);
  assert.equal('engine' in prepareCall!.request, false);

  await client.commit('prepare_1');
  assert.deepEqual(calls.find((call) => call.method === 'commitLoadout')?.request, { prepareId: 'prepare_1', confirmedMachineImpact: false });
  await client.select('text.generate', 'loadout_1', true);
  await client.select('text.generate', null, true);
  await client.delete('loadout_1', true);
  assert.deepEqual(calls.filter((call) => call.method === 'selectLoadout').map((call) => call.request.loadoutId), ['loadout_1', '']);
});
