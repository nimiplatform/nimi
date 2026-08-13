import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  changeLocale,
  initI18n,
} from '../src/shell/renderer/i18n/index.js';
import {
  MachineLocalAIConfigurationsView,
  createVideoConfigurationInput,
  type MachineLocalAIConfigurationsViewProps,
} from '../src/shell/renderer/features/runtime-config/runtime-config-page-machine-local-ai.js';
import {
  MachineLocalAIAddFormFields,
  createMachineLocalImageConfigurationInput,
} from '../src/shell/renderer/features/runtime-config/runtime-config-machine-local-ai-add-drawer.js';
import { MachineLocalAIImpactDialogContent } from '../src/shell/renderer/features/runtime-config/runtime-config-machine-local-ai-card.js';
import {
  INITIAL_RUNTIME_CONFIG_MACHINE_LOCAL_AI_STATE,
  compatibleMachineLocalAssets,
  createRuntimeConfigMachineLocalAIAddDraft,
  machineLocalConfigurationFileState,
  reduceRuntimeConfigMachineLocalAIState,
  runtimeConfigMachineLocalAIImpactCommitAllowed,
} from '../src/shell/renderer/features/runtime-config/runtime-config-machine-local-ai-state.js';
import type {
  NimiMachineLocalAIConfiguration,
  NimiMachineLocalCapabilityConfiguration,
  NimiRuntimeLocalAssetEntry,
} from '@nimiplatform/sdk/runtime';

(globalThis as { React?: typeof React }).React = React;

const noop = () => undefined;

function configuration(
  resolution: 'unresolved' | 'configured',
): NimiMachineLocalCapabilityConfiguration {
  const binding = {
    requirementId: 'main.gguf',
    localAssetId: 'local-asset-main',
    verifiedContentId: `sha256:${'a'.repeat(64)}`,
    entrySha256: 'a'.repeat(64),
  };
  return {
    configurationId: 'lcc_test',
    capabilityContract: 'text.generate',
    implementation: {
      implementationId: 'local.text.generate.llama-cpp',
      driverId: 'nimi.runtime.driver.llama-cpp',
      driverDialect: 'llama.cpp/text-generate/v1',
    },
    portableConfig: { mainRequirementPolicy: 'substitutable' },
    projectedRequirements: [{
      requirementId: 'main.gguf',
      role: 'main',
      resourceKind: 'gguf',
      policy: 'substitutable',
      compatibilityConstraints: { engine: 'llama', artifact_role: 'llm' },
      occurrenceOrdinal: 0,
      displayLabel: 'Main model',
    }],
    exactBindings: resolution === 'configured' ? [binding] : [],
    supportedFeatures: [],
    interpretability: 'interpretable',
    requirementResolution: resolution,
    reasons: resolution === 'configured' ? [] : ['required_binding_missing'],
    displayName: 'Local writing model',
  };
}

function baseProps(
  aggregate: NimiMachineLocalAIConfiguration,
  overrides: Partial<MachineLocalAIConfigurationsViewProps> = {},
): MachineLocalAIConfigurationsViewProps {
  return {
    aggregate,
    assets: [],
    loading: false,
    loadTechnicalError: '',
    busyAction: '',
    feedback: null,
    showAddForm: false,
    addDraft: createRuntimeConfigMachineLocalAIAddDraft(),
    impactConfirmation: null,
    deleteConfirmationId: '',
    onRefresh: noop,
    onShowAddForm: noop,
    onHideAddForm: noop,
    onAddDraftChange: noop,
    onAdd: noop,
    onSelect: noop,
    onClearSelection: noop,
    onReproject: noop,
    onUpdateContextCapacity: noop,
    onUpdateVideoRecipe: noop,
    onBind: noop,
    onUnbind: noop,
    onRequestDelete: noop,
    onCancelDelete: noop,
    onConfirmDelete: noop,
    onConfirmImpact: noop,
    onCancelImpact: noop,
    ...overrides,
  };
}

function renderView(props: MachineLocalAIConfigurationsViewProps): string {
  return renderToStaticMarkup(<MachineLocalAIConfigurationsView {...props} />);
}

