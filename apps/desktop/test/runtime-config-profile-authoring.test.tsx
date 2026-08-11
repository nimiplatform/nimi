import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  NIMI_AI_PROFILE_LLAMA_CPP_EMBED_IMPLEMENTATION,
  NIMI_AI_PROFILE_LLAMA_CPP_IMPLEMENTATION,
  parseNimiPortableAIProfile,
  type NimiCapabilityAIConfig,
} from '@nimiplatform/sdk/ai';
import {
  AIProfileAuthoringView,
  type AIProfileAuthoringViewProps,
} from '../src/shell/renderer/features/runtime-config/runtime-config-page-profile-authoring.js';
import {
  changeRuntimeConfigAIProfileCapabilityContract,
  createRuntimeConfigAIProfileAuthoringState,
  exportRuntimeConfigAIProfileAuthoring,
  importRuntimeConfigAIProfileAuthoring,
  inspectRuntimeConfigAIProfileAuthoring,
  loadRuntimeConfigAIProfileAuthoringCurrentProjection,
  reduceRuntimeConfigAIProfileAuthoringState,
  type RuntimeConfigAIProfileAuthoringCurrentProjection,
  type RuntimeConfigAIProfileAuthoringDraft,
  type RuntimeConfigAIProfileAuthoringState,
} from '../src/shell/renderer/features/runtime-config/runtime-config-profile-authoring-state.js';
import {
  changeLocale,
  initI18n,
} from '../src/shell/renderer/i18n/index.js';

(globalThis as { React?: typeof React }).React = React;

const noop = () => undefined;

function validTextDraft(): RuntimeConfigAIProfileAuthoringDraft {
  const state = createRuntimeConfigAIProfileAuthoringState();
  return {
    ...state.draft,
    profileId: 'profile.desktop-authoring-test',
    title: 'Desktop authoring test',
    descriptionIncluded: true,
    description: 'Portable authoring round trip',
    provenanceJson: '{"publisher":"example.test","source":"desktop-authoring"}',
    licenseJson: '"Apache-2.0"',
    displayMetadataJson: '{"category":"test"}',
    capabilities: state.draft.capabilities.map((capability) => ({
      ...capability,
      requiredFeaturesText: 'input.image',
      defaultsJson: '{"temperature":0.4}',
      local: {
        ...capability.local,
        supportedFeaturesText: 'input.image',
        llama: {
          ...capability.local.llama,
          main: { policy: 'substitutable', verifiedContentId: '' },
          mmproj: { policy: 'substitutable', verifiedContentId: '' },
          contextSize: '8192',
        },
      },
    })),
  };
}

function currentProjection(): RuntimeConfigAIProfileAuthoringCurrentProjection {
  return {
    appId: 'nimi.desktop',
    appAIConfig: {
      owner: { owner: { oneofKind: 'app', app: { appId: 'nimi.desktop' } } },
      capabilities: [],
    },
    sharedAIConfig: {
      owner: {
        owner: {
          oneofKind: 'runtimeLocalAgentSubsystem',
          runtimeLocalAgentSubsystem: {},
        },
      },
      capabilities: [],
    },
    machine: {
      configurations: [{
        configurationId: 'lcc_current_text_only',
        capabilityContract: 'text.generate',
        implementation: { ...NIMI_AI_PROFILE_LLAMA_CPP_IMPLEMENTATION },
        portableConfig: { mainRequirementPolicy: 'substitutable' },
        supportedFeatures: [],
        requirementResolution: 'configured',
      }],
      selections: [{
        capabilityContract: 'text.generate',
        configurationId: 'lcc_current_text_only',
      }],
    },
  };
}

function stateWithDraft(draft: RuntimeConfigAIProfileAuthoringDraft): RuntimeConfigAIProfileAuthoringState {
  return {
    ...createRuntimeConfigAIProfileAuthoringState(),
    draft,
  };
}

function renderAuthoring(
  state: RuntimeConfigAIProfileAuthoringState,
  projection: RuntimeConfigAIProfileAuthoringCurrentProjection | null = currentProjection(),
  overrides: Partial<AIProfileAuthoringViewProps> = {},
): string {
  return renderToStaticMarkup(
    <AIProfileAuthoringView
      state={state}
      inspection={inspectRuntimeConfigAIProfileAuthoring(state.draft, projection)}
      projectionStatus={projection ? 'ready' : 'loading'}
      projectionTechnicalError=""
      onDraftChange={noop}
      onImportFile={noop}
      onExport={noop}
      onReloadProjection={noop}
      {...overrides}
    />,
  );
}

