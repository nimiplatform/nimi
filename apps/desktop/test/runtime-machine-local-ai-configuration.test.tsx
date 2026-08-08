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
import { MachineLocalAIAddFormFields } from '../src/shell/renderer/features/runtime-config/runtime-config-machine-local-ai-add-drawer.js';
import { MachineLocalAIImpactDialogContent } from '../src/shell/renderer/features/runtime-config/runtime-config-machine-local-ai-card.js';
import {
  INITIAL_RUNTIME_CONFIG_MACHINE_LOCAL_AI_STATE,
  compatibleMachineLocalAssets,
  createRuntimeConfigMachineLocalAIAddDraft,
  machineLocalConfigurationFileState,
  moveRuntimeConfigMachineLocalAILoRA,
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

test('Local AI Configurations renders the image form, ordered LoRA controls, and a bundle as one file choice', () => {
  const initial = createRuntimeConfigMachineLocalAIAddDraft();
  const loras = moveRuntimeConfigMachineLocalAILoRA([
    {
      draftId: 'lora-a',
      displayLabel: 'First style',
      requirementPolicy: 'substitutable',
      localAssetId: '',
      weight: '1',
    },
    {
      draftId: 'lora-b',
      displayLabel: 'Second style',
      requirementPolicy: 'substitutable',
      localAssetId: '',
      weight: '0.5',
    },
  ], 1, -1);
  assert.deepEqual(loras.map((lora) => lora.displayLabel), ['Second style', 'First style']);
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
    slots: {
      ...initial.slots,
      main: { requirementPolicy: 'strict' as const, localAssetId: bundle.localAssetId },
    },
    loras,
  };
  const markup = renderToStaticMarkup(
    <MachineLocalAIAddFormFields draft={draft} assets={[bundle]} busy={false} onChange={noop} />,
  );

  assert.match(markup, /data-testid="machine-local-ai-configuration-add-form"/u);
  assert.match(markup, /data-testid="machine-local-ai-image-fields"/u);
  assert.match(markup, /Diffusion model/u);
  assert.match(markup, /Text encoder/u);
  assert.match(markup, /data-testid="machine-local-ai-lora:1"[^>]*data-occurrence-ordinal="1"/u);
  assert.ok(markup.indexOf('Second style') < markup.indexOf('First style'));
  assert.equal((markup.match(/Image model bundle · File bundle/gu) ?? []).length, 1);
  assert.doesNotMatch(markup, /shard-1\.gguf|shard-2\.gguf/u);
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
