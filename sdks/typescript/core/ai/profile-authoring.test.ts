import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NIMI_AI_PROFILE_CLOUD_RECOMMENDATION_FIELDS,
  NIMI_AI_PROFILE_LLAMA_CACHE_TYPES,
  NIMI_AI_PROFILE_LLAMA_CPP_EMBED_IMPLEMENTATION,
  NIMI_AI_PROFILE_LLAMA_CPP_IMPLEMENTATION,
  NIMI_AI_PROFILE_LLAMA_EMBED_PORTABLE_CONFIG_FIELDS,
  NIMI_AI_PROFILE_LLAMA_PORTABLE_CONFIG_FIELDS,
  NIMI_AI_PROFILE_QWEN3_ASR_IMPLEMENTATION,
  NIMI_AI_PROFILE_QWEN3_ASR_TRANSFORMERS_IMPLEMENTATION,
  NIMI_AI_PROFILE_QWEN3_TTS_IMPLEMENTATION,
  NIMI_AI_PROFILE_STABLE_DIFFUSION_EXECUTION_OPTION_FIELDS,
  NIMI_AI_PROFILE_STABLE_DIFFUSION_LORA_FIELDS,
  NIMI_AI_PROFILE_STABLE_DIFFUSION_MODEL_FAMILIES,
  NIMI_AI_PROFILE_STABLE_DIFFUSION_PORTABLE_CONFIG_FIELDS,
  NIMI_AI_PROFILE_STABLE_DIFFUSION_VIDEO_PORTABLE_CONFIG_FIELDS,
  createNimiAIProfileAuthoringBuilder,
  createNimiAIProfileLlamaEmbedLocalImplementation,
  createNimiAIProfileLlamaEmbedPortableConfig,
  createNimiAIProfileLlamaLocalImplementation,
  createNimiAIProfileLlamaPortableConfig,
  createNimiAIProfileQwen3ASRLocalImplementation,
  createNimiAIProfileQwen3ASRTransformersLocalImplementation,
  createNimiAIProfileQwen3TTSLocalImplementation,
  createNimiAIProfileStableDiffusionLocalImplementation,
  createNimiAIProfileStableDiffusionVideoLocalImplementation,
  createNimiAIProfileStableDiffusionVideoPortableConfig,
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

const MAIN_CONTENT_ID = `sha256:${'a'.repeat(64)}`;
const MM_PROJ_CONTENT_ID = `sha256:${'b'.repeat(64)}`;