test.before(async () => {
  await initI18n();
  await changeLocale('en');
});

test('AIProfile authoring state imports, edits, and exports one SDK-validated portable round trip', () => {
  const draft = validTextDraft();
  const exported = exportRuntimeConfigAIProfileAuthoring(draft);
  const importedDraft = importRuntimeConfigAIProfileAuthoring(exported.artifactJson);
  const reexported = exportRuntimeConfigAIProfileAuthoring(importedDraft);

  assert.deepEqual(
    parseNimiPortableAIProfile(reexported.artifactJson),
    parseNimiPortableAIProfile(exported.artifactJson),
  );
  assert.equal(exported.fileName, 'profile.desktop-authoring-test.ai-profile.json');

  let state = createRuntimeConfigAIProfileAuthoringState();
  state = reduceRuntimeConfigAIProfileAuthoringState(state, {
    type: 'import-succeeded',
    draft: importedDraft,
  });
  assert.equal(state.operation, 'imported');
  state = reduceRuntimeConfigAIProfileAuthoringState(state, { type: 'export-succeeded' });
  assert.equal(state.operation, 'exported');
  state = reduceRuntimeConfigAIProfileAuthoringState(state, {
    type: 'draft-changed',
    draft: { ...state.draft, title: 'Edited after export' },
  });
  assert.equal(state.operation, 'editing');
  assert.equal(state.revision, 2);
});

test('AIProfile authoring derives all four read-only journey actions and presents feature mismatch', () => {
  const draft = validTextDraft();
  const inspection = inspectRuntimeConfigAIProfileAuthoring(draft, currentProjection());
  assert.equal(inspection.status, 'valid');
  if (inspection.status !== 'valid') assert.fail('expected valid authoring inspection');
  assert.ok(inspection.model.journey);
  assert.equal(inspection.model.journey?.importPreview.previewOnly, true);
  assert.equal(inspection.model.journey?.appApplyPreview.previewOnly, true);
  assert.equal(inspection.model.journey?.sharedApplyPreview.previewOnly, true);
  assert.equal(inspection.model.journey?.localConfigurationPreviews[0]?.decision.kind, 'add-new');
  assert.equal(
    inspection.model.journey?.selectionPreviews[0]?.branches[0].featureSubset.status,
    'feature-mismatch',
  );
  assert.equal(
    inspection.model.journey?.selectionPreviews[0]?.branches[1].featureSubset.status,
    'compatible',
  );
  assert.deepEqual(
    inspection.model.requirements[0]?.projection.requirements.map((requirement) => [
      requirement.role,
      requirement.occurrenceOrdinal,
      requirement.displayLabel,
      requirement.resourceKind,
      requirement.policy,
    ]),
    [
      ['main', 0, 'Main model', 'gguf', 'substitutable'],
      ['companion', 0, 'Vision projector', 'mmproj', 'substitutable'],
    ],
  );

  const markup = renderAuthoring(stateWithDraft(draft));
  assert.match(markup, /data-testid="ai-profile-authoring-import-preview"/u);
  assert.match(markup, /data-testid="ai-profile-authoring-apply-preview:app"/u);
  assert.match(markup, /data-testid="ai-profile-authoring-apply-preview:shared-local-agent"/u);
  assert.match(markup, /data-testid="ai-profile-authoring-local-preview"/u);
  assert.match(markup, /data-testid="ai-profile-authoring-selection-preview"/u);
  assert.match(markup, /data-feature-status="feature-mismatch"/u);
  assert.match(markup, /The final requirement set is always the Runtime projection/u);
  assert.match(markup, /data-preview-commits="false"/u);
  assert.doesNotMatch(markup, /type="submit"/u);
  assert.doesNotMatch(markup, /Confirm Apply|Save configuration/u);
});