test.before(async () => {
  await initI18n();
  await changeLocale('en');
});

test('Local AI Configurations renders the first-use empty projection as an information state', () => {
  const markup = renderView(baseProps({ configurations: [], selections: [] }));

  assert.match(markup, /data-nimi-model-config-owner="machine-local-ai-configuration"/u);
  assert.match(markup, /data-testid="machine-local-ai-configurations-empty-info"/u);
  assert.match(markup, /No on-device models set up yet/u);
  assert.match(markup, /You can save it before linking all required files/u);
  assert.doesNotMatch(markup, /nimi-status-warning/u);
  assert.doesNotMatch(markup, /warning/iu);
});

test('Local AI Configurations state and rendered copy move from unresolved to configured without claiming readiness', () => {
  const unresolved = configuration('unresolved');
  let state = reduceRuntimeConfigMachineLocalAIState(
    INITIAL_RUNTIME_CONFIG_MACHINE_LOCAL_AI_STATE,
    {
      type: 'load-succeeded',
      aggregate: { configurations: [unresolved], selections: [] },
      assets: [],
    },
  );
  assert.equal(machineLocalConfigurationFileState(unresolved), 'files-needed');
  const unresolvedMarkup = renderView(baseProps(state.aggregate!));
  assert.match(unresolvedMarkup, /data-file-state="files-needed"/u);
  assert.match(unresolvedMarkup, /Files needed/u);

  const configured = configuration('configured');
  state = reduceRuntimeConfigMachineLocalAIState(state, {
    type: 'configuration-committed',
    configuration: configured,
  });
  assert.equal(machineLocalConfigurationFileState(configured), 'configured');
  const configuredMarkup = renderView(baseProps(state.aggregate!));
  assert.match(configuredMarkup, /data-file-state="configured"/u);
  assert.match(configuredMarkup, />Files linked</u);
  assert.match(configuredMarkup, /model has not been test-run/u);
  assert.match(configuredMarkup, /Automatic \(recommended\)/u);
  assert.match(configuredMarkup, /Advanced: context length/u);
  assert.doesNotMatch(configuredMarkup, /\bready\b/iu);
  assert.doesNotMatch(configuredMarkup, /Technical details/u);
  assert.doesNotMatch(configuredMarkup, /required_binding_missing/u);
});

test('Local AI Configurations shows the current selection independently for every projected capability', () => {
  const textConfiguration = configuration('configured');
  const imageConfiguration = {
    ...configuration('configured'),
    configurationId: 'lcc_image',
    capabilityContract: 'image.generate',
    displayName: 'Local image model',
  };
  const markup = renderView(baseProps({
    configurations: [textConfiguration, imageConfiguration],
    selections: [
      { capabilityContract: 'text.generate', configurationId: 'lcc_test' },
      { capabilityContract: 'image.generate', configurationId: 'lcc_image' },
    ],
  }));

  assert.match(markup, /Image generation/u);
  assert.match(markup, /Local image model/u);
  assert.match(markup, /Text generation/u);
  assert.match(markup, /Local writing model/u);
  assert.equal((markup.match(/>In use on this device</gu) ?? []).length, 2);
});

test('Local AI Configurations impact state requires a separate explicit confirmation before commit', () => {
  const request = {
    requestId: 'impact-1',
    operation: 'select' as const,
    capabilityContract: 'image.generate',
    configurationId: 'lcc_image',
  };
  let state = reduceRuntimeConfigMachineLocalAIState(
    INITIAL_RUNTIME_CONFIG_MACHINE_LOCAL_AI_STATE,
    { type: 'impact-confirmation-requested', request },
  );
  state = reduceRuntimeConfigMachineLocalAIState(state, {
    type: 'impact-load-succeeded',
    requestId: request.requestId,
    impact: {
      operation: 'select',
      capabilityContract: 'image.generate',
      configurationId: 'lcc_image',
      affectedOwners: [{
        kind: 'app',
        ownerId: 'nimi.desktop',
        requiredFeatures: [],
      }],
    },
  });

  assert.equal(runtimeConfigMachineLocalAIImpactCommitAllowed(state, request.requestId), false);
  assert.equal(state.impactConfirmation?.explicitlyConfirmed, false);
  state = reduceRuntimeConfigMachineLocalAIState(state, {
    type: 'impact-explicitly-confirmed',
    requestId: request.requestId,
  });
  assert.equal(runtimeConfigMachineLocalAIImpactCommitAllowed(state, request.requestId), true);
});