function localTextBuilder(contextSize = 8192) {
  return createNimiAIProfileAuthoringBuilder({
    profileId: 'profile.authoring.local-text',
    title: 'Portable local text',
    description: 'Driver-owned local text intent',
    provenance: { publisher: 'example.test', source: 'authoring-suite' },
    license: { name: 'Apache-2.0' },
    displayMetadata: { category: 'writing' },
  }).setLocalCapability({
    capabilityContract: 'text.generate',
    requiredFeatures: ['input.image'],
    defaults: { temperature: 0.4 },
    localConfiguration: createNimiAIProfileLlamaLocalImplementation({
      supportedFeatures: ['input.image'],
      portableConfig: {
        mainRequirementPolicy: 'strict',
        mainVerifiedContentId: MAIN_CONTENT_ID,
        mmprojRequirementPolicy: 'substitutable',
        mmprojVerifiedContentId: MM_PROJ_CONTENT_ID,
        contextSize,
        cacheTypeK: 'q8_0',
        cacheTypeV: 'f16',
        flashAttention: true,
        gpuLayers: -1,
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

const FL2VA_CONTENT_ID = `sha256:${'e'.repeat(64)}`;

function localVideoBuilder(fl2vaPolicy: 'strict' | 'substitutable' = 'strict') {
  return createNimiAIProfileAuthoringBuilder({
    profileId: 'profile.authoring.video',
    title: 'Portable video studio',
    provenance: { publisher: 'example.test' },
    license: 'Apache-2.0',
  }).setLocalCapability({
    capabilityContract: 'video.generate',
    localConfiguration: createNimiAIProfileStableDiffusionVideoLocalImplementation({
      supportedFeatures: ['input.image'],
      portableConfig: {
        fl2vaRequirementPolicy: fl2vaPolicy,
        ...(fl2vaPolicy === 'strict' ? { fl2vaVerifiedContentId: FL2VA_CONTENT_ID } : {}),
        ref2vaRequirementPolicy: 'substitutable',
        encoderRequirementPolicy: 'substitutable',
        videoVAERequirementPolicy: 'substitutable',
        audioVAERequirementPolicy: 'substitutable',
      },
    }),
  });
}

test('AIProfile authoring builder round-trips and imported artifacts remain editable', () => {
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
        region: 'global',
      },
    },
  });

  const built = builder.build();
  const exported = builder.export();
  assert.deepEqual(parseNimiPortableAIProfile(exported), built);
  assert.doesNotMatch(exported, /connector|grant|account/iu);

  const edited = importNimiAIProfileAuthoring(exported)
    .setTitle('Edited portable local text')
    .setDisplayMetadata({ category: 'edited' })
    .build();
  assert.equal(edited.title, 'Edited portable local text');
  assert.deepEqual(edited.displayMetadata, { category: 'edited' });
  assert.deepEqual(edited.capabilities, built.capabilities);

  const incomplete = createNimiAIProfileAuthoringBuilder({
    profileId: 'profile.draft',
    title: 'Draft',
  }).setLocalCapability({ capabilityContract: 'text.generate' });
  assert.throws(() => incomplete.build(), /provenance is required/u);
  assert.equal(incomplete.build({
    requireProvenance: false,
    requireLicense: false,
  }).profileId, 'profile.draft');
});

test('AIProfile authoring recursively rejects forbidden identity and private-location classes', () => {
  const profile = localTextProfile();
  const forbidden = [
    ['machineId', 'machine-1'],
    ['account_id', 'account-1'],
    ['connectorId', 'connector-1'],
    ['grantRef', 'grant-1'],
    ['clientSecret', 'secret-1'],
    ['modelPath', 'models/private.gguf'],
    ['asset-id', 'asset-1'],
  ] as const;

  for (const [key, value] of forbidden) {
    const injected = cloneProfile(profile);
    injected.displayMetadata = { nested: { [key]: value } };
    assert.throws(
      () => validateNimiAIProfileAuthoring(injected as never),
      new RegExp(key.replaceAll('-', '[-_]?'), 'iu'),
      key,
    );
  }

  const absolutePath = cloneProfile(profile);
  absolutePath.displayMetadata = { note: '/private/models/model.gguf' };
  assert.throws(
    () => validateNimiAIProfileAuthoring(absolutePath as never),
    /non-portable path/u,
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
  metadataOnly.displayMetadata = { category: 'different', color: 'blue' };
  metadataOnly.provenance = { publisher: 'new-publisher', source: 'same-content' };
  assert.equal(
    deriveNimiAIProfileLocalConfigurationEquivalenceDigest(
      metadataOnly as never,
      'text.generate',
    ),
    localDigest,
  );
  assert.equal(deriveNimiAIProfilePortableContentDigest(metadataOnly as never), profileDigest);

  const changedConfig = localTextProfile(16384);
  assert.notEqual(
    deriveNimiAIProfileLocalConfigurationEquivalenceDigest(
      changedConfig,
      'text.generate',
    ),
    localDigest,
  );
  assert.notEqual(deriveNimiAIProfilePortableContentDigest(changedConfig), profileDigest);
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
      providerModelTarget: { provider: 'example', providerModelId: 'text-v1' },
    },
  }).build();

  const importPreview = deriveNimiAIProfileImportPreview({ profile: cloudProfile });
  assert.equal(importPreview.previewOnly, true);
  assert.deepEqual(importPreview.declaredWrites, {
    profileArtifact: true,
    aiConfig: false,
    localCapabilityConfigurations: false,
    machineSelection: false,
    connectorGrant: false,
  });

  const appPreview = deriveNimiAIProfileApplyPreview({
    profile: cloudProfile,
    target: { kind: 'app', appId: 'app.authoring-preview' },
  });
  assert.equal(appPreview.after.owner?.owner.oneofKind, 'app');
  assert.deepEqual(appPreview.intentDiff.addedCapabilityContracts, ['text.generate']);
  assert.deepEqual(appPreview.cloudSelections, [{
    capabilityContract: 'text.generate',
    state: 'selection-required',
  }]);
  const cloudIntent = appPreview.after.capabilities[0];
  assert.equal(cloudIntent?.route.oneofKind, 'cloud');
  if (cloudIntent?.route.oneofKind !== 'cloud') assert.fail('expected Cloud intent');
  assert.equal(cloudIntent.route.cloud.connectorGrantId, '');

  const sharedPreview = deriveNimiAIProfileApplyPreview({
    profile: cloudProfile,
    target: { kind: 'shared-local-agent' },
  });
  assert.equal(
    sharedPreview.after.owner?.owner.oneofKind,
    'runtimeLocalAgentSubsystem',
  );
  assert.equal(sharedPreview.writesOnly, 'target-ai-config');
  assert.equal('localConfiguration' in sharedPreview, false);
});