test('AIProfile authoring renders stable-diffusion typed fields and ordered LoRA occurrences', () => {
  let draft = validTextDraft();
  draft = changeRuntimeConfigAIProfileCapabilityContract(
    draft,
    draft.capabilities[0]!.draftId,
    'image.generate',
  );
  const capability = draft.capabilities[0]!;
  draft = {
    ...draft,
    capabilities: [{
      ...capability,
      requiredFeaturesText: 'input.image',
      local: {
        ...capability.local,
        supportedFeaturesText: 'input.image',
        stableDiffusion: {
          ...capability.local.stableDiffusion,
          modelFamily: 'ideogram4',
          enableInputImage: 'true',
          loras: [
            {
              draftId: 'lora-a',
              displayLabel: 'Portrait detail',
              policy: 'substitutable',
              verifiedContentId: '',
              weight: '1',
            },
            {
              draftId: 'lora-b',
              displayLabel: 'Lighting',
              policy: 'substitutable',
              verifiedContentId: '',
              weight: '0.5',
            },
          ],
          execution: {
            ...capability.local.stableDiffusion.execution,
            steps: '30',
            cfgScale: '6.5',
            width: '1024',
            height: '768',
            seed: '-1',
            sampler: 'euler_a',
            scheduler: 'karras',
            threads: '8',
            diffusionFlashAttention: 'true',
            offloadParamsToCPU: 'false',
          },
        },
      },
    }],
  };
  const projection: RuntimeConfigAIProfileAuthoringCurrentProjection = {
    ...currentProjection(),
    machine: { configurations: [], selections: [] },
  };
  const markup = renderAuthoring(stateWithDraft(draft), projection);

  assert.match(markup, /data-testid="ai-profile-authoring-stable-diffusion-fields"/u);
  assert.match(markup, /data-testid="ai-profile-authoring-lora:1"[^>]*data-occurrence-ordinal="1"/u);
  assert.match(markup, /data-testid="ai-profile-authoring-lora:2"[^>]*data-occurrence-ordinal="2"/u);
  assert.ok(markup.indexOf('Portrait detail') < markup.indexOf('Lighting'));
  assert.match(markup, /Unconditional diffusion model/u);
  assert.match(markup, /data-testid="ai-profile-authoring-sd-execution-options"/u);
});

test('AIProfile authoring round-trips the exact portable llama embedding section', () => {
  let draft = validTextDraft();
  draft = changeRuntimeConfigAIProfileCapabilityContract(
    draft,
    draft.capabilities[0]!.draftId,
    'text.embed',
  );
  const capability = draft.capabilities[0]!;
  assert.equal(capability.local.driverKind, 'llama-embed');
  assert.equal(capability.local.includeImplementation, true);
  draft = {
    ...draft,
    capabilities: [{
      ...capability,
      requiredFeaturesText: '',
      local: {
        ...capability.local,
        supportedFeaturesText: '',
        llama: {
          ...capability.local.llama,
          main: { policy: 'substitutable', verifiedContentId: '' },
          mmproj: { policy: '', verifiedContentId: '' },
          contextSize: '4096',
        },
      },
    }],
  };
  const projection: RuntimeConfigAIProfileAuthoringCurrentProjection = {
    ...currentProjection(),
    machine: { configurations: [], selections: [] },
  };
  const inspection = inspectRuntimeConfigAIProfileAuthoring(draft, projection);
  assert.equal(inspection.status, 'valid');
  if (inspection.status !== 'valid') assert.fail('expected valid embedding authoring inspection');
  assert.deepEqual(inspection.model.requirements[0]?.projection.requirements.map((requirement) => [
    requirement.requirementId,
    requirement.role,
    requirement.displayLabel,
    requirement.resourceKind,
    requirement.policy,
  ]), [[
    'embedding.gguf',
    'main',
    'Embedding model',
    'gguf',
    'substitutable',
  ]]);

  const markup = renderAuthoring(stateWithDraft(draft), projection);
  assert.match(markup, /data-testid="ai-profile-authoring-capability:text\.embed"/u);
  assert.match(markup, /data-testid="ai-profile-authoring-llama-fields"/u);
  assert.match(markup, /llama\.cpp\/text-embed\/v1/u);
  assert.doesNotMatch(markup, /Vision projector requirement/u);

  const exported = exportRuntimeConfigAIProfileAuthoring(draft);
  const profile = parseNimiPortableAIProfile(exported.artifactJson);
  assert.deepEqual(profile.capabilities['text.embed']?.implementation, {
    ...NIMI_AI_PROFILE_LLAMA_CPP_EMBED_IMPLEMENTATION,
    supportedFeatures: [],
  });
  const importedDraft = importRuntimeConfigAIProfileAuthoring(exported.artifactJson);
  assert.equal(importedDraft.capabilities[0]!.local.driverKind, 'llama-embed');
  assert.deepEqual(
    parseNimiPortableAIProfile(
      exportRuntimeConfigAIProfileAuthoring(importedDraft).artifactJson,
    ),
    profile,
  );
});

