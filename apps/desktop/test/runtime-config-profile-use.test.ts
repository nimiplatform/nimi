import assert from 'node:assert/strict';
import test from 'node:test';

import { parseNimiPortableAIProfile } from '@nimiplatform/sdk/ai';

import {
  planRuntimeSetupProfileUse,
} from '../src/shell/renderer/features/runtime-config/runtime-config-profile-use.js';
import type {
  RuntimeConfigAIProfileTransferCapability,
  RuntimeConfigAIProfileTransferPlan,
} from '../src/shell/renderer/features/runtime-config/runtime-config-ai-profile-transfer.js';

const CONTENT = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function profile() {
  return parseNimiPortableAIProfile({
    profileId: 'profile.shared-1',
    title: 'Shared setup',
    capabilities: {
      'image.generate': {
        route: 'local',
        requiredFeatures: [],
        implementation: { implementationId: 'local.image', driverId: 'driver.image', driverDialect: 'image/v1', supportedFeatures: [] },
        loadout: {
          recipeId: 'image.recipe',
          axes: [{ slotId: 'main.diffusion', contentId: CONTENT, expectedHash: HASH }],
          options: { steps: 30 },
        },
      },
      'text.generate': {
        route: 'cloud',
        requiredFeatures: [],
        implementation: { implementationId: 'cloud.text', driverId: 'driver.openai', driverDialect: 'openai/v1', supportedFeatures: [] },
        providerModelTarget: { provider: 'openai', providerModelId: 'gpt-5', remoteModelCatalogId: 'catalog:gpt-5' },
      },
      'text.embed': {
        route: 'local',
        requiredFeatures: [],
      },
    },
  });
}

function transferCapability(overrides: Partial<RuntimeConfigAIProfileTransferCapability>): RuntimeConfigAIProfileTransferCapability {
  return {
    capabilityContract: 'image.generate',
    recipeId: 'image.recipe',
    state: 'ready',
    axes: [],
    ...overrides,
  } as RuntimeConfigAIProfileTransferCapability;
}

function transferPlan(capabilities: readonly RuntimeConfigAIProfileTransferCapability[]): RuntimeConfigAIProfileTransferPlan {
  return {
    profile: profile(),
    capabilities,
    downloads: [],
    totalDownloadBytes: null,
    networkStarted: false,
  };
}

test('a fully matched local capability yields an exact candidate input', () => {
  const plan = transferPlan([
    transferCapability({
      recipe: { recipeId: 'image.recipe', title: 'Image recipe' } as RuntimeConfigAIProfileTransferCapability['recipe'],
      axes: [{
        capabilityContract: 'image.generate',
        slotId: 'main.diffusion',
        contentId: CONTENT,
        expectedHash: HASH,
        displayLabel: 'Main model',
        sizeBytes: 1024,
        state: 'matched',
        modelAssetId: 'asset-1',
      }],
    }),
  ]);
  const result = planRuntimeSetupProfileUse({
    profile: plan.profile,
    subset: ['image.generate'],
    transferPlan: plan,
  });
  assert.equal(result.length, 1);
  const entry = result[0]!;
  assert.equal(entry.state, 'ready');
  assert.deepEqual(entry.candidate, {
    recipeId: 'image.recipe',
    options: { steps: 30 },
    axes: [{ slotId: 'main.diffusion', modelAssetId: 'asset-1', expectedContentId: CONTENT }],
    pendingAxes: [],
    displayName: 'Shared setup · Image recipe',
    provenance: { source_profile_id: 'profile.shared-1' },
  });
});