test('Local configuration preview derives add, exact reuse, and same-source choice separately', () => {
  const profile = localTextProfile();
  const emptyMachine: NimiAIProfileAuthoringMachineProjection = {
    configurations: [],
    selections: [],
  };
  const add = deriveNimiAIProfileLocalConfigurationPreview({
    profile,
    capabilityContract: 'text.generate',
    machine: emptyMachine,
  });
  assert.equal(add.decision.kind, 'add-new');
  assert.equal(add.decision.expectedRequirementResolution, 'unresolved');
  assert.equal(add.doesNotSelect, true);
  assert.equal(add.requirementProjection.source, 'authoring-preview');
  assert.equal(add.requirementProjection.commitTruth, 'runtime-reproject');
  assert.deepEqual(
    add.requirementProjection.requirements.map((requirement) => ({
      id: requirement.requirementId,
      role: requirement.role,
      ordinal: requirement.occurrenceOrdinal,
      label: requirement.displayLabel,
      kind: requirement.resourceKind,
      policy: requirement.policy,
    })),
    [
      {
        id: 'main.gguf',
        role: 'main',
        ordinal: 0,
        label: 'Main model',
        kind: 'gguf',
        policy: 'strict',
      },
      {
        id: 'companion.mmproj',
        role: 'companion',
        ordinal: 0,
        label: 'Vision projector',
        kind: 'mmproj',
        policy: 'substitutable',
      },
    ],
  );
  assert.equal(add.runtimeMayConfigureExactPreferredContentAtCommit, true);

  const equivalentMachine: NimiAIProfileAuthoringMachineProjection = {
    configurations: [{
      configurationId: 'lcc_equivalent',
      capabilityContract: 'text.generate',
      implementation: { ...NIMI_AI_PROFILE_LLAMA_CPP_IMPLEMENTATION },
      portableConfig: add.proposal.portableConfig,
      supportedFeatures: ['input.image'],
      requirementResolution: 'configured',
      provenance: profile.provenance,
      sourceProfileId: profile.profileId,
    }],
    selections: [],
  };
  const reuse = deriveNimiAIProfileLocalConfigurationPreview({
    profile,
    capabilityContract: 'text.generate',
    machine: equivalentMachine,
  });
  assert.equal(reuse.decision.kind, 'reuse-equivalent');
  if (reuse.decision.kind !== 'reuse-equivalent') assert.fail('expected exact reuse');
  assert.deepEqual(reuse.decision.matches, [{
    configurationId: 'lcc_equivalent',
    requirementResolution: 'configured',
  }]);
  assert.equal(reuse.decision.expectedRequirementResolution, 'configured');

  const changedSameSource: NimiAIProfileAuthoringMachineProjection = {
    configurations: [{
      ...equivalentMachine.configurations[0]!,
      configurationId: 'lcc_same-source-old-content',
      portableConfig: createNimiAIProfileLlamaPortableConfig({
        mainRequirementPolicy: 'substitutable',
        mmprojRequirementPolicy: 'substitutable',
        contextSize: 4096,
      }, ['input.image']),
      requirementResolution: 'unresolved',
    }],
    selections: [],
  };
  const choose = deriveNimiAIProfileLocalConfigurationPreview({
    profile,
    capabilityContract: 'text.generate',
    machine: changedSameSource,
  });
  assert.equal(choose.decision.kind, 'choose-update-or-add');
  if (choose.decision.kind !== 'choose-update-or-add') {
    assert.fail('expected explicit Update/Add choice');
  }
  assert.deepEqual(
    choose.decision.updateCandidateConfigurationIds,
    ['lcc_same-source-old-content'],
  );
  assert.equal(choose.decision.updateExpectedRequirementResolution, 'unresolved');
  assert.equal(choose.decision.addExpectedRequirementResolution, 'unresolved');
});