test('AIProfile authoring renders the stable-diffusion video section and round-trips its portable config', () => {
  let draft = validTextDraft();
  draft = changeRuntimeConfigAIProfileCapabilityContract(
    draft,
    draft.capabilities[0]!.draftId,
    'video.generate',
  );
  const capability = draft.capabilities[0]!;
  assert.equal(capability.local.driverKind, 'stable-diffusion-video');
  assert.equal(capability.local.includeImplementation, true);
  draft = {
    ...draft,
    capabilities: [{
      ...capability,
      local: {
        ...capability.local,
        supportedFeaturesText: 'input.image',
        stableDiffusionVideo: {
          ...capability.local.stableDiffusionVideo,
          fl2va: { policy: 'strict', verifiedContentId: `sha256:${'e'.repeat(64)}` },
        },
      },
    }],
  };
  const projection: RuntimeConfigAIProfileAuthoringCurrentProjection = {
    ...currentProjection(),
    machine: { configurations: [], selections: [] },
  };
  const inspection = inspectRuntimeConfigAIProfileAuthoring(draft, projection);
  assert.equal(inspection.status, 'valid');
  if (inspection.status !== 'valid') assert.fail('expected valid authoring inspection');
  assert.equal(inspection.model.journey?.localConfigurationPreviews[0]?.decision.kind, 'add-new');
  assert.deepEqual(
    inspection.model.requirements[0]?.projection.requirements.map((requirement) => [
      requirement.requirementId,
      requirement.role,
      requirement.displayLabel,
      requirement.resourceKind,
      requirement.policy,
    ]),
    [
      ['diffusion.fl2va', 'main', 'MiniMax-H3 FL2VA transformer', 'video', 'strict'],
      ['diffusion.ref2va', 'companion', 'MiniMax-H3 Ref2VA transformer', 'video', 'substitutable'],
      ['encoder.h3-combined', 'companion', 'MiniMax-H3 combined Qwen3-VL encoder', 'chat', 'substitutable'],
      ['vae.video', 'companion', 'MiniMax-H3 video VAE', 'vae', 'substitutable'],
      ['vae.audio', 'companion', 'MiniMax-H3 audio VAE', 'vae', 'substitutable'],
    ],
  );

  const markup = renderAuthoring(stateWithDraft(draft), projection);
  assert.match(markup, /data-testid="ai-profile-authoring-capability:video\.generate"/u);
  assert.match(markup, /data-testid="ai-profile-authoring-stable-diffusion-video-fields"/u);
  assert.match(markup, /Main video model \(FL2VA\) requirement/u);
  assert.match(markup, /stable-diffusion\.cpp\/minimax-h3-video-generate\/v1/u);
  assert.match(markup, /MiniMax-H3 FL2VA transformer/u);
  assert.doesNotMatch(markup, /data-testid="ai-profile-authoring-stable-diffusion-fields"/u);

  const exported = exportRuntimeConfigAIProfileAuthoring(draft);
  const importedDraft = importRuntimeConfigAIProfileAuthoring(exported.artifactJson);
  assert.equal(importedDraft.capabilities[0]!.capabilityContract, 'video.generate');
  assert.equal(importedDraft.capabilities[0]!.local.driverKind, 'stable-diffusion-video');
  assert.deepEqual(
    importedDraft.capabilities[0]!.local.stableDiffusionVideo,
    draft.capabilities[0]!.local.stableDiffusionVideo,
  );
  const reexported = exportRuntimeConfigAIProfileAuthoring(importedDraft);
  assert.deepEqual(
    parseNimiPortableAIProfile(reexported.artifactJson),
    parseNimiPortableAIProfile(exported.artifactJson),
  );
});

