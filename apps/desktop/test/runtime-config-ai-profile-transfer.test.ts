import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type {
  NimiLoadoutRecipe,
  NimiMachineLoadout,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import { createNimiError } from '@nimiplatform/sdk/types';
import {
  executeRuntimeConfigAIProfileTransfer,
  exportRuntimeConfigAIProfileFromLoadouts,
  planRuntimeConfigAIProfileTransfer,
  selectRuntimeConfigAIProfileLoadouts,
} from '../src/shell/renderer/features/runtime-config/runtime-config-ai-profile-transfer.js';

const A = `sha256:${'a'.repeat(64)}`;
const B = `sha256:${'b'.repeat(64)}`;
const C = `sha256:${'c'.repeat(64)}`;
const D = `sha256:${'d'.repeat(64)}`;
const E = `sha256:${'e'.repeat(64)}`;

function asset(input: {
  readonly id: string;
  readonly contentId: string;
  readonly hash: string;
  readonly provenance?: Record<string, unknown>;
}): NimiRuntimeModelAssetRecord {
  return {
    modelAssetId: input.id,
    contentId: input.contentId,
    displayName: input.id,
    entry: 'model.gguf',
    files: [{ relativePath: 'model.gguf', sha256: input.hash.replace('sha256:', ''), sizeBytes: 100, nonExecutableContent: false }],
    totalSizeBytes: 100,
    contentVerified: true,
    catalogVerification: input.provenance ? 'matched' : 'not_matched',
    catalogVerified: Boolean(input.provenance),
    unclassified: false,
    provenance: input.provenance as never,
    createdAt: '2026-08-16T00:00:00Z',
    updatedAt: '2026-08-16T00:00:00Z',
    latestIntegrityCheckedAt: '2026-08-16T00:00:00Z',
    duplicateContent: false,
    containsNonExecutableCode: false,
  };
}

function recipe(input: {
  readonly id: string;
  readonly capability: string;
  readonly slots: readonly { readonly id: string; readonly contentId: string; readonly variantId: string }[];
}): NimiLoadoutRecipe {
  return {
    recipeId: input.id,
    revision: '1',
    title: input.id,
    capabilityContract: input.capability,
    implementation: { implementationId: 'local.test', driverId: 'driver.test', driverDialect: `${input.id}/v1` },
    defaultOptions: {},
    supportedFeatures: [],
    slots: input.slots.map((slot) => ({
      slotId: slot.id,
      displayLabel: slot.id,
      recommendedContentIds: [slot.contentId],
      recommendedVariantIds: [slot.variantId],
      modelContract: {},
    })),
  };
}

function loadoutProfile(expectedImageHash = C) {
  return {
    profileId: 'profile.transfer.test',
    title: 'Transfer test',
    capabilities: {
      'text.generate': {
        route: 'local',
        requiredFeatures: [],
        implementation: { implementationId: 'local.test', driverId: 'driver.test', driverDialect: 'text-recipe/v1', supportedFeatures: [] },
        loadout: {
          recipeId: 'text-recipe',
          axes: [{ slotId: 'model', contentId: A, expectedHash: A }],
          options: { contextSize: 4096 },
        },
      },
      'image.generate': {
        route: 'local',
        requiredFeatures: [],
        implementation: { implementationId: 'local.test', driverId: 'driver.test', driverDialect: 'image-recipe/v1', supportedFeatures: [] },
        loadout: {
          recipeId: 'image-recipe',
          axes: [{
            slotId: 'main',
            contentId: B,
            expectedHash: expectedImageHash,
            source: { repo: 'example/image', revision: 'main', file: 'model.gguf', sizeBytes: 200 },
          }],
          options: { steps: 4 },
        },
      },
    },
  } as const;
}

const RECIPES = [
  recipe({ id: 'text-recipe', capability: 'text.generate', slots: [{ id: 'model', contentId: A, variantId: 'text-v1' }] }),
  recipe({ id: 'image-recipe', capability: 'image.generate', slots: [{ id: 'main', contentId: B, variantId: 'image-v1' }] }),
];

const VERIFIED = [{
  templateId: 'image-v1',
  title: 'Image v1',
  contentId: B,
  repo: 'example/image',
  revision: 'main',
  entry: 'model.gguf',
  files: ['config.json', 'model.gguf'],
  hashes: { 'config.json': C, 'model.gguf': B },
  totalSizeBytes: 200,
}] as unknown as NimiRuntimeLocalVerifiedAssetDescriptor[];

function committedLoadout(capability: string, id: string, configured = true): NimiMachineLoadout {
  return {
    loadoutId: id,
    capabilityContract: capability,
    implementation: { implementationId: 'local.test', driverId: 'driver.test', driverDialect: `${capability}/v1` },
    recipeId: capability === 'text.generate' ? 'text-recipe' : 'image-recipe',
    recipeRevision: '1',
    options: {},
    modelAxes: [],
    recipeCustody: [],
    supportedFeatures: [],
    validationState: configured ? 'configured' : 'unresolved',
    reasons: [],
    displayName: id,
    provenance: {},
    createdAt: '2026-08-16T00:00:00Z',
    updatedAt: '2026-08-16T00:00:00Z',
  };
}

test('AIProfile plan matches existing content and aggregates only missing downloads with zero actions', async () => {
  const plan = await planRuntimeConfigAIProfileTransfer({
    profile: loadoutProfile(B),
    assets: [asset({ id: 'text-model', contentId: A, hash: A })],
    recipes: RECIPES,
    verifiedAssets: VERIFIED,
  });
  assert.equal(plan.networkStarted, false);
  assert.equal(plan.downloads.length, 1);
  assert.equal(plan.downloads[0]?.templateId, 'image-v1');
  assert.equal(plan.totalDownloadBytes, 200);
  assert.equal(
    plan.capabilities.find((item) => item.capabilityContract === 'text.generate')?.axes[0]?.state,
    'matched',
  );
});

test('AIProfile plan distinguishes zero downloads from an unknown aggregate size', async () => {
  const textAsset = asset({ id: 'text-model', contentId: A, hash: A });
  const imageAsset = asset({ id: 'image-model', contentId: B, hash: B });
  const allMatched = await planRuntimeConfigAIProfileTransfer({
    profile: loadoutProfile(B),
    assets: [textAsset, imageAsset],
    recipes: RECIPES,
    verifiedAssets: VERIFIED,
  });
  assert.equal(allMatched.downloads.length, 0);
  assert.equal(allMatched.totalDownloadBytes, 0);

  const unknownSize = await planRuntimeConfigAIProfileTransfer({
    profile: loadoutProfile(B),
    assets: [textAsset],
    recipes: RECIPES,
    verifiedAssets: [{ ...VERIFIED[0]!, totalSizeBytes: 0 }],
  });
  assert.equal(unknownSize.downloads.length, 1);
  assert.equal(unknownSize.downloads[0]?.sizeBytes, 0);
  assert.equal(unknownSize.totalDownloadBytes, null);
});

test('AIProfile transfer acquires one exact content identity once and binds every occurrence', async () => {
  const profile = loadoutProfile(B) as unknown as { capabilities: Record<string, Record<string, unknown>> };
  const textCapability = profile.capabilities['text.generate']!;
  const textLoadout = textCapability.loadout as { axes: readonly Record<string, unknown>[] };
  textCapability.loadout = {
    ...textLoadout,
    axes: [{
      slotId: 'model',
      contentId: B,
      expectedHash: B,
    }],
  };
  const imageCapability = profile.capabilities['image.generate']!;
  const imageLoadout = imageCapability.loadout as { axes: readonly Record<string, unknown>[] };
  imageCapability.loadout = {
    ...imageLoadout,
    axes: [{
      slotId: 'main',
      contentId: B,
      expectedHash: B,
      source: { repo: 'example/shared', revision: 'main', file: 'model.gguf', sizeBytes: 200 },
    }],
  };
  const recipes = [
    recipe({ id: 'text-recipe', capability: 'text.generate', slots: [{ id: 'model', contentId: B, variantId: 'shared-text-unavailable' }] }),
    recipe({ id: 'image-recipe', capability: 'image.generate', slots: [{ id: 'main', contentId: B, variantId: 'shared-image-unavailable' }] }),
  ];
  const verified: NimiRuntimeLocalVerifiedAssetDescriptor[] = [];
  const plan = await planRuntimeConfigAIProfileTransfer({
    profile: profile as never,
    assets: [],
    recipes,
    verifiedAssets: verified,
  });
  assert.equal(plan.downloads.length, 1);
  assert.equal(plan.totalDownloadBytes, 200);

  const installed = asset({ id: 'shared-model', contentId: B, hash: B });
  let resolveCalls = 0;
  let installCalls = 0;
  const resolveCapabilities: string[][] = [];
  const preparedAxes = new Map<string, readonly { readonly modelAssetId?: string }[]>();
  const result = await executeRuntimeConfigAIProfileTransfer({
    plan,
    assets: {
      async listModelAssets() { return []; },
      async listVerifiedAssets() { return verified; },
      async resolveInstallPlan(input) {
        resolveCalls += 1;
        resolveCapabilities.push([...(input.capabilities ?? [])]);
        return { planId: 'plan:shared-content' } as never;
      },
      async install() { installCalls += 1; return installed; },
    },
    loadouts: {
      async listRecipes() { return recipes; },
      async prepare(input: { capabilityContract: string; modelAxes?: readonly { readonly modelAssetId?: string }[] }) {
        preparedAxes.set(input.capabilityContract, input.modelAxes ?? []);
        return { prepareId: input.capabilityContract };
      },
      async commit(id: string) { return committedLoadout(id, `loadout:${id}`); },
      async select() { return null; },
    } as never,
    async applyAIProfile() {},
  });
  assert.equal(resolveCalls, 1);
  assert.equal(installCalls, 1);
  assert.deepEqual(resolveCapabilities, [['image.generate']]);
  assert.deepEqual(result.installedModelAssetIds, ['shared-model']);
  assert.equal(preparedAxes.get('text.generate')?.[0]?.modelAssetId, 'shared-model');
  assert.equal(preparedAxes.get('image.generate')?.[0]?.modelAssetId, 'shared-model');
});

test('content-only occurrences do not create conflicting acquisition intent for shared content', async () => {
  const profile = loadoutProfile(B) as unknown as { capabilities: Record<string, Record<string, unknown>> };
  const textCapability = profile.capabilities['text.generate']!;
  const textLoadout = textCapability.loadout as { axes: readonly Record<string, unknown>[] };
  textCapability.loadout = {
    ...textLoadout,
    axes: [{ slotId: 'model', contentId: B, expectedHash: C }],
  };
  const recipes = [
    recipe({ id: 'text-recipe', capability: 'text.generate', slots: [{ id: 'model', contentId: B, variantId: 'unavailable-text' }] }),
    recipe({ id: 'image-recipe', capability: 'image.generate', slots: [{ id: 'main', contentId: B, variantId: 'unavailable-image' }] }),
  ];
  const plan = await planRuntimeConfigAIProfileTransfer({
    profile: profile as never,
    assets: [],
    recipes,
    verifiedAssets: [],
  });
  assert.equal(plan.downloads.length, 1);
  assert.equal(plan.downloads[0]?.capabilityContract, 'image.generate');
});

test('AIProfile plan fails closed when one content identity has conflicting acquisition intent', async () => {
  const profile = loadoutProfile(B) as unknown as { capabilities: Record<string, Record<string, unknown>> };
  const textCapability = profile.capabilities['text.generate']!;
  const textLoadout = textCapability.loadout as { axes: readonly Record<string, unknown>[] };
  textCapability.loadout = {
    ...textLoadout,
    axes: [{
      slotId: 'model',
      contentId: B,
      expectedHash: B,
      source: { repo: 'example/shared-text', revision: 'main', file: 'model.gguf', sizeBytes: 200 },
    }],
  };
  const recipes = [
    recipe({ id: 'text-recipe', capability: 'text.generate', slots: [{ id: 'model', contentId: B, variantId: 'shared-text-v1' }] }),
    recipe({ id: 'image-recipe', capability: 'image.generate', slots: [{ id: 'main', contentId: B, variantId: 'shared-image-v1' }] }),
  ];
  const verified = [
    {
      templateId: 'shared-text-v1', title: 'Shared text', contentId: B,
      repo: 'example/shared-text', revision: 'main', entry: 'model.gguf', files: ['model.gguf'],
      hashes: { 'model.gguf': B }, totalSizeBytes: 200,
    },
    {
      templateId: 'shared-image-v1', title: 'Shared image', contentId: B,
      repo: 'example/image', revision: 'main', entry: 'model.gguf', files: ['model.gguf'],
      hashes: { 'model.gguf': B }, totalSizeBytes: 200,
    },
  ] as unknown as NimiRuntimeLocalVerifiedAssetDescriptor[];
  await assert.rejects(
    planRuntimeConfigAIProfileTransfer({ profile: profile as never, assets: [], recipes, verifiedAssets: verified }),
    /conflicting acquisition intent/u,
  );
});

test('AIProfile plan keeps a rejected portable source and rejects a conflicting shared acquisition before network', async () => {
  const profile = loadoutProfile(C) as unknown as { capabilities: Record<string, Record<string, unknown>> };
  const textCapability = profile.capabilities['text.generate']!;
  const textLoadout = textCapability.loadout as { axes: readonly Record<string, unknown>[] };
  textCapability.loadout = {
    ...textLoadout,
    axes: [{
      slotId: 'model',
      contentId: B,
      expectedHash: C,
      source: { repo: 'example/other', revision: 'main', file: 'config.json', sizeBytes: 200 },
    }],
  };
  const recipes = [
    recipe({ id: 'text-recipe', capability: 'text.generate', slots: [{ id: 'model', contentId: B, variantId: 'missing-text' }] }),
    recipe({ id: 'image-recipe', capability: 'image.generate', slots: [{ id: 'main', contentId: B, variantId: 'image-v1' }] }),
  ];

  await assert.rejects(
    planRuntimeConfigAIProfileTransfer({
      profile: profile as never,
      assets: [],
      recipes,
      verifiedAssets: VERIFIED,
    }),
    /conflicting acquisition intent/u,
  );
});

test('confirmed AIProfile transfer reuses content, installs missing content, commits capabilities, then selects only after separate confirmation', async () => {
  const calls: string[] = [];
  const textAsset = asset({ id: 'text-model', contentId: A, hash: A });
  const imageAsset = asset({ id: 'image-model', contentId: B, hash: B });
  const plan = await planRuntimeConfigAIProfileTransfer({
    profile: loadoutProfile(B),
    assets: [textAsset],
    recipes: RECIPES,
    verifiedAssets: VERIFIED,
  });
  const prepared = new Map<string, string>();
  const loadouts = {
    async listRecipes() { return RECIPES; },
    async prepare(input: { capabilityContract: string }) {
      calls.push(`prepare:${input.capabilityContract}`);
      const id = `prepare:${input.capabilityContract}`;
      prepared.set(id, input.capabilityContract);
      return { prepareId: id };
    },
    async commit(prepareId: string) {
      const capability = prepared.get(prepareId)!;
      calls.push(`commit:${capability}`);
      return committedLoadout(capability, `loadout:${capability}`);
    },
    async select(capability: string, loadoutId: string) {
      calls.push(`select:${capability}:${loadoutId}`);
      return null;
    },
  };
  const result = await executeRuntimeConfigAIProfileTransfer({
    plan,
    assets: {
      async listModelAssets() { calls.push('list-assets'); return [textAsset, imageAsset]; },
      async listVerifiedAssets() { return VERIFIED; },
      async resolveInstallPlan(input) { return { planId: `plan:${input.templateId}` } as never; },
      async install() { calls.push('install:image-v1'); return imageAsset; },
    },
    loadouts: loadouts as never,
    async applyAIProfile() { calls.push('apply-ai-config'); },
  });
  assert.equal(result.capabilities.filter((item) => item.state === 'committed').length, 2);
  assert.equal(result.installedModelAssetIds.length, 1);
  assert.ok(calls.indexOf('commit:image.generate') < calls.indexOf('install:image-v1'), 'resumable unresolved Loadout must be durable before transfer');
  assert.equal(calls.some((call) => call.startsWith('select:')), false);
  await selectRuntimeConfigAIProfileLoadouts({ result, loadouts: loadouts as never });
  assert.equal(calls.filter((call) => call.startsWith('select:')).length, 2);
});

test('source-backed acquisition preserves recipe capability and starts confirmed downloads in parallel', async () => {
  const profile = loadoutProfile(B) as unknown as { capabilities: Record<string, Record<string, unknown>> };
  const textCapability = profile.capabilities['text.generate']!;
  const textLoadout = textCapability.loadout as { axes: readonly Record<string, unknown>[] };
  textCapability.loadout = {
    ...textLoadout,
    axes: textLoadout.axes.map((axis) => ({
      ...axis,
      source: { repo: 'example/text', revision: 'main', file: 'model.gguf', sizeBytes: 100 },
    })),
  };
  const recipes = RECIPES.map((item) => ({
    ...item,
    slots: item.slots.map((slot) => ({ ...slot, recommendedContentIds: [], recommendedVariantIds: [] })),
  }));
  const plan = await planRuntimeConfigAIProfileTransfer({
    profile: profile as never,
    assets: [],
    recipes,
    verifiedAssets: [],
  });
  assert.equal(plan.downloads.length, 2);

  const resolvedInputs: { repo?: string; capabilities?: readonly string[] }[] = [];
  const installStarted: string[] = [];
  const releaseInstall = new Map<string, () => void>();
  const execution = executeRuntimeConfigAIProfileTransfer({
    plan,
    assets: {
      async listModelAssets() { return []; },
      async listVerifiedAssets() { return []; },
      async resolveInstallPlan(input) {
        resolvedInputs.push(input);
        return { planId: `plan:${input.repo}` } as never;
      },
      async install(planId) {
        installStarted.push(planId);
        await new Promise<void>((resolve) => releaseInstall.set(planId, resolve));
        return planId.endsWith('example/text')
          ? asset({ id: 'downloaded-text', contentId: A, hash: A })
          : asset({ id: 'downloaded-image', contentId: B, hash: B });
      },
    },
    loadouts: {
      async listRecipes() { return recipes; },
      async prepare(input: { capabilityContract: string }) { return { prepareId: input.capabilityContract }; },
      async commit(id: string) { return committedLoadout(id, `loadout:${id}`); },
      async select() { return null; },
    } as never,
    async applyAIProfile() {},
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(installStarted.sort(), ['plan:example/image', 'plan:example/text']);
  assert.deepEqual(
    resolvedInputs.map((input) => [input.repo, input.capabilities]).sort(),
    [['example/image', ['image.generate']], ['example/text', ['text.generate']]],
  );
  for (const release of releaseInstall.values()) release();
  const result = await execution;
  assert.equal(result.installedModelAssetIds.length, 2);
});

test('a multi-file sibling hash cannot satisfy the declared source-file integrity', async () => {
  const textAsset = asset({ id: 'text-model', contentId: A, hash: A });
  const imageAsset: NimiRuntimeModelAssetRecord = {
    ...asset({ id: 'image-model', contentId: B, hash: B }),
    files: [
      { relativePath: 'model.gguf', sha256: normalizeTestHash(B), sizeBytes: 100, nonExecutableContent: false },
      { relativePath: 'config.json', sha256: normalizeTestHash(C), sizeBytes: 20, nonExecutableContent: false },
    ],
    totalSizeBytes: 120,
  };
  const existingPlan = await planRuntimeConfigAIProfileTransfer({
    profile: loadoutProfile(C),
    assets: [textAsset, imageAsset],
    recipes: RECIPES,
    verifiedAssets: VERIFIED,
  });
  assert.equal(
    existingPlan.capabilities.find((item) => item.capabilityContract === 'image.generate')?.axes[0]?.state,
    'hash-mismatch',
  );
  const plan = await planRuntimeConfigAIProfileTransfer({
    profile: loadoutProfile(C),
    assets: [textAsset],
    recipes: RECIPES,
    verifiedAssets: VERIFIED,
  });
  const plannedAxis = plan.capabilities.find((item) => item.capabilityContract === 'image.generate')?.axes[0];
  assert.equal(plannedAxis?.state, 'content-only');
  assert.equal(plannedAxis?.reasonCode, 'AI_PROFILE_MODEL_SOURCE_REQUIRED');
  assert.equal(plan.downloads.length, 0);
});

test('declared integrity follows source.file even when it is not the ModelAsset entry', async () => {
  const profile = loadoutProfile(C) as unknown as { capabilities: Record<string, Record<string, unknown>> };
  const imageCapability = profile.capabilities['image.generate']!;
  const imageLoadout = imageCapability.loadout as { axes: readonly Record<string, unknown>[] };
  imageCapability.loadout = {
    ...imageLoadout,
    axes: [{
      slotId: 'main',
      contentId: B,
      expectedHash: C,
      source: { repo: 'example/image', revision: 'main', file: 'config.json', sizeBytes: 120 },
    }],
  };
  const imageAsset: NimiRuntimeModelAssetRecord = {
    ...asset({ id: 'image-model', contentId: B, hash: B }),
    files: [
      { relativePath: 'model.gguf', sha256: normalizeTestHash(B), sizeBytes: 100, nonExecutableContent: false },
      { relativePath: 'config.json', sha256: normalizeTestHash(C), sizeBytes: 20, nonExecutableContent: false },
    ],
    totalSizeBytes: 120,
  };
  const plan = await planRuntimeConfigAIProfileTransfer({
    profile: profile as never,
    assets: [asset({ id: 'text-model', contentId: A, hash: A }), imageAsset],
    recipes: RECIPES,
    verifiedAssets: VERIFIED,
  });
  assert.equal(
    plan.capabilities.find((item) => item.capabilityContract === 'image.generate')?.axes[0]?.state,
    'matched',
  );
});

test('interrupted acquisition keeps a visible unresolved Loadout that the next import resumes', async () => {
  const textAsset = asset({ id: 'text-model', contentId: A, hash: A });
  const plan = await planRuntimeConfigAIProfileTransfer({
    profile: loadoutProfile(B),
    assets: [textAsset],
    recipes: RECIPES,
    verifiedAssets: VERIFIED,
  });
  const prepared: { capabilityContract: string; loadoutId?: string }[] = [];
  const result = await executeRuntimeConfigAIProfileTransfer({
    plan,
    assets: {
      async listModelAssets() { return [textAsset]; },
      async listVerifiedAssets() { return VERIFIED; },
      async resolveInstallPlan(input) { return { planId: `plan:${input.templateId}` } as never; },
      async install() { throw new Error('AI_LOCAL_DOWNLOAD_HASH_MISMATCH: content identity transfer interrupted'); },
    },
    loadouts: {
      async listRecipes() { return RECIPES; },
      async prepare(input: { capabilityContract: string; loadoutId?: string }) {
        prepared.push(input);
        return { prepareId: `${input.capabilityContract}:${prepared.length}` };
      },
      async commit(id: string) {
        const capability = id.split(':')[0]!;
        const loadout = committedLoadout(capability, capability === 'image.generate' ? 'draft-image' : `loadout:${capability}`, capability !== 'image.generate');
        return capability === 'image.generate'
          ? { ...loadout, provenance: { source_profile_id: 'profile.transfer.test' } }
          : loadout;
      },
      async select() { return null; },
    } as never,
    async applyAIProfile() {},
  });
  const interrupted = result.capabilities.find((item) => item.capabilityContract === 'image.generate');
  assert.equal(interrupted?.loadout?.loadoutId, 'draft-image');
  assert.deepEqual(interrupted?.unresolvedSlotIds, ['main']);
  assert.equal(interrupted?.reasonCode, 'AI_PROFILE_MODEL_ACQUISITION_FAILED');
  assert.equal(prepared.filter((item) => item.capabilityContract === 'image.generate')[1]?.loadoutId, 'draft-image');

  const resumed = await planRuntimeConfigAIProfileTransfer({
    profile: plan.profile,
    assets: [textAsset],
    recipes: RECIPES,
    verifiedAssets: VERIFIED,
    loadouts: [interrupted!.loadout!],
  });
  assert.equal(resumed.capabilities.find((item) => item.capabilityContract === 'image.generate')?.existingLoadoutId, 'draft-image');
});

test('Runtime hash mismatch is classified by its exact structured reason', async () => {
  const textAsset = asset({ id: 'text-model', contentId: A, hash: A });
  const plan = await planRuntimeConfigAIProfileTransfer({
    profile: loadoutProfile(B),
    assets: [textAsset],
    recipes: RECIPES,
    verifiedAssets: VERIFIED,
  });
  const result = await executeRuntimeConfigAIProfileTransfer({
    plan,
    assets: {
      async listModelAssets() { return [textAsset]; },
      async listVerifiedAssets() { return VERIFIED; },
      async resolveInstallPlan(input) { return { planId: `plan:${input.templateId}` } as never; },
      async install() {
        throw createNimiError({
          message: 'download failed',
          reasonCode: 'AI_LOCAL_DOWNLOAD_HASH_MISMATCH',
          actionHint: 'repair_download',
        });
      },
    },
    loadouts: {
      async listRecipes() { return RECIPES; },
      async prepare(input: { capabilityContract: string }) { return { prepareId: input.capabilityContract }; },
      async commit(id: string) { return committedLoadout(id, `loadout:${id}`, id !== 'image.generate'); },
      async select() { return null; },
    } as never,
    async applyAIProfile() {},
  });
  assert.equal(
    result.capabilities.find((item) => item.capabilityContract === 'image.generate')?.reasonCode,
    'AI_PROFILE_MODEL_HASH_MISMATCH',
  );
});

test('unknown recipe produces typed upgrade result and never prepares a half Loadout', async () => {
  const profile = loadoutProfile(B) as unknown as { capabilities: Record<string, Record<string, unknown>> };
  profile.capabilities['image.generate']!.loadout = {
    ...(profile.capabilities['image.generate']!.loadout as object),
    recipeId: 'future-image-recipe',
  };
  const plan = await planRuntimeConfigAIProfileTransfer({ profile: profile as never, assets: [], recipes: RECIPES, verifiedAssets: VERIFIED });
  const prepared: string[] = [];
  const result = await executeRuntimeConfigAIProfileTransfer({
    plan,
    assets: {
      async listModelAssets() { return []; },
      async listVerifiedAssets() { return VERIFIED; },
      async resolveInstallPlan() { throw new Error('unexpected'); },
      async install() { throw new Error('unexpected'); },
    },
    loadouts: {
      async listRecipes() { return RECIPES; },
      async prepare(input: { capabilityContract: string }) { prepared.push(input.capabilityContract); return { prepareId: input.capabilityContract }; },
      async commit(id: string) { return committedLoadout(id, id); },
      async select() { return null; },
    } as never,
    async applyAIProfile() {},
  });
  assert.equal(result.capabilities.find((item) => item.capabilityContract === 'image.generate')?.reasonCode, 'AI_PROFILE_RECIPE_UPGRADE_REQUIRED');
  assert.equal(prepared.includes('image.generate'), false);
});

test('Profile supportedFeatures drift from the current Recipe fails closed', async () => {
  const profile = loadoutProfile(B) as unknown as { capabilities: Record<string, Record<string, unknown>> };
  const image = profile.capabilities['image.generate']!;
  image.implementation = {
    ...(image.implementation as object),
    supportedFeatures: ['output.image'],
  };
  const plan = await planRuntimeConfigAIProfileTransfer({
    profile: profile as never,
    assets: [],
    recipes: RECIPES,
    verifiedAssets: VERIFIED,
  });
  const capability = plan.capabilities.find((item) => item.capabilityContract === 'image.generate');
  assert.equal(capability?.state, 'upgrade-required');
  assert.equal(capability?.reasonCode, 'AI_PROFILE_RECIPE_IMPLEMENTATION_MISMATCH');
});

test('content-only axis commits as unresolved and becomes matched on a later inventory replan', async () => {
  const profile = loadoutProfile(B) as unknown as { capabilities: Record<string, Record<string, unknown>> };
  const image = profile.capabilities['image.generate']!;
  const loadout = image.loadout as { axes: readonly Record<string, unknown>[] };
  image.loadout = {
    ...loadout,
    axes: loadout.axes.map((axis) =>
      Object.fromEntries(Object.entries(axis).filter(([key]) => key !== 'source')),
    ),
  };
  const textAsset = asset({ id: 'text-model', contentId: A, hash: A });
  const initial = await planRuntimeConfigAIProfileTransfer({
    profile: profile as never,
    assets: [textAsset],
    recipes: RECIPES,
    verifiedAssets: VERIFIED,
  });
  const axis = initial.capabilities.find((item) => item.capabilityContract === 'image.generate')?.axes[0];
  assert.equal(axis?.state, 'content-only');
  assert.equal(axis?.reasonCode, 'AI_PROFILE_MODEL_SOURCE_REQUIRED');
  assert.equal(initial.downloads.length, 0);
  const preparedAxes = new Map<string, readonly { readonly slotId: string; readonly modelAssetId?: string; readonly expectedContentId?: string }[]>();
  const result = await executeRuntimeConfigAIProfileTransfer({
    plan: initial,
    assets: {
      async listModelAssets() { return [textAsset]; },
      async listVerifiedAssets() { return []; },
      async resolveInstallPlan() { throw new Error('unexpected'); },
      async install() { throw new Error('unexpected'); },
    },
    loadouts: {
      async listRecipes() { return RECIPES; },
      async prepare(input: { capabilityContract: string; modelAxes?: readonly { readonly slotId: string; readonly modelAssetId?: string; readonly expectedContentId?: string }[] }) {
        preparedAxes.set(input.capabilityContract, input.modelAxes ?? []);
        return { prepareId: input.capabilityContract };
      },
      async commit(id: string) {
        const axes = preparedAxes.get(id) ?? [];
        return committedLoadout(id, `loadout:${id}`, axes.length === 1 && Boolean(axes[0]?.modelAssetId));
      },
      async select() { return null; },
    } as never,
    async applyAIProfile() {},
  });
  const unresolvedImage = result.capabilities.find((item) => item.capabilityContract === 'image.generate');
  assert.deepEqual(unresolvedImage?.unresolvedSlotIds, ['main']);
  assert.equal(unresolvedImage?.reasonCode, 'AI_PROFILE_MODEL_SOURCE_REQUIRED');
  assert.deepEqual(preparedAxes.get('image.generate'), [{ slotId: 'main', expectedContentId: B }]);
  assert.equal(result.capabilities.find((item) => item.capabilityContract === 'text.generate')?.loadout?.validationState, 'configured');
  const selected: string[] = [];
  await selectRuntimeConfigAIProfileLoadouts({
    result,
    loadouts: {
      async select(capabilityContract: string, loadoutId: string) {
        selected.push(`${capabilityContract}:${loadoutId}`);
        return null;
      },
    } as never,
  });
  assert.deepEqual(selected, ['text.generate:loadout:text.generate']);

  const importedLater = asset({ id: 'image-imported-later', contentId: B, hash: B });
  const existingDraft = {
    ...committedLoadout('image.generate', 'loadout-existing-draft', false),
    provenance: { source_profile_id: 'profile.transfer.test' },
  };
  const resumed = await planRuntimeConfigAIProfileTransfer({
    profile: initial.profile,
    assets: [textAsset, importedLater],
    recipes: RECIPES,
    verifiedAssets: VERIFIED,
    loadouts: [existingDraft],
  });
  assert.equal(
    resumed.capabilities.find((item) => item.capabilityContract === 'image.generate')?.axes[0]?.state,
    'matched',
  );
  assert.equal(resumed.downloads.length, 0);
  assert.equal(
    resumed.capabilities.find((item) => item.capabilityContract === 'image.generate')?.existingLoadoutId,
    'loadout-existing-draft',
  );
});

test('reimport prepares an independent candidate instead of mutating the selected Loadout', async () => {
  const profile = loadoutProfile(B) as unknown as {
    capabilities: Record<string, unknown>;
  };
  delete profile.capabilities['image.generate'];
  const textAsset = asset({ id: 'text-model', contentId: A, hash: A });
  const selectedLoadout = {
    ...committedLoadout('text.generate', 'selected-profile-loadout'),
    provenance: { source_profile_id: 'profile.transfer.test' },
  };
  const plan = await planRuntimeConfigAIProfileTransfer({
    profile: profile as never,
    assets: [textAsset],
    recipes: RECIPES,
    verifiedAssets: VERIFIED,
    loadouts: [selectedLoadout],
    selectedLoadoutIds: [selectedLoadout.loadoutId],
  });
  assert.equal(plan.capabilities[0]?.existingLoadoutId, undefined);
  const confirmations: boolean[] = [];
  const preparedLoadoutIds: Array<string | undefined> = [];
  const importedCandidate = {
    ...committedLoadout('text.generate', 'imported-profile-candidate'),
    provenance: { source_profile_id: 'profile.transfer.test' },
  };
  const result = await executeRuntimeConfigAIProfileTransfer({
    plan,
    assets: {
      async listModelAssets() { return [textAsset]; },
      async listVerifiedAssets() { return VERIFIED; },
      async resolveInstallPlan() { throw new Error('unexpected'); },
      async install() { throw new Error('unexpected'); },
    },
    loadouts: {
      async listRecipes() { return RECIPES; },
      async prepare(input: { loadoutId?: string }) {
        preparedLoadoutIds.push(input.loadoutId);
        return {
          prepareId: 'prepare:imported-profile-candidate',
          proposedLoadout: importedCandidate,
          expiresAt: '2026-08-17T01:00:00Z',
          impact: {
            capabilityContract: 'text.generate',
            loadoutId: importedCandidate.loadoutId,
            changesFutureLocalExecution: false,
            confirmationRequired: false,
          },
        };
      },
      async commit(_prepareId: string, confirmedMachineImpact = false) {
        confirmations.push(confirmedMachineImpact);
        return importedCandidate;
      },
      async select() { return null; },
    } as never,
    confirmedMachineImpact: true,
    async applyAIProfile() {},
  });

  assert.deepEqual(preparedLoadoutIds, [undefined]);
  assert.deepEqual(confirmations, [false]);
  assert.equal(result.capabilities[0]?.state, 'committed');
  assert.equal(result.capabilities[0]?.loadout?.loadoutId, importedCandidate.loadoutId);
});

test('multi-file export preserves verified acquisition while manual content stays unresolved', async () => {
  const multiFileAsset = (
    id: string,
    contentId: string,
    entryHash: string,
    siblingHash: string,
    provenance?: Record<string, unknown>,
  ): NimiRuntimeModelAssetRecord => ({
    ...asset({ id, contentId, hash: entryHash, provenance }),
    entry: 'model.safetensors',
    files: [
      { relativePath: 'model.safetensors', sha256: normalizeTestHash(entryHash), sizeBytes: 100, nonExecutableContent: false },
      { relativePath: 'config.json', sha256: normalizeTestHash(siblingHash), sizeBytes: 20, nonExecutableContent: false },
    ],
    totalSizeBytes: 120,
  });
  const catalog = multiFileAsset('catalog-multi', C, A, B, {
    source_repo: 'example/catalog-multi', source_revision: 'catalog-revision', catalog_template_id: 'catalog-multi-template',
  });
  const provenance = {
    ...multiFileAsset('provenance-multi', D, B, C, {
      source_repo: 'example/provenance-multi', source_revision: 'provenance-revision',
    }),
    catalogVerification: 'not_matched' as const,
    catalogVerified: false,
  };
  const manual = multiFileAsset('manual-multi', E, C, A);
  const recipes = [
    recipe({ id: 'catalog-multi-recipe', capability: 'text.generate', slots: [{ id: 'model', contentId: C, variantId: 'catalog-multi-template' }] }),
    recipe({ id: 'provenance-multi-recipe', capability: 'image.generate', slots: [{ id: 'main', contentId: D, variantId: 'unavailable-recommendation' }] }),
    recipe({ id: 'manual-multi-recipe', capability: 'audio.synthesize', slots: [{ id: 'voice', contentId: E, variantId: 'manual-unavailable' }] }),
  ];
  const loadoutFor = (recipeValue: NimiLoadoutRecipe, assetValue: NimiRuntimeModelAssetRecord): NimiMachineLoadout => ({
    ...committedLoadout(recipeValue.capabilityContract, `loadout:${recipeValue.recipeId}`),
    recipeId: recipeValue.recipeId,
    implementation: recipeValue.implementation,
    modelAxes: [{
      slotId: recipeValue.slots[0]!.slotId,
      displayLabel: recipeValue.slots[0]!.displayLabel,
      modelAssetId: assetValue.modelAssetId,
      expectedContentId: assetValue.contentId,
      recipeCompatible: true,
      reasons: [],
    }],
  });
  const exported = exportRuntimeConfigAIProfileFromLoadouts({
    profileId: 'profile.multi-file',
    title: 'Multi-file portability',
    loadouts: [loadoutFor(recipes[0]!, catalog), loadoutFor(recipes[1]!, provenance), loadoutFor(recipes[2]!, manual)],
    assets: [catalog, provenance, manual],
  });
  const catalogAxis = exported.profile.capabilities['text.generate'];
  const provenanceAxis = exported.profile.capabilities['image.generate'];
  const manualAxis = exported.profile.capabilities['audio.synthesize'];
  assert.ok(catalogAxis?.route === 'local' && catalogAxis.loadout?.axes[0]?.source);
  assert.ok(provenanceAxis?.route === 'local' && provenanceAxis.loadout?.axes[0]?.source);
  assert.ok(manualAxis?.route === 'local' && !manualAxis.loadout?.axes[0]?.source);

  const verified = [
    {
      templateId: 'catalog-multi-template', contentId: C, repo: 'example/catalog-multi', revision: 'catalog-revision', entry: 'model.safetensors',
      files: ['config.json', 'model.safetensors'], hashes: { 'model.safetensors': A, 'config.json': B }, totalSizeBytes: 120,
    },
    {
      templateId: 'provenance-source-template', contentId: D, repo: 'example/provenance-multi', revision: 'provenance-revision', entry: 'model.safetensors',
      files: ['config.json', 'model.safetensors'], hashes: { 'model.safetensors': B, 'config.json': C }, totalSizeBytes: 120,
    },
  ] as unknown as NimiRuntimeLocalVerifiedAssetDescriptor[];
  const plan = await planRuntimeConfigAIProfileTransfer({
    profile: exported.profile,
    assets: [],
    recipes,
    verifiedAssets: verified,
  });
  assert.equal(plan.networkStarted, false);
  assert.deepEqual([...plan.downloads.map((axis) => axis.templateId)].sort(), ['catalog-multi-template', 'provenance-source-template']);
  const manualPlanAxis = plan.capabilities.find((item) => item.capabilityContract === 'audio.synthesize')?.axes[0];
  assert.equal(manualPlanAxis?.state, 'content-only');
  assert.equal(manualPlanAxis?.reasonCode, 'AI_PROFILE_MODEL_SOURCE_REQUIRED');
});

test('canonical multi-file acquisition accepts a declared source file that is not the bundle entry', async () => {
  const hashes = { 'config.json': B, 'model.safetensors': A };
  const contentId = canonicalBundleContentId(hashes);
  const plan = await planRuntimeConfigAIProfileTransfer({
    profile: portableMultiFileProfile(contentId, B, 'config.json'),
    assets: [],
    recipes: RECIPES,
    verifiedAssets: [verifiedMultiFileDescriptor('matching-multi-file', contentId, hashes)],
  });

  const axis = plan.capabilities[0]?.axes[0];
  assert.equal(axis?.state, 'download-required');
  assert.equal(axis?.templateId, 'matching-multi-file');
  assert.equal(plan.downloads.length, 1);
});

test('canonical multi-file acquisition selects the descriptor with the complete content identity', async () => {
  const expectedHashes = { 'config.json': B, 'model.safetensors': A };
  const conflictingHashes = { 'config.json': C, 'model.safetensors': A };
  const contentId = canonicalBundleContentId(expectedHashes);
  const plan = await planRuntimeConfigAIProfileTransfer({
    profile: portableMultiFileProfile(contentId, A, 'model.safetensors'),
    assets: [],
    recipes: RECIPES,
    verifiedAssets: [
      verifiedMultiFileDescriptor('wrong-aggregate', canonicalBundleContentId(conflictingHashes), conflictingHashes),
      verifiedMultiFileDescriptor('matching-aggregate', contentId, expectedHashes),
    ],
  });

  const axis = plan.capabilities[0]?.axes[0];
  assert.equal(axis?.state, 'download-required');
  assert.equal(axis?.templateId, 'matching-aggregate');
  assert.equal(plan.downloads.length, 1);
});

test('canonical multi-file acquisition stays content-only when no complete content identity matches', async () => {
  const expectedHashes = { 'config.json': B, 'model.safetensors': A };
  const conflictingHashes = { 'config.json': B, 'model.safetensors': C };
  const plan = await planRuntimeConfigAIProfileTransfer({
    profile: portableMultiFileProfile(canonicalBundleContentId(expectedHashes), B, 'config.json'),
    assets: [],
    recipes: RECIPES,
    verifiedAssets: [
      verifiedMultiFileDescriptor('wrong-aggregate', canonicalBundleContentId(conflictingHashes), conflictingHashes),
    ],
  });

  const axis = plan.capabilities[0]?.axes[0];
  assert.equal(axis?.state, 'content-only');
  assert.equal(axis?.reasonCode, 'AI_PROFILE_MODEL_SOURCE_REQUIRED');
  assert.equal(plan.downloads.length, 0);
});

function portableMultiFileProfile(contentId: string, expectedHash: string, file: string) {
  return {
    profileId: 'profile.portable-multi-file',
    title: 'Portable multi-file profile',
    capabilities: {
      'image.generate': {
        route: 'local',
        requiredFeatures: [],
        implementation: {
          implementationId: 'local.test',
          driverId: 'driver.test',
          driverDialect: 'image-recipe/v1',
          supportedFeatures: [],
        },
        loadout: {
          recipeId: 'image-recipe',
          axes: [{
            slotId: 'main',
            contentId,
            expectedHash,
            source: { repo: 'example/portable-multi', revision: 'revision-1', file, sizeBytes: 120 },
          }],
          options: { steps: 4 },
        },
      },
    },
  } as const;
}

function verifiedMultiFileDescriptor(
  templateId: string,
  contentId: string,
  hashes: Readonly<Record<string, string>>,
): NimiRuntimeLocalVerifiedAssetDescriptor {
  return {
    templateId,
    contentId,
    repo: 'example/portable-multi',
    revision: 'revision-1',
    entry: 'model.safetensors',
    files: ['config.json', 'model.safetensors'],
    hashes: { ...hashes },
    totalSizeBytes: 120,
  } as unknown as NimiRuntimeLocalVerifiedAssetDescriptor;
}

function canonicalBundleContentId(hashes: Readonly<Record<string, string>>): `sha256:${string}` {
  const digest = createHash('sha256');
  for (const relativePath of Object.keys(hashes).sort()) {
    digest.update(Buffer.from(normalizeTestHash(hashes[relativePath]!), 'hex'));
  }
  return `sha256:${digest.digest('hex')}`;
}

function normalizeTestHash(value: string): string {
  return value.replace('sha256:', '');
}

test('Loadout export strips machine ids and emits provenance-backed or content-only axes', () => {
  const catalog = asset({
    id: 'machine-private-catalog',
    contentId: A,
    hash: A,
    provenance: { source_repo: 'example/text', source_revision: 'main' },
  });
  const manual = asset({ id: 'machine-private-manual', contentId: B, hash: B });
  const text = { ...committedLoadout('text.generate', 'private-loadout-text'), modelAxes: [{ slotId: 'model', displayLabel: 'model', modelAssetId: catalog.modelAssetId, expectedContentId: A, recipeCompatible: true, reasons: [] }] };
  const image = { ...committedLoadout('image.generate', 'private-loadout-image'), modelAxes: [{ slotId: 'main', displayLabel: 'main', modelAssetId: manual.modelAssetId, expectedContentId: B, recipeCompatible: true, reasons: [] }] };
  const exported = exportRuntimeConfigAIProfileFromLoadouts({ profileId: 'profile.exported', title: 'Exported', loadouts: [text, image], assets: [catalog, manual] });
  assert.doesNotMatch(exported.artifactJson, /machine-private|modelAssetId|loadoutId/u);
  assert.equal(exported.profile.capabilities['text.generate']?.route, 'local');
  const textCapability = exported.profile.capabilities['text.generate'];
  const imageCapability = exported.profile.capabilities['image.generate'];
  assert.ok(textCapability?.route === 'local' && textCapability.loadout?.axes[0]?.source);
  assert.ok(imageCapability?.route === 'local' && !imageCapability.loadout?.axes[0]?.source);
});
