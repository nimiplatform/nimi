import assert from 'node:assert/strict';
import test from 'node:test';

import * as authoringModule from './profile-authoring.js';
import {
  createNimiAIProfileAuthoringBuilder,
  createNimiAIProfileLocalImplementation,
  deriveNimiAIProfileApplyPreview,
  deriveNimiAIProfileImportPreview,
  deriveNimiAIProfileLocalConfigurationEquivalenceDigest,
  deriveNimiAIProfileLocalConfigurationPreview,
  deriveNimiAIProfilePortableContentDigest,
  deriveNimiAIProfileRequirementProjection,
  deriveNimiAIProfileSelectionMismatchPreview,
  importNimiAIProfileAuthoring,
  validateNimiAIProfileAuthoring,
  type NimiAIProfileAuthoringMachineProjection,
} from './profile-authoring.js';
import {
  parseNimiPortableAIProfile,
  serializeNimiPortableAIProfile,
  type NimiPortableAIProfile,
} from './config-profile.js';
import type { NimiLoadoutRecipe } from '../../runtime/machine-loadouts.js';

const TEXT_RECIPE: NimiLoadoutRecipe = Object.freeze({
  recipeId: 'recipe.test.text',
  revision: 'r3',
  title: 'Test text recipe',
  capabilityContract: 'text.generate',
  implementation: Object.freeze({
    implementationId: 'local.test.text-engine',
    driverId: 'nimi.runtime.driver.test-text',
    driverDialect: 'test/text/v3',
  }),
  defaultOptions: Object.freeze({ contextSize: 8192, scheduler: { kind: 'balanced' } }),
  supportedFeatures: Object.freeze(['input.image']),
  slots: Object.freeze([
    Object.freeze({
      slotId: 'main.weights',
      displayLabel: 'Main weights',
      recommendedContentIds: Object.freeze(['sha256:main']),
      recommendedVariantIds: Object.freeze(['variant.main']),
      modelContract: Object.freeze({ format: 'test-bundle', architecture: 'text-v3' }),
    }),
    Object.freeze({
      slotId: 'vision.projector',
      displayLabel: 'Vision projector',
      recommendedContentIds: Object.freeze([]),
      recommendedVariantIds: Object.freeze([]),
      modelContract: Object.freeze({ format: 'test-projector' }),
    }),
  ]),
});

function localTextBuilder(contextSize = 8192) {
  return createNimiAIProfileAuthoringBuilder({
    profileId: 'profile.authoring.local-text',
    title: 'Portable local text',
    description: 'Runtime Recipe-owned local text intent',
    provenance: { publisher: 'example.test', source: 'authoring-suite' },
    license: { name: 'Apache-2.0' },
    displayMetadata: { category: 'writing' },
  }).setLocalCapability({
    capabilityContract: 'text.generate',
    requiredFeatures: ['input.image'],
    defaults: { temperature: 0.4 },
    localConfiguration: createNimiAIProfileLocalImplementation({
      recipe: TEXT_RECIPE,
      portableConfig: {
        contextSize,
        scheduler: { kind: 'balanced' },
      },
    }),
  });
}

function localTextProfile(contextSize = 8192): NimiPortableAIProfile {
  return localTextBuilder(contextSize).build();
}

function cloneProfile(profile: NimiPortableAIProfile): Record<string, unknown> {
  return JSON.parse(serializeNimiPortableAIProfile(profile)) as Record<string, unknown>;
}

test('AIProfile authoring round-trips while Runtime Recipe owns Local identity and defaults', () => {
  const builder = localTextBuilder().setCloudCapability({
    capabilityContract: 'audio.synthesize',
    requiredFeatures: ['voice.reference'],
    defaults: { format: 'wav' },
    recommendation: {
      implementation: {
        implementationId: 'cloud.audio.example',
        driverId: 'nimi.runtime.driver.example-audio',
        driverDialect: 'example/audio/v1',
      },
      supportedFeatures: ['voice.reference'],
      providerModelTarget: {
        provider: 'example',
        providerModelId: 'voice-v1',
        remoteModelCatalogId: 'remote-model-catalog-voice-v1',
      },
    },
  });

  const built = builder.build();
  const local = built.capabilities['text.generate'];
  assert.equal(local?.route, 'local');
  if (local?.route !== 'local') assert.fail('expected Local capability');
  assert.deepEqual(local.implementation, {
    ...TEXT_RECIPE.implementation,
    supportedFeatures: ['input.image'],
  });
  assert.deepEqual(local.driverPortableConfig, {
    contextSize: 8192,
    scheduler: { kind: 'balanced' },
  });
  assert.deepEqual(parseNimiPortableAIProfile(builder.export()), built);

  const defaults = createNimiAIProfileAuthoringBuilder({
    profileId: 'profile.recipe-defaults',
    title: 'Recipe defaults',
    provenance: { publisher: 'example.test' },
    license: 'Apache-2.0',
  }).setLocalCapability({
    capabilityContract: 'text.generate',
    localConfiguration: { recipe: TEXT_RECIPE },
  }).build();
  const defaultCapability = defaults.capabilities['text.generate'];
  assert.equal(defaultCapability?.route, 'local');
  if (defaultCapability?.route !== 'local') assert.fail('expected Local capability');
  assert.deepEqual(defaultCapability.driverPortableConfig, TEXT_RECIPE.defaultOptions);

  const edited = importNimiAIProfileAuthoring(builder.export())
    .setTitle('Edited portable local text')
    .build();
  assert.equal(edited.title, 'Edited portable local text');
  assert.deepEqual(edited.capabilities, built.capabilities);
});