test('AIProfile Cloud recommendation form has implementation and target fields but no account or grant inputs', () => {
  const draft = validTextDraft();
  const capability = draft.capabilities[0]!;
  const cloudDraft: RuntimeConfigAIProfileAuthoringDraft = {
    ...draft,
    capabilities: [{
      ...capability,
      route: 'cloud',
      cloud: {
        implementationId: 'cloud.text.example',
        driverId: 'nimi.runtime.driver.example',
        driverDialect: 'example/text/v1',
        supportedFeaturesText: 'input.image',
        providerModelTargetJson: '{"provider":"example","providerModelId":"vision-v1"}',
      },
    }],
  };
  const markup = renderAuthoring(stateWithDraft(cloudDraft));

  assert.match(markup, /data-testid="ai-profile-authoring-cloud-section"/u);
  assert.match(markup, /data-authoring-account-fields="absent"/u);
  assert.match(markup, /data-authoring-grant-fields="absent"/u);
  assert.match(markup, /data-authoring-field="cloud-implementation-id"/u);
  assert.match(markup, /data-authoring-field="cloud-provider-model-target"/u);
  assert.doesNotMatch(markup, /data-authoring-field="[^"]*(?:account|grant|credential|secret)/iu);
  assert.match(markup, /selection-required/u);
});

test('AIProfile import rejects forbidden identity and the authoring view presents a fail-closed information state', () => {
  const portable = JSON.parse(
    exportRuntimeConfigAIProfileAuthoring(validTextDraft()).artifactJson,
  ) as Record<string, unknown>;
  portable.displayMetadata = { nested: { machineId: 'machine-private' } };
  assert.throws(
    () => importRuntimeConfigAIProfileAuthoring(JSON.stringify(portable)),
    /machineId is forbidden/u,
  );

  const invalidDraft = {
    ...validTextDraft(),
    provenanceJson: '{"machineId":"machine-private"}',
  };
  let state = stateWithDraft(invalidDraft);
  state = reduceRuntimeConfigAIProfileAuthoringState(state, {
    type: 'operation-failed',
    source: 'import',
    technicalError: 'AIProfile.provenance.machineId is forbidden in portable AIProfile authoring',
  });
  const markup = renderAuthoring(state);
  assert.match(markup, /data-testid="ai-profile-authoring-operation-error"/u);
  assert.match(markup, /could not be imported for editing/u);
  assert.match(markup, /data-testid="ai-profile-authoring-preview"/u);
  assert.match(markup, /current draft cannot be projected/u);
  assert.match(markup, /machineId is forbidden/u);
});

test('AIProfile authoring current projection loader performs only the three injected reads', async () => {
  const calls: string[] = [];
  const app: NimiCapabilityAIConfig = {
    owner: { owner: { oneofKind: 'app', app: { appId: 'nimi.desktop' } } },
    capabilities: [],
  };
  const shared: NimiCapabilityAIConfig = {
    owner: {
      owner: {
        oneofKind: 'runtimeLocalAgentSubsystem',
        runtimeLocalAgentSubsystem: {},
      },
    },
    capabilities: [],
  };
  const projection = await loadRuntimeConfigAIProfileAuthoringCurrentProjection({
    appId: 'nimi.desktop',
    async getAppAIConfig() {
      calls.push('app.get');
      return app;
    },
    async getSharedAIConfig() {
      calls.push('shared.get');
      return shared;
    },
    async getMachine() {
      calls.push('machine.get');
      return { configurations: [], selections: [] };
    },
  });

  assert.deepEqual(calls.sort(), ['app.get', 'machine.get', 'shared.get']);
  assert.equal(projection.appAIConfig, app);
  assert.deepEqual(projection.machine, { configurations: [], selections: [] });
});

test('AIProfile authoring has matching Chinese form, preview, and no-commit copy', async () => {
  await changeLocale('zh');
  try {
    const markup = renderAuthoring(stateWithDraft(validTextDraft()));
    assert.match(markup, /创作可移植 AIProfile/u);
    assert.match(markup, /仅预览/u);
    assert.match(markup, /最终需求集合始终以 Runtime 投影为准/u);
    assert.match(markup, /特性不匹配/u);
    assert.match(markup, /不能写入 AIConfig/u);
  } finally {
    await changeLocale('en');
  }
});