test('selection mismatch preview derives current, recommended Local, and Cloud feature subsets', () => {
  const profile = localTextProfile();
  const machine: NimiAIProfileAuthoringMachineProjection = {
    configurations: [{
      configurationId: 'lcc_text_only',
      capabilityContract: 'text.generate',
      implementation: { ...NIMI_AI_PROFILE_LLAMA_CPP_IMPLEMENTATION },
      portableConfig: createNimiAIProfileLlamaPortableConfig({
        mainRequirementPolicy: 'substitutable',
        contextSize: 4096,
      }),
      supportedFeatures: [],
      requirementResolution: 'configured',
    }],
    selections: [{
      capabilityContract: 'text.generate',
      configurationId: 'lcc_text_only',
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
      providerModelTarget: { provider: 'example', providerModelId: 'vision-text' },
    },
  });

  assert.deepEqual(preview.branches.map((branch) => branch.kind), [
    'continue-current-selection',
    'select-recommended-local-configuration',
    'use-cloud',
  ]);
  assert.equal(preview.branches[0].featureSubset.status, 'feature-mismatch');
  assert.deepEqual(preview.branches[0].featureSubset.missingFeatures, ['input.image']);
  assert.equal(preview.branches[0].changesSelection, false);
  assert.equal(preview.branches[1].featureSubset.status, 'compatible');
  assert.equal(preview.branches[1].prerequisite, 'add-or-update-local-configuration');
  assert.equal(preview.branches[2].featureSubset.status, 'compatible');
  assert.equal(preview.branches[2].connectorGrantSelection, 'selection-required');
  assert.equal(preview.mismatchFailsClosed, true);
  assert.equal(preview.commits, false);

  const cloudMismatch = deriveNimiAIProfileSelectionMismatchPreview({
    profile,
    capabilityContract: 'text.generate',
    machine,
    cloudAlternative: {
      implementation: {
        implementationId: 'cloud.text.only',
        driverId: 'nimi.runtime.driver.example',
        driverDialect: 'example/text/v1',
      },
      supportedFeatures: [],
      providerModelTarget: { provider: 'example', providerModelId: 'text-only' },
    },
  });
  assert.equal(cloudMismatch.branches[2].featureSubset.status, 'feature-mismatch');
});

test('stable-diffusion authoring projection preserves Driver-declared occurrences', () => {
  const profile = createNimiAIProfileAuthoringBuilder({
    profileId: 'profile.authoring.image',
    title: 'Portable image studio',
    provenance: { publisher: 'example.test' },
    license: 'Apache-2.0',
  }).setLocalCapability({
    capabilityContract: 'image.generate',
    requiredFeatures: ['input.image'],
    localConfiguration: createNimiAIProfileStableDiffusionLocalImplementation({
      supportedFeatures: ['input.image'],
      portableConfig: {
        modelFamily: 'ideogram4',
        enableInputImage: true,
        mainRequirementPolicy: 'substitutable',
        textEncoderRequirementPolicy: 'substitutable',
        vaeRequirementPolicy: 'substitutable',
        uncondDiffusionRequirementPolicy: 'substitutable',
        loras: [
          { displayLabel: 'Portrait detail', requirementPolicy: 'substitutable' },
          { requirementPolicy: 'substitutable', weight: 0.5 },
        ],
        executionOptions: {
          steps: 30,
          cfgScale: 6.5,
          width: 1024,
          height: 768,
          seed: -1,
          sampler: 'euler_a',
          scheduler: 'karras',
          threads: 8,
          diffusionFlashAttention: true,
          offloadParamsToCPU: false,
        },
      },
    }),
  }).build();

  const projection = deriveNimiAIProfileRequirementProjection(profile, 'image.generate');
  assert.deepEqual(
    projection.requirements.map((requirement) => [
      requirement.requirementId,
      requirement.role,
      requirement.occurrenceOrdinal,
      requirement.displayLabel,
      requirement.resourceKind,
      requirement.policy,
    ]),
    [
      ['main.diffusion', 'main', 0, 'Diffusion model', 'image', 'substitutable'],
      ['companion.text-encoder', 'companion', 0, 'Text encoder', 'chat', 'substitutable'],
      ['companion.vae', 'companion', 0, 'VAE', 'vae', 'substitutable'],
      ['companion.uncond-diffusion', 'companion', 0, 'Unconditional diffusion model', 'image', 'substitutable'],
      ['companion.lora.1', 'companion', 1, 'Portrait detail', 'lora', 'substitutable'],
      ['companion.lora.2', 'companion', 2, 'LoRA 2', 'lora', 'substitutable'],
    ],
  );
});