test('Local capability authoring preserves occurrences and complete portable Loadout intent', () => {
  const profile = createNimiAIProfileAuthoringBuilder({
    profileId: 'profile.authoring.complete-local-intent',
    title: 'Complete Local intent',
    provenance: { publisher: 'example.test' },
    license: 'Apache-2.0',
  }).setLocalCapability({
    capabilityContract: 'text.generate',
    requiredFeatures: ['input.image'],
    localConfiguration: createNimiAIProfileLocalImplementation({ recipe: TEXT_RECIPE }),
    resourceOccurrences: [
      { occurrenceId: 'weights.primary', role: 'weights', ordinal: 0 },
      { occurrenceId: 'vision.projector', role: 'projector', ordinal: 1 },
    ],
    loadout: {
      recipeId: TEXT_RECIPE.recipeId,
      axes: [
        {
          slotId: 'main.weights',
          contentId: `sha256:${'a'.repeat(64)}`,
          expectedHash: `sha256:${'b'.repeat(64)}`,
          source: {
            repo: 'example/text',
            revision: 'revision-1',
            file: 'model.gguf',
            sizeBytes: 1024,
          },
        },
        {
          slotId: 'vision.projector',
          contentId: `sha256:${'c'.repeat(64)}`,
          expectedHash: `sha256:${'d'.repeat(64)}`,
        },
      ],
      options: { contextSize: 8192 },
    },
  }).build();
  const local = profile.capabilities['text.generate'];
  assert.equal(local?.route, 'local');
  if (local?.route !== 'local') assert.fail('expected Local capability');
  assert.deepEqual(local.resourceOccurrences?.map((item) => item.occurrenceId), [
    'weights.primary',
    'vision.projector',
  ]);
  assert.equal(local.loadout?.recipeId, TEXT_RECIPE.recipeId);
  assert.equal(local.loadout?.axes.length, 2);
});

test('AIProfile authoring recursively rejects forbidden identity and private-location classes', () => {
  const profile = localTextProfile();
  for (const [key, value] of [
    ['machineId', 'machine-1'],
    ['account_id', 'account-1'],
    ['connectorId', 'connector-1'],
    ['grantRef', 'grant-1'],
    ['clientSecret', 'secret-1'],
    ['modelPath', 'models/private.gguf'],
    ['asset-id', 'asset-1'],
  ] as const) {
    const injected = cloneProfile(profile);
    injected.displayMetadata = { nested: { [key]: value } };
    assert.throws(
      () => validateNimiAIProfileAuthoring(injected as never),
      new RegExp(key.replaceAll('-', '[-_]?'), 'iu'),
      key,
    );
  }

  assert.throws(
    () => createNimiAIProfileLocalImplementation({
      recipe: TEXT_RECIPE,
      portableConfig: { nested: { cachePath: 'C:\\models\\weights.bin' } },
    }),
    /forbidden|non-portable path/u,
  );
});

test('portable-content digests are canonical and exclude display/provenance metadata', () => {
  const profile = localTextProfile();
  const localDigest = deriveNimiAIProfileLocalConfigurationEquivalenceDigest(
    profile,
    'text.generate',
  );
  const profileDigest = deriveNimiAIProfilePortableContentDigest(profile);
  const metadataOnly = cloneProfile(profile);
  metadataOnly.displayMetadata = { category: 'different' };
  metadataOnly.provenance = { publisher: 'new-publisher' };

  assert.equal(
    deriveNimiAIProfileLocalConfigurationEquivalenceDigest(
      metadataOnly as never,
      'text.generate',
    ),
    localDigest,
  );
  assert.equal(deriveNimiAIProfilePortableContentDigest(metadataOnly as never), profileDigest);
  assert.notEqual(
    deriveNimiAIProfileLocalConfigurationEquivalenceDigest(
      localTextProfile(16384),
      'text.generate',
    ),
    localDigest,
  );
  assert.match(localDigest, /^sha256:[a-f0-9]{64}$/u);
});