test('Local AI Configurations renders the image form without LoRA authoring and emits only supported fields', () => {
  const initial = createRuntimeConfigMachineLocalAIAddDraft();
  const bundleEntries = [
    { ordinal: 1, relativePath: 'shard-1.gguf', sha256: 'a'.repeat(64) },
    { ordinal: 2, relativePath: 'shard-2.gguf', sha256: 'b'.repeat(64) },
  ];
  const bundle: NimiRuntimeLocalAssetEntry = {
    localAssetId: 'bundle-image',
    assetId: 'bundle-image',
    displayName: 'Image model bundle',
    kind: 'image',
    engine: 'stable-diffusion',
    status: 'installed',
    family: 'z-image',
    expectedVerifiedContentId: `sha256:${'c'.repeat(64)}`,
    exactContent: {
      kind: 'sharded-bundle',
      verifiedContentId: `sha256:${'c'.repeat(64)}`,
      entrySha256: 'c'.repeat(64),
      bundleEntries,
    },
    bundleEntries,
  };
  const draft = {
    ...initial,
    capabilityContract: 'image.generate' as const,
    displayName: 'Image studio',
    mainLocalAssetId: bundle.localAssetId,
    modelFamily: 'z-image',
  };
  const markup = renderToStaticMarkup(
    <MachineLocalAIAddFormFields draft={draft} assets={[bundle]} busy={false} onChange={noop} />,
  );

  assert.match(markup, /data-testid="machine-local-ai-configuration-add-form"/u);
  assert.match(markup, /data-testid="machine-local-ai-image-fields"/u);
  assert.match(markup, /Preferred local file/u);
  assert.match(markup, /z-image/u);
  assert.doesNotMatch(markup, /Text encoder/u);
  assert.doesNotMatch(markup, /machine-local-ai-lora|Add LoRA/u);
  assert.equal((markup.match(/Image model bundle · File bundle/gu) ?? []).length, 1);
  assert.doesNotMatch(markup, /shard-1\.gguf|shard-2\.gguf/u);

  const input = createMachineLocalImageConfigurationInput(draft, [bundle], draft.displayName);
  assert.equal(Object.hasOwn(input.portableConfig ?? {}, 'loras'), false);
  assert.deepEqual(input.portableConfig, {
    modelFamily: 'z-image',
    enableInputImage: false,
    executionOptions: { steps: 20, cfgScale: 7, width: 1024, height: 1024, seed: 42 },
  });
});

test('Local AI Configurations authors and manages the exact llama embedding implementation', () => {
  const draft = {
    ...createRuntimeConfigMachineLocalAIAddDraft(),
    capabilityContract: 'text.embed' as const,
    displayName: 'Local embeddings',
  };
  const addMarkup = renderToStaticMarkup(
    <MachineLocalAIAddFormFields draft={draft} assets={[]} busy={false} onChange={noop} />,
  );

  assert.match(addMarkup, />Text embedding</u);
  assert.match(addMarkup, /data-testid="machine-local-ai-embed-fields"/u);
  assert.match(addMarkup, /llama\.cpp/u);
  assert.doesNotMatch(addMarkup, /data-testid="machine-local-ai-image-fields"/u);
  assert.doesNotMatch(addMarkup, /data-testid="machine-local-ai-video-fields"/u);

  const embedConfiguration: NimiMachineLocalCapabilityConfiguration = {
    ...configuration('unresolved'),
    configurationId: 'lcc_embed',
    capabilityContract: 'text.embed',
    implementation: {
      implementationId: 'local.text.embed.llama-cpp',
      driverId: 'nimi.runtime.driver.llama-cpp',
      driverDialect: 'llama.cpp/text-embed/v1',
    },
    portableConfig: {
      mainRequirementPolicy: 'substitutable',
      contextSize: 4096,
    },
    projectedRequirements: [{
      requirementId: 'embedding.gguf',
      role: 'main',
      resourceKind: 'gguf',
      policy: 'substitutable',
      compatibilityConstraints: { engine: 'llama', artifact_role: 'embedding' },
      occurrenceOrdinal: 0,
      displayLabel: 'Embedding model',
    }],
    displayName: 'Local embeddings',
  };
  const cardMarkup = renderView(baseProps({
    configurations: [embedConfiguration],
    selections: [],
  }));

  assert.match(cardMarkup, />Text embedding</u);
  assert.match(cardMarkup, /llama\.cpp/u);
  assert.match(cardMarkup, /Fixed at 4096 tokens/u);
  assert.match(cardMarkup, /Advanced: context length/u);
});