test('llama embedding authoring preserves exact portable identity and slot', () => {
  const profile = createNimiAIProfileAuthoringBuilder({
    profileId: 'profile.authoring.embedding',
    title: 'Portable local embedding',
    provenance: { publisher: 'example.test' },
    license: 'Apache-2.0',
  }).setLocalCapability({
    capabilityContract: 'text.embed',
    localConfiguration: createNimiAIProfileLlamaEmbedLocalImplementation({
      portableConfig: {
        mainRequirementPolicy: 'strict',
        mainVerifiedContentId: MAIN_CONTENT_ID,
        contextSize: 8192,
        cacheTypeK: 'q8_0',
        flashAttention: true,
        gpuLayers: -1,
      },
    }),
  }).build();

  assert.deepEqual(
    profile.capabilities['text.embed']?.implementation,
    { ...NIMI_AI_PROFILE_LLAMA_CPP_EMBED_IMPLEMENTATION, supportedFeatures: [] },
  );
  const projection = deriveNimiAIProfileRequirementProjection(profile, 'text.embed');
  assert.deepEqual(projection.requirements, [{
    requirementId: 'embedding.gguf',
    role: 'main',
    occurrenceOrdinal: 0,
    displayLabel: 'Embedding model',
    resourceKind: 'gguf',
    policy: 'strict',
    preferredVerifiedContentId: MAIN_CONTENT_ID,
  }]);
  assert.throws(
    () => createNimiAIProfileLlamaEmbedPortableConfig({
      mmprojRequirementPolicy: 'substitutable',
    } as never),
    /unsupported field/u,
  );
  assert.throws(
    () => createNimiAIProfileLlamaEmbedLocalImplementation({
      supportedFeatures: ['input.image'],
    }),
    /must be empty/u,
  );
});

test('Qwen3 speech authoring preserves exact portable identities and slots', () => {
  const profile = createNimiAIProfileAuthoringBuilder({
    profileId: 'profile.authoring.speech',
    title: 'Portable local speech',
    provenance: { publisher: 'example.test' },
    license: 'Apache-2.0',
  }).setLocalCapability({
    capabilityContract: 'audio.synthesize',
    localConfiguration: createNimiAIProfileQwen3TTSLocalImplementation(),
  }).setLocalCapability({
    capabilityContract: 'audio.transcribe',
    localConfiguration: createNimiAIProfileQwen3ASRLocalImplementation(),
  }).build();

  assert.deepEqual(profile.capabilities['audio.synthesize']?.implementation, {
    ...NIMI_AI_PROFILE_QWEN3_TTS_IMPLEMENTATION,
    supportedFeatures: [],
  });
  assert.deepEqual(profile.capabilities['audio.transcribe']?.implementation, {
    ...NIMI_AI_PROFILE_QWEN3_ASR_IMPLEMENTATION,
    supportedFeatures: [],
  });
  assert.deepEqual(
    deriveNimiAIProfileRequirementProjection(profile, 'audio.synthesize').requirements,
    [{
      requirementId: 'tts.model',
      role: 'main',
      occurrenceOrdinal: 0,
      displayLabel: 'TTS model',
      resourceKind: 'tts',
      policy: 'substitutable',
    }],
  );
  assert.deepEqual(
    deriveNimiAIProfileRequirementProjection(profile, 'audio.transcribe').requirements,
    [{
      requirementId: 'stt.model',
      role: 'main',
      occurrenceOrdinal: 0,
      displayLabel: 'STT model',
      resourceKind: 'stt',
      policy: 'substitutable',
    }],
  );
  assert.throws(
    () => createNimiAIProfileQwen3TTSLocalImplementation({
      supportedFeatures: ['input.audio'],
    }),
    /must be empty/u,
  );
});