test('a download-required axis stays unbound and marks the capability as needing acquisition', () => {
  const plan = transferPlan([
    transferCapability({
      axes: [{
        capabilityContract: 'image.generate',
        slotId: 'main.diffusion',
        contentId: CONTENT,
        expectedHash: HASH,
        displayLabel: 'Main model',
        sizeBytes: 1024,
        state: 'download-required',
        templateId: 'template:q8',
      }],
    }),
  ]);
  const result = planRuntimeSetupProfileUse({
    profile: plan.profile,
    subset: ['image.generate'],
    transferPlan: plan,
  });
  assert.equal(result[0]?.state, 'needs-acquisition');
  assert.deepEqual(result[0]?.candidate?.axes, []);
  // The declared identity travels with the candidate so preparation acquires
  // exactly this content instead of a substituted recommendation.
  assert.deepEqual(result[0]?.candidate?.pendingAxes, [
    { slotId: 'main.diffusion', contentId: CONTENT, expectedHash: HASH, templateId: 'template:q8' },
  ]);
});

test('a download-required axis with a portable source carries the full acquisition identity', () => {
  const plan = transferPlan([
    transferCapability({
      axes: [{
        capabilityContract: 'image.generate',
        slotId: 'main.diffusion',
        contentId: CONTENT,
        expectedHash: HASH,
        displayLabel: 'Main model',
        sizeBytes: 2048,
        state: 'download-required',
        source: { repo: 'example/image', revision: 'main', file: 'model.gguf', sizeBytes: 2048 },
      }],
    }),
  ]);
  const result = planRuntimeSetupProfileUse({
    profile: plan.profile,
    subset: ['image.generate'],
    transferPlan: plan,
  });
  assert.equal(result[0]?.state, 'needs-acquisition');
  assert.deepEqual(result[0]?.candidate?.pendingAxes, [
    {
      slotId: 'main.diffusion',
      contentId: CONTENT,
      expectedHash: HASH,
      source: { repo: 'example/image', revision: 'main', file: 'model.gguf', sizeBytes: 2048 },
    },
  ]);
});

test('content-only and hash-mismatch axes report missing source with the axis reason', () => {
  const plan = transferPlan([
    transferCapability({
      axes: [{
        capabilityContract: 'image.generate',
        slotId: 'main.diffusion',
        contentId: CONTENT,
        expectedHash: HASH,
        displayLabel: 'Main model',
        sizeBytes: 0,
        state: 'content-only',
        reasonCode: 'AI_PROFILE_MODEL_SOURCE_REQUIRED',
      }],
    }),
  ]);
  const result = planRuntimeSetupProfileUse({
    profile: plan.profile,
    subset: ['image.generate'],
    transferPlan: plan,
  });
  assert.equal(result[0]?.state, 'missing-source');
  assert.equal(result[0]?.reasonCode, 'AI_PROFILE_MODEL_SOURCE_REQUIRED');
  assert.equal(result[0]?.candidate, undefined);
});

test('unsupported recipes, missing loadout intent, and cloud routes stay distinct', () => {
  const plan = transferPlan([
    transferCapability({
      capabilityContract: 'image.generate',
      state: 'upgrade-required',
      reasonCode: 'AI_PROFILE_RECIPE_UPGRADE_REQUIRED',
    }),
  ]);
  const result = planRuntimeSetupProfileUse({
    profile: plan.profile,
    subset: ['image.generate', 'text.generate', 'text.embed'],
    transferPlan: plan,
  });
  assert.deepEqual(result.map((entry) => [entry.capabilityContract, entry.state]), [
    ['image.generate', 'unsupported'],
    ['text.generate', 'cloud-requires-owner'],
    ['text.embed', 'no-local-intent'],
  ]);
});

test('cloud Profile use retains the portable model recommendation without a connection', () => {
  const imported = profile();
  const result = planRuntimeSetupProfileUse({ profile: imported, subset: ['text.generate'], transferPlan: transferPlan([]) });
  const intent = imported.capabilities['text.generate']!;
  assert.equal(intent.route, 'cloud');
  assert.equal(result[0]?.route, 'cloud');
  assert.deepEqual(result[0]?.cloudRecommendation, {
    implementation: intent.implementation, providerModelTarget: intent.providerModelTarget,
  });
  assert.equal('connectorRef' in result[0]!.cloudRecommendation!, false);
});