test('Local AI Configurations authors and displays exact Qwen3 speech implementations', () => {
  const cases = [
    {
      capabilityContract: 'audio.synthesize' as const,
      label: 'Speech synthesis',
      testId: 'machine-local-ai-tts-fields',
      displayName: 'Local speech synthesis',
      configurationId: 'lcc_tts',
      implementationId: 'local.audio.synthesize.qwen3-tts',
      driverId: 'nimi.runtime.driver.qwen3-tts',
      driverDialect: 'qwen3-tts/audio-synthesize/v1',
      requirementId: 'tts.model',
      resourceKind: 'tts',
      artifactRole: 'tts_model',
      requirementLabel: 'TTS model',
      engineLabel: 'Qwen3-TTS',
    },
    {
      capabilityContract: 'audio.transcribe' as const,
      label: 'Speech transcription',
      testId: 'machine-local-ai-asr-fields',
      displayName: 'Local speech transcription',
      configurationId: 'lcc_asr',
      implementationId: 'local.audio.transcribe.qwen3-asr',
      driverId: 'nimi.runtime.driver.qwen3-asr',
      driverDialect: 'qwen3-asr/audio-transcribe/v1',
      requirementId: 'stt.model',
      resourceKind: 'stt',
      artifactRole: 'stt_model',
      requirementLabel: 'STT model',
      engineLabel: 'Qwen3-ASR',
    },
  ] as const;

  for (const speech of cases) {
    const draft = {
      ...createRuntimeConfigMachineLocalAIAddDraft(),
      capabilityContract: speech.capabilityContract,
      displayName: speech.displayName,
    };
    const addMarkup = renderToStaticMarkup(
      <MachineLocalAIAddFormFields draft={draft} assets={[]} busy={false} onChange={noop} />,
    );
    assert.match(addMarkup, new RegExp(`>${speech.label}<`));
    assert.match(addMarkup, new RegExp(`data-testid="${speech.testId}"`));
    assert.match(addMarkup, new RegExp(speech.engineLabel));

    const speechConfiguration: NimiMachineLocalCapabilityConfiguration = {
      ...configuration('unresolved'),
      configurationId: speech.configurationId,
      capabilityContract: speech.capabilityContract,
      implementation: {
        implementationId: speech.implementationId,
        driverId: speech.driverId,
        driverDialect: speech.driverDialect,
      },
      portableConfig: {},
      projectedRequirements: [{
        requirementId: speech.requirementId,
        role: 'main',
        resourceKind: speech.resourceKind,
        policy: 'substitutable',
        compatibilityConstraints: { engine: speech.driverId, artifact_role: speech.artifactRole },
        occurrenceOrdinal: 0,
        displayLabel: speech.requirementLabel,
      }],
      displayName: speech.displayName,
    };
    const cardMarkup = renderView(baseProps({
      configurations: [speechConfiguration],
      selections: [],
    }));
    assert.match(cardMarkup, new RegExp(`>${speech.label}<`));
    assert.match(cardMarkup, new RegExp(speech.engineLabel));
    assert.doesNotMatch(cardMarkup, /Advanced: context length/u);
  }
});