test('Transformers-native Qwen3 ASR authoring remains a separate explicit implementation', () => {
  const profile = createNimiAIProfileAuthoringBuilder({
    profileId: 'profile.authoring.speech.transformers',
    title: 'Transformers-native local speech',
    provenance: { publisher: 'example.test' },
    license: 'Apache-2.0',
  }).setLocalCapability({
    capabilityContract: 'audio.transcribe',
    localConfiguration: createNimiAIProfileQwen3ASRTransformersLocalImplementation(),
  }).build();

  assert.deepEqual(profile.capabilities['audio.transcribe']?.implementation, {
    ...NIMI_AI_PROFILE_QWEN3_ASR_TRANSFORMERS_IMPLEMENTATION,
    supportedFeatures: [],
  });
  assert.notDeepEqual(
    profile.capabilities['audio.transcribe']?.implementation,
    { ...NIMI_AI_PROFILE_QWEN3_ASR_IMPLEMENTATION, supportedFeatures: [] },
  );
});

test('stable-diffusion video authoring projection preserves Driver-declared slots', () => {
  const profile = localVideoBuilder().build();
  const projection = deriveNimiAIProfileRequirementProjection(profile, 'video.generate');
  // Slot order/facts mirror runtime/internal/capabilitydriver/stablediffusion_video.go:54-80.
  assert.deepEqual(
    projection.requirements.map((requirement) => [
      requirement.requirementId,
      requirement.role,
      requirement.occurrenceOrdinal,
      requirement.displayLabel,
      requirement.resourceKind,
      requirement.policy,
    ]),
    [
      ['diffusion.fl2va', 'main', 0, 'MiniMax-H3 FL2VA transformer', 'video', 'strict'],
      ['diffusion.ref2va', 'companion', 0, 'MiniMax-H3 Ref2VA transformer', 'video', 'substitutable'],
      ['encoder.h3-combined', 'companion', 0, 'MiniMax-H3 combined Qwen3-VL encoder', 'chat', 'substitutable'],
      ['vae.video', 'companion', 0, 'MiniMax-H3 video VAE', 'vae', 'substitutable'],
      ['vae.audio', 'companion', 0, 'MiniMax-H3 audio VAE', 'vae', 'substitutable'],
    ],
  );
  assert.equal(projection.source, 'authoring-preview');
  assert.equal(projection.commitTruth, 'runtime-reproject');
});