test('Import and Apply previews stay owner-specific and non-committing', () => {
  const cloudProfile = createNimiAIProfileAuthoringBuilder({
    profileId: 'profile.cloud-preview',
    title: 'Cloud preview',
    provenance: { publisher: 'example.test' },
    license: 'Apache-2.0',
  }).setCloudCapability({
    capabilityContract: 'text.generate',
    requiredFeatures: ['input.image'],
    recommendation: {
      implementation: {
        implementationId: 'cloud.text.example',
        driverId: 'nimi.runtime.driver.example',
        driverDialect: 'example/text/v1',
      },
      supportedFeatures: ['input.image'],
      providerModelTarget: {
        provider: 'example',
        providerModelId: 'text-v1',
        remoteModelCatalogId: 'remote-model-catalog-text-v1',
      },
    },
  }).build();

  const importPreview = deriveNimiAIProfileImportPreview({ profile: cloudProfile });
  assert.equal(importPreview.previewOnly, true);
  assert.deepEqual(importPreview.declaredWrites, {
    profileArtifact: true,
    aiConfig: false,
    localCapabilityConfigurations: false,
    machineSelection: false,
  });
  const appPreview = deriveNimiAIProfileApplyPreview({
    profile: cloudProfile,
    target: { kind: 'app', appId: 'app.authoring-preview' },
  });
  assert.equal(appPreview.after.owner?.owner.oneofKind, 'app');
  assert.deepEqual(appPreview.intentDiff.addedCapabilityContracts, ['text.generate']);
  assert.equal(appPreview.writesOnly, 'target-ai-config');
});

test('Local configuration preview reuses generic Recipe slots and keeps decisions separate', () => {
  const profile = localTextProfile();
  const emptyMachine: NimiAIProfileAuthoringMachineProjection = {
    loadouts: [],
    selections: [],
  };
  const add = deriveNimiAIProfileLocalConfigurationPreview({
    profile,
    capabilityContract: 'text.generate',
    recipe: TEXT_RECIPE,
    machine: emptyMachine,
  });
  assert.equal(add.decision.kind, 'add-new');
  assert.equal(add.requirementProjection.source, 'runtime-recipe');
  assert.equal(add.requirementProjection.recipeId, TEXT_RECIPE.recipeId);
  assert.deepEqual(add.requirementProjection.requirements, TEXT_RECIPE.slots);
  assert.equal(add.runtimeMayConfigureExactPreferredContentAtCommit, true);

  const equivalentMachine: NimiAIProfileAuthoringMachineProjection = {
    loadouts: [{
      loadoutId: 'loadout-equivalent',
      capabilityContract: 'text.generate',
      implementation: { ...TEXT_RECIPE.implementation },
      portableConfig: add.proposal.portableConfig,
      supportedFeatures: [...TEXT_RECIPE.supportedFeatures],
      requirementResolution: 'configured',
      provenance: profile.provenance,
      sourceProfileId: profile.profileId,
    }],
    selections: [],
  };
  const reuse = deriveNimiAIProfileLocalConfigurationPreview({
    profile,
    capabilityContract: 'text.generate',
    recipe: TEXT_RECIPE,
    machine: equivalentMachine,
  });
  assert.equal(reuse.decision.kind, 'reuse-equivalent');

  const changedSameSource: NimiAIProfileAuthoringMachineProjection = {
    loadouts: [{
      ...equivalentMachine.loadouts[0]!,
      loadoutId: 'loadout-same-source-old-content',
      portableConfig: { contextSize: 4096 },
      requirementResolution: 'unresolved',
    }],
    selections: [],
  };
  const choose = deriveNimiAIProfileLocalConfigurationPreview({
    profile,
    capabilityContract: 'text.generate',
    recipe: TEXT_RECIPE,
    machine: changedSameSource,
  });
  assert.equal(choose.decision.kind, 'choose-update-or-add');
});

test('selection mismatch preview remains generic across implementation identities', () => {
  const profile = localTextProfile();
  const machine: NimiAIProfileAuthoringMachineProjection = {
    loadouts: [{
      loadoutId: 'loadout-text-only',
      capabilityContract: 'text.generate',
      implementation: { ...TEXT_RECIPE.implementation },
      portableConfig: { contextSize: 4096 },
      supportedFeatures: [],
      requirementResolution: 'configured',
    }],
    selections: [{
      capabilityContract: 'text.generate',
      loadoutId: 'loadout-text-only',
    }],
  };
  const preview = deriveNimiAIProfileSelectionMismatchPreview({
    profile,
    capabilityContract: 'text.generate',
    machine,
    cloudAlternative: {
      implementation: {
        implementationId: 'cloud.text.example',
        driverId: 'nimi.runtime.driver.example',
        driverDialect: 'example/text/v1',
      },
      supportedFeatures: ['input.image'],
      providerModelTarget: {
        provider: 'example',
        providerModelId: 'vision-text',
        remoteModelCatalogId: 'remote-model-catalog-vision-text',
      },
    },
  });
  assert.equal(preview.branches[0].featureSubset.status, 'feature-mismatch');
  assert.equal(preview.branches[1].featureSubset.status, 'compatible');
  assert.equal(preview.branches[2].featureSubset.status, 'compatible');
  assert.equal(preview.commits, false);
});

