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
  type MachineLocalAIConfigurationsViewProps,
} from '../src/shell/renderer/features/runtime-config/runtime-config-page-machine-local-ai.js';
import {
  INITIAL_RUNTIME_CONFIG_MACHINE_LOCAL_AI_STATE,
  compatibleMachineLocalAssets,
  machineLocalConfigurationFileState,
  reduceRuntimeConfigMachineLocalAIState,
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
    addDisplayName: '',
    addAcceptsImageInput: false,
    deleteConfirmationId: '',
    assetChoiceByRequirement: {},
    onRefresh: noop,
    onShowAddForm: noop,
    onHideAddForm: noop,
    onAddDisplayNameChange: noop,
    onAddAcceptsImageInputChange: noop,
    onAdd: noop,
    onSelect: noop,
    onClearSelection: noop,
    onReproject: noop,
    onAssetChoiceChange: noop,
    onBind: noop,
    onUnbind: noop,
    onRequestDelete: noop,
    onCancelDelete: noop,
    onConfirmDelete: noop,
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

  assert.match(markup, /data-testid="machine-local-ai-configurations-empty-info"/u);
  assert.match(markup, /No local AI configurations yet/u);
  assert.match(markup, /You can save it before its files are connected/u);
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
  assert.match(configuredMarkup, />Configured</u);
  assert.match(configuredMarkup, /does not verify that a request can run/u);
  assert.doesNotMatch(configuredMarkup, /\bready\b/iu);
  assert.match(configuredMarkup, /<details[\s\S]*Technical details[\s\S]*required_binding_missing|<details[\s\S]*Technical details/u);
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

  assert.match(markup, /image\.generate/u);
  assert.match(markup, /Local image model/u);
  assert.match(markup, /text\.generate/u);
  assert.match(markup, /Local writing model/u);
  assert.equal((markup.match(/>Selected</gu) ?? []).length, 2);
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

test('Local AI Configurations has matching Chinese user-facing status copy', async () => {
  await changeLocale('zh');
  try {
    const markup = renderView(baseProps({
      configurations: [configuration('unresolved')],
      selections: [],
    }));
    assert.match(markup, /本地 AI 配置/u);
    assert.match(markup, /待补齐文件/u);
    assert.doesNotMatch(markup, /就绪/u);
  } finally {
    await changeLocale('en');
  }
});