test('stable-diffusion video section participates in both authoring digest domains', () => {
  const profile = localVideoBuilder().build();
  const localDigest = deriveNimiAIProfileLocalConfigurationEquivalenceDigest(
    profile,
    'video.generate',
  );
  const profileDigest = deriveNimiAIProfilePortableContentDigest(profile);
  assert.match(localDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(profileDigest, /^sha256:[a-f0-9]{64}$/u);

  const metadataOnly = cloneProfile(profile);
  metadataOnly.displayMetadata = { category: 'different', color: 'blue' };
  metadataOnly.provenance = { publisher: 'new-publisher', source: 'same-content' };
  assert.equal(
    deriveNimiAIProfileLocalConfigurationEquivalenceDigest(metadataOnly as never, 'video.generate'),
    localDigest,
  );
  assert.equal(deriveNimiAIProfilePortableContentDigest(metadataOnly as never), profileDigest);

  const changedConfig = localVideoBuilder('substitutable').build();
  assert.notEqual(
    deriveNimiAIProfileLocalConfigurationEquivalenceDigest(changedConfig, 'video.generate'),
    localDigest,
  );
  assert.notEqual(deriveNimiAIProfilePortableContentDigest(changedConfig), profileDigest);
});

test('stable-diffusion video section fails closed on illegal portable fields', () => {
  assert.throws(
    () => createNimiAIProfileStableDiffusionVideoPortableConfig({
      modelFamily: 'minimax-h3',
    } as never),
    /unsupported field/u,
  );
  assert.throws(
    () => createNimiAIProfileStableDiffusionVideoPortableConfig({
      fl2vaRequirementPolicy: 'strict',
    }),
    /fl2vaVerifiedContentId is required for strict policy/u,
  );
  assert.throws(
    () => createNimiAIProfileStableDiffusionVideoPortableConfig({
      videoVAEVerifiedContentId: 'not-a-digest',
    }),
    /canonical sha256 content identity/u,
  );
  assert.throws(
    () => createNimiAIProfileStableDiffusionVideoPortableConfig(
      {},
      ['output.video'] as never,
    ),
    /unsupported feature/u,
  );
  assert.throws(
    () => createNimiAIProfileAuthoringBuilder({
      profileId: 'profile.authoring.video-mismatch',
      title: 'Wrong contract',
      provenance: { publisher: 'example.test' },
      license: 'Apache-2.0',
    }).setLocalCapability({
      capabilityContract: 'image.generate',
      localConfiguration: createNimiAIProfileStableDiffusionVideoLocalImplementation(),
    }).build(),
    /requires video\.generate/u,
  );
});

test('authoring Driver field inventories stay exact with Runtime parsers', () => {
  assert.deepEqual(NIMI_AI_PROFILE_LLAMA_CACHE_TYPES, [
    'f32',
    'f16',
    'bf16',
    'q8_0',
    'q4_0',
  ]);
  assert.deepEqual(NIMI_AI_PROFILE_STABLE_DIFFUSION_MODEL_FAMILIES, [
    'z-image',
    'z-image-turbo',
    'ideogram4',
  ]);
  // runtime/internal/capabilitydriver/llama.go:464-465
  assert.deepEqual(NIMI_AI_PROFILE_LLAMA_PORTABLE_CONFIG_FIELDS, [
    'mainRequirementPolicy',
    'mainVerifiedContentId',
    'mmprojRequirementPolicy',
    'mmprojVerifiedContentId',
    'contextSize',
    'cacheTypeK',
    'cacheTypeV',
    'flashAttention',
    'gpuLayers',
  ]);
  assert.deepEqual(NIMI_AI_PROFILE_LLAMA_EMBED_PORTABLE_CONFIG_FIELDS, [
    'mainRequirementPolicy',
    'mainVerifiedContentId',
    'contextSize',
    'cacheTypeK',
    'cacheTypeV',
    'flashAttention',
    'gpuLayers',
  ]);
  // runtime/internal/capabilitydriver/stablediffusion.go:715-720
  assert.deepEqual(NIMI_AI_PROFILE_STABLE_DIFFUSION_PORTABLE_CONFIG_FIELDS, [
    'modelFamily',
    'enableInputImage',
    'mainRequirementPolicy',
    'mainVerifiedContentId',
    'textEncoderRequirementPolicy',
    'textEncoderVerifiedContentId',
    'vaeRequirementPolicy',
    'vaeVerifiedContentId',
    'uncondDiffusionRequirementPolicy',
    'uncondDiffusionVerifiedContentId',
    'loras',
    'executionOptions',
  ]);
  // runtime/internal/capabilitydriver/stablediffusion.go:811
  assert.deepEqual(NIMI_AI_PROFILE_STABLE_DIFFUSION_LORA_FIELDS, [
    'displayLabel',
    'requirementPolicy',
    'verifiedContentId',
    'weight',
  ]);
  // runtime/internal/capabilitydriver/stablediffusion.go:862
  assert.deepEqual(NIMI_AI_PROFILE_STABLE_DIFFUSION_EXECUTION_OPTION_FIELDS, [
    'steps',
    'cfgScale',
    'width',
    'height',
    'seed',
    'sampler',
    'scheduler',
    'threads',
    'diffusionFlashAttention',
    'offloadParamsToCPU',
  ]);
  // runtime/internal/capabilitydriver/stablediffusion_video.go:54-80,318-322
  assert.deepEqual(NIMI_AI_PROFILE_STABLE_DIFFUSION_VIDEO_PORTABLE_CONFIG_FIELDS, [
    'fl2vaRequirementPolicy',
    'fl2vaVerifiedContentId',
    'ref2vaRequirementPolicy',
    'ref2vaVerifiedContentId',
    'encoderRequirementPolicy',
    'encoderVerifiedContentId',
    'videoVAERequirementPolicy',
    'videoVAEVerifiedContentId',
    'audioVAERequirementPolicy',
    'audioVAEVerifiedContentId',
  ]);
  // sdks/typescript/core/ai/config-profile.ts:34-41; p-caiex-009 excludes grant/account.
  assert.deepEqual(NIMI_AI_PROFILE_CLOUD_RECOMMENDATION_FIELDS, [
    'implementation',
    'supportedFeatures',
    'providerModelTarget',
  ]);

  assert.throws(
    () => createNimiAIProfileLlamaPortableConfig({
      contextSize: 4096,
      modelPath: 'private/model.gguf',
    } as never),
    /modelPath/u,
  );
  assert.throws(
    () => createNimiAIProfileLlamaPortableConfig({ contextSize: 0 }),
    /contextSize/u,
  );
});