test('Local AI Configurations exposes and displays the exact VoxCPM synthesis Driver', () => {
  const draft = {
    ...createRuntimeConfigMachineLocalAIAddDraft(),
    capabilityContract: 'audio.synthesize' as const,
    displayName: 'Local VoxCPM synthesis',
    ttsDriverKind: 'voxcpm' as const,
  };
  const addMarkup = renderToStaticMarkup(
    <MachineLocalAIAddFormFields draft={draft} assets={[]} busy={false} onChange={noop} />,
  );

  assert.match(addMarkup, /data-testid="machine-local-ai-tts-driver"/u);
  assert.match(addMarkup, /VoxCPM/u);

  const speechConfiguration: NimiMachineLocalCapabilityConfiguration = {
    ...configuration('unresolved'),
    configurationId: 'lcc_voxcpm',
    capabilityContract: 'audio.synthesize',
    implementation: {
      implementationId: 'local.audio.synthesize.voxcpm',
      driverId: 'nimi.runtime.driver.voxcpm',
      driverDialect: 'voxcpm/audio-synthesize/v1',
    },
    displayName: 'Local VoxCPM synthesis',
  };
  const cardMarkup = renderView(baseProps({
    configurations: [speechConfiguration],
    selections: [],
  }));
  assert.match(cardMarkup, /VoxCPM/u);
});

test('Local AI Configurations exposes the separate Transformers-native ASR Driver explicitly', () => {
  const draft = {
    ...createRuntimeConfigMachineLocalAIAddDraft(),
    capabilityContract: 'audio.transcribe' as const,
    displayName: 'Qwen3 ASR Transformers',
    asrDriverKind: 'qwen3-asr-transformers' as const,
  };
  const addMarkup = renderToStaticMarkup(
    <MachineLocalAIAddFormFields draft={draft} assets={[]} busy={false} onChange={noop} />,
  );

  assert.match(addMarkup, /data-testid="machine-local-ai-asr-driver"/u);
  assert.match(addMarkup, /Qwen3-ASR \(Transformers 5\.13\+\)/u);

  const transformersConfiguration: NimiMachineLocalCapabilityConfiguration = {
    ...configuration('unresolved'),
    configurationId: 'lcc_asr_transformers',
    capabilityContract: 'audio.transcribe',
    implementation: {
      implementationId: 'local.audio.transcribe.qwen3-asr-transformers',
      driverId: 'nimi.runtime.driver.qwen3-asr-transformers',
      driverDialect: 'qwen3-asr-transformers/audio-transcribe/v1',
    },
    displayName: 'Qwen3 ASR Transformers',
  };
  const cardMarkup = renderView(baseProps({
    configurations: [transformersConfiguration],
    selections: [],
  }));
  assert.match(cardMarkup, /Qwen3-ASR \(Transformers 5\.13\+\)/u);
});

test('Local AI Configurations renders future image impact separately from explicit confirmation', () => {
  const markup = renderToStaticMarkup(
    <MachineLocalAIImpactDialogContent
      confirmation={{
        request: {
          requestId: 'impact-delete-image',
          operation: 'delete',
          capabilityContract: 'image.generate',
          configurationId: 'lcc_image',
        },
        status: 'ready',
        impact: {
          operation: 'delete',
          capabilityContract: 'image.generate',
          configurationId: 'lcc_image',
          affectedOwners: [
            { kind: 'app', ownerId: 'nimi.desktop', requiredFeatures: [] },
            { kind: 'shared-local-agent', ownerId: 'shared-local-agent', requiredFeatures: [] },
          ],
        },
        technicalError: '',
        explicitlyConfirmed: false,
      }}
      mutationBusy={false}
      onConfirm={noop}
      onCancel={noop}
    />,
  );

  assert.match(markup, /data-testid="machine-local-ai-impact-confirmation"/u);
  assert.match(markup, /image generation for these apps and local agents/u);
  assert.match(markup, /Nimi Desktop App/u);
  assert.match(markup, /Shared local agents/u);
  assert.match(markup, /Reviewing this impact does not confirm the change/u);
  assert.match(markup, /data-testid="machine-local-ai-impact-confirm"/u);
});