test('a new multi-axis Recipe needs no SDK Driver branch or field inventory', () => {
  const recipe: NimiLoadoutRecipe = Object.freeze({
    ...TEXT_RECIPE,
    recipeId: 'recipe.test.multiaxis',
    revision: 'r1',
    title: 'Arbitrary multi-axis recipe',
    capabilityContract: 'media.compose',
    implementation: Object.freeze({
      implementationId: 'local.test.media-compose',
      driverId: 'nimi.runtime.driver.media-compose',
      driverDialect: 'test/media-compose/v1',
    }),
    defaultOptions: Object.freeze({ executionOptions: { futureOption: 7 } }),
    supportedFeatures: Object.freeze(['input.audio', 'input.image']),
    slots: Object.freeze([
      Object.freeze({
        slotId: 'encoder.primary',
        displayLabel: 'Primary encoder',
        recommendedContentIds: Object.freeze([]),
        recommendedVariantIds: Object.freeze([]),
        modelContract: Object.freeze({ format: 'bundle-a' }),
      }),
      Object.freeze({
        slotId: 'decoder.secondary',
        displayLabel: 'Secondary decoder',
        recommendedContentIds: Object.freeze([]),
        recommendedVariantIds: Object.freeze([]),
        modelContract: Object.freeze({ format: 'bundle-b' }),
      }),
      Object.freeze({
        slotId: 'vocoder.optional',
        displayLabel: 'Vocoder',
        recommendedContentIds: Object.freeze([]),
        recommendedVariantIds: Object.freeze([]),
        modelContract: Object.freeze({ format: 'bundle-c' }),
      }),
    ]),
  });
  const profile = createNimiAIProfileAuthoringBuilder({
    profileId: 'profile.multiaxis',
    title: 'Multi-axis',
    provenance: { publisher: 'example.test' },
    license: 'Apache-2.0',
  }).setLocalCapability({
    capabilityContract: recipe.capabilityContract,
    requiredFeatures: ['input.image'],
    localConfiguration: { recipe },
  }).build();

  const projection = deriveNimiAIProfileRequirementProjection(
    profile,
    recipe.capabilityContract,
    recipe,
  );
  assert.deepEqual(
    projection.requirements.map((slot) => slot.slotId),
    ['encoder.primary', 'decoder.secondary', 'vocoder.optional'],
  );
  const capability = profile.capabilities[recipe.capabilityContract];
  assert.equal(capability?.route, 'local');
  if (capability?.route !== 'local') assert.fail('expected Local capability');
  assert.deepEqual(capability.driverPortableConfig, recipe.defaultOptions);
});

test('Recipe identity, capability, features, and slots fail closed when descriptor truth diverges', () => {
  const profile = localTextProfile();
  const wrongCapability = { ...TEXT_RECIPE, capabilityContract: 'text.embed' };
  assert.throws(
    () => createNimiAIProfileAuthoringBuilder({
      profileId: 'profile.wrong-recipe',
      title: 'Wrong recipe',
      provenance: { publisher: 'example.test' },
      license: 'Apache-2.0',
    }).setLocalCapability({
      capabilityContract: 'text.generate',
      localConfiguration: { recipe: wrongCapability },
    }),
    /belongs to text\.embed/u,
  );

  assert.throws(
    () => deriveNimiAIProfileRequirementProjection(
      profile,
      'text.generate',
      {
        ...TEXT_RECIPE,
        implementation: { ...TEXT_RECIPE.implementation, driverDialect: 'test/text/v4' },
      },
    ),
    /does not match Runtime Recipe/u,
  );
  assert.throws(
    () => deriveNimiAIProfileRequirementProjection(
      profile,
      'text.generate',
      { ...TEXT_RECIPE, supportedFeatures: [] },
    ),
    /supportedFeatures do not match Runtime Recipe/u,
  );
});

test('Runtime Driver mirror validators and typed builders are not part of Profile authoring', () => {
  const mirroredExports = Object.keys(authoringModule).filter((name) => (
    name.startsWith('NIMI_AI_PROFILE_')
    || (
      name.startsWith('createNimiAIProfile')
      && name.endsWith('LocalImplementation')
      && name !== 'createNimiAIProfileLocalImplementation'
    )
  ));
  assert.deepEqual(mirroredExports, []);
});