test('Local AI Configurations renders speech impact for the selected capability', () => {
  const cases = [
    { capabilityContract: 'audio.synthesize', expected: 'speech synthesis' },
    { capabilityContract: 'audio.transcribe', expected: 'speech transcription' },
  ] as const;

  for (const speech of cases) {
    const markup = renderToStaticMarkup(
      <MachineLocalAIImpactDialogContent
        confirmation={{
          request: {
            requestId: `impact-select-${speech.capabilityContract}`,
            operation: 'select',
            capabilityContract: speech.capabilityContract,
            configurationId: 'lcc_speech',
          },
          status: 'ready',
          impact: {
            operation: 'select',
            capabilityContract: speech.capabilityContract,
            configurationId: 'lcc_speech',
            affectedOwners: [],
          },
          technicalError: '',
          explicitlyConfirmed: false,
        }}
        mutationBusy={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );

    assert.match(markup, new RegExp(speech.expected, 'u'));
    assert.doesNotMatch(markup, /text generation for these apps and local agents/u);
  }
});

test('Local AI Configurations renders the video form and builds the video add input', () => {
  const initial = createRuntimeConfigMachineLocalAIAddDraft();
  const asset: NimiRuntimeLocalAssetEntry = {
    localAssetId: 'video-main',
    assetId: 'video-main',
    displayName: 'FL2VA transformer',
    kind: 'video',
    engine: 'stable-diffusion',
    status: 'installed',
    expectedVerifiedContentId: `sha256:${'d'.repeat(64)}`,
  };
  const draft = {
    ...initial,
    capabilityContract: 'video.generate' as const,
    displayName: 'Video studio',
    enableInputImage: true,
    videoSlots: {
      ...initial.videoSlots,
      fl2va: { requirementPolicy: 'strict' as const, localAssetId: asset.localAssetId },
    },
  };
  const markup = renderToStaticMarkup(
    <MachineLocalAIAddFormFields draft={draft} assets={[asset]} busy={false} onChange={noop} />,
  );

  assert.match(markup, />Video generation</u);
  assert.match(markup, /data-testid="machine-local-ai-video-fields"/u);
  assert.match(markup, /data-testid="machine-local-ai-video-slot:fl2va"/u);
  assert.match(markup, /data-testid="machine-local-ai-video-slot:ref2va"/u);
  assert.match(markup, /data-testid="machine-local-ai-video-slot:encoder"/u);
  assert.match(markup, /data-testid="machine-local-ai-video-slot:videoVAE"/u);
  assert.match(markup, /data-testid="machine-local-ai-video-slot:audioVAE"/u);
  assert.match(markup, /Main video model \(FL2VA\)/u);
  assert.match(markup, /FL2VA transformer/u);
  assert.match(markup, /data-testid="machine-local-ai-video-execution-options"/u);
  assert.match(markup, /Video generation preset/u);
  assert.match(markup, /Flow shift/u);
  assert.match(markup, /Random number generator/u);
  assert.doesNotMatch(markup, /data-testid="machine-local-ai-image-fields"/u);

  const input = createVideoConfigurationInput(draft, [asset], 'Video studio');
  assert.equal(input.capabilityContract, 'video.generate');
  assert.equal(input.displayName, 'Video studio');
  assert.equal(
    input.implementation.driverDialect,
    'stable-diffusion.cpp/minimax-h3-video-generate/v1',
  );
  assert.deepEqual(input.supportedFeatures, ['input.image']);
  assert.deepEqual(input.portableConfig, {
    fl2vaRequirementPolicy: 'strict',
    fl2vaVerifiedContentId: `sha256:${'d'.repeat(64)}`,
    ref2vaRequirementPolicy: 'substitutable',
    encoderRequirementPolicy: 'substitutable',
    videoVAERequirementPolicy: 'substitutable',
    audioVAERequirementPolicy: 'substitutable',
    executionOptions: {
      cfgScale: 1,
      flowShift: 12,
      sampleMethod: 'engine-default',
      scheduler: 'engine-default',
      diffusionFlashAttention: true,
      offloadParamsToCPU: true,
      rng: 'cpu',
    },
  });

  assert.throws(
    () => createVideoConfigurationInput({
      ...draft,
      enableInputImage: false,
      videoSlots: {
        ...draft.videoSlots,
        ref2va: { requirementPolicy: 'strict' as const, localAssetId: '' },
      },
    }, [asset], 'Video studio'),
    /preferred local file is required for ref2va/iu,
  );
});

test('Local AI Configurations exposes one typed voice.create source per configuration', () => {
  const initial = createRuntimeConfigMachineLocalAIAddDraft();
  const referenceDraft = {
    ...initial,
    capabilityContract: 'voice.create' as const,
    displayName: 'Reference voice',
    voiceCreateSource: 'reference-audio' as const,
  };
  const referenceMarkup = renderToStaticMarkup(
    <MachineLocalAIAddFormFields
      draft={referenceDraft}
      assets={[]}
      busy={false}
      onChange={noop}
    />,
  );
  assert.match(referenceMarkup, />Voice creation</u);
  assert.match(referenceMarkup, /data-testid="machine-local-ai-voice-create-fields"/u);
  assert.match(referenceMarkup, /Reference audio/u);
  assert.match(referenceMarkup, /supports exactly one source/u);
  assert.doesNotMatch(referenceMarkup, /voice clone|voice design/iu);

  const descriptionMarkup = renderToStaticMarkup(
    <MachineLocalAIAddFormFields
      draft={{ ...referenceDraft, voiceCreateSource: 'text-description' }}
      assets={[]}
      busy={false}
      onChange={noop}
    />,
  );
  assert.match(descriptionMarkup, /Text description/u);
});

test('Local AI Configurations keeps video configuration management available when execution is unavailable', () => {
  const videoConfiguration: NimiMachineLocalCapabilityConfiguration = {
    ...configuration('unresolved'),
    configurationId: 'lcc_video',
    capabilityContract: 'video.generate',
    implementation: {
      implementationId: 'local.image.generate.stable-diffusion-cpp',
      driverId: 'nimi.runtime.driver.stable-diffusion-cpp',
      driverDialect: 'stable-diffusion.cpp/minimax-h3-video-generate/v1',
    },
    portableConfig: {
      fl2vaRequirementPolicy: 'substitutable',
      executionOptions: {
        cfgScale: 2.5,
        flowShift: 8,
        sampleMethod: 'euler',
        scheduler: 'karras',
        diffusionFlashAttention: false,
        offloadParamsToCPU: false,
        rng: 'cuda',
      },
    },
    interpretability: 'unavailable',
    displayName: 'Local video model',
  };
  const markup = renderView(baseProps({
    configurations: [videoConfiguration],
    selections: [],
  }));

  assert.match(markup, /Video generation/u);
  assert.match(markup, /Local video model/u);
  assert.match(markup, /stable-diffusion\.cpp/u);
  assert.match(markup, /cannot currently be interpreted/u);
  assert.match(markup, /data-file-state="files-needed"/u);
  assert.match(markup, />Select configuration</u);
  assert.match(markup, /aria-label="More actions"/u);
  assert.match(markup, /data-testid="machine-local-video-recipe:lcc_video"/u);
  assert.match(markup, /Save video preset/u);
  assert.match(markup, /value="2.5"/u);
  assert.match(markup, /value="euler"/u);
  assert.doesNotMatch(markup, /Technical details/u);
});

test('Local AI Configurations derives compatible exact-binding choices from projected constraints', () => {
  const requirement = configuration('unresolved').projectedRequirements[0]!;
  const assets: NimiRuntimeLocalAssetEntry[] = [
    {
      localAssetId: 'main',
      assetId: 'main',
      displayName: 'Main model',
      kind: 'chat',
      engine: 'llama',
      status: 'installed',
      artifactRoles: ['llm'],
      expectedVerifiedContentId: `sha256:${'a'.repeat(64)}`,
    },
    {
      localAssetId: 'projector',
      assetId: 'projector',
      displayName: 'Projector',
      kind: 'auxiliary',
      engine: 'llama',
      status: 'installed',
      artifactRoles: ['mmproj'],
      expectedVerifiedContentId: `sha256:${'b'.repeat(64)}`,
    },
    {
      localAssetId: 'unverified',
      assetId: 'unverified',
      displayName: 'Unverified model',
      kind: 'chat',
      engine: 'llama',
      status: 'installed',
      artifactRoles: ['llm'],
    },
  ];

  assert.deepEqual(
    compatibleMachineLocalAssets(requirement, assets).map((asset) => asset.localAssetId),
    ['main'],
  );
  assert.deepEqual(compatibleMachineLocalAssets({
    ...requirement,
    compatibilityConstraints: { ...requirement.compatibilityConstraints, unknown_option: true },
  }, assets), []);
  assert.deepEqual(compatibleMachineLocalAssets({
    ...requirement,
    compatibilityConstraints: { ...requirement.compatibilityConstraints, engine: ['llama'] },
  }, assets), []);
  assert.deepEqual(compatibleMachineLocalAssets({
    ...requirement,
    compatibilityConstraints: {
      ...requirement.compatibilityConstraints,
      format: 'gguf',
      source_feature: 'reference-audio',
    },
  }, assets).map((asset) => asset.localAssetId), ['main']);
  const voxcpmAsset: NimiRuntimeLocalAssetEntry = {
    localAssetId: 'voxcpm',
    assetId: 'voxcpm',
    displayName: 'VoxCPM2',
    kind: 'tts',
    engine: 'speech',
    status: 'installed',
    family: 'voxcpm',
    artifactRoles: ['tts_model'],
    expectedVerifiedContentId: `sha256:${'c'.repeat(64)}`,
  };
  assert.deepEqual(compatibleMachineLocalAssets({
    ...requirement,
    compatibilityConstraints: {
      engine: 'speech',
      family: 'voxcpm',
      artifact_role: 'tts_model',
    },
  }, [voxcpmAsset]).map((asset) => asset.localAssetId), ['voxcpm']);
});

test('Local AI Configurations binds a compatible file directly from the slot select (bind-on-select)', () => {
  const boundAsset: NimiRuntimeLocalAssetEntry = {
    localAssetId: 'local-asset-main',
    assetId: 'local-asset-main',
    displayName: 'Main GGUF model',
    kind: 'chat',
    engine: 'llama',
    status: 'installed',
    artifactRoles: ['llm'],
    expectedVerifiedContentId: `sha256:${'a'.repeat(64)}`,
  };

  // Unbound slot: the select shows the choose-file placeholder, no separate bind button.
  const unboundMarkup = renderView(baseProps(
    { configurations: [configuration('unresolved')], selections: [] },
    { assets: [boundAsset] },
  ));
  assert.match(unboundMarkup, /role="combobox"/u);
  assert.match(unboundMarkup, /aria-label="Main model"/u);
  assert.match(unboundMarkup, /Choose a file/u);
  assert.match(unboundMarkup, /data-testid="machine-local-ai-requirement-bind:main\.gguf"/u);
  assert.doesNotMatch(unboundMarkup, />Connect</u);
  assert.doesNotMatch(unboundMarkup, />Replace</u);

  // Bound slot: the select value is the currently bound asset; disconnect stays a separate action.
  const boundMarkup = renderView(baseProps(
    { configurations: [configuration('configured')], selections: [] },
    { assets: [boundAsset] },
  ));
  assert.match(boundMarkup, /aria-label="Main model"/u);
  assert.match(boundMarkup, /Main GGUF model/u);
  assert.match(boundMarkup, />Disconnect</u);
  assert.doesNotMatch(boundMarkup, />Replace</u);
});

test('Local AI Configurations has matching Chinese user-facing status copy', async () => {
  await changeLocale('zh');
  try {
    const markup = renderView(baseProps({
      configurations: [configuration('unresolved')],
      selections: [],
    }));
    assert.match(markup, /本机模型设置/u);
    assert.match(markup, /待补齐文件/u);
    assert.doesNotMatch(markup, /就绪/u);
  } finally {
    await changeLocale('en');
  }
});
