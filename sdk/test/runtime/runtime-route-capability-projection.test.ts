import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRuntimeRouteCapabilityProjection,
  buildRuntimeRouteCapabilityProjectionMap,
  createDefaultRuntimeRouteCapabilitySelectionStore,
  getRuntimeRouteCapabilityProjectionIssueKind,
  isRuntimeRouteCapabilityProjectionReady,
  isRuntimeRouteCapabilityProjectionSelectionRequired,
  toRuntimeRouteCanonicalCapability,
  updateRuntimeRouteCapabilityBinding,
  type RuntimeRouteCapabilityRuntime,
} from '../../src/runtime/index.js';

function createRuntime(): RuntimeRouteCapabilityRuntime {
  return {
    resolve: async ({ capability, binding }) => ({
      capability: toRuntimeRouteCanonicalCapability(capability),
      resolvedBindingRef: `${capability}:resolved`,
      source: binding?.source || 'cloud',
      connectorId: binding?.connectorId || 'tester-cloud',
      provider: binding?.provider || 'tester',
      model: binding?.model || 'tester-model',
      modelId: binding?.modelId || binding?.model || 'tester-model',
    }),
    checkHealth: async () => ({
      healthy: true,
      status: 'healthy',
      detail: 'ready',
    }),
    describe: async ({ capability, resolvedBindingRef }) => {
      if (capability === 'text.generate') {
        return {
          capability: 'text.generate',
          metadataVersion: 'v1',
          resolvedBindingRef,
          metadataKind: 'text.generate',
          metadata: {
            supportsThinking: true,
            traceModeSupport: 'separate',
            supportsImageInput: false,
            supportsAudioInput: false,
            supportsVideoInput: false,
            supportsArtifactRefInput: false,
          },
        };
      }
      if (capability === 'audio.synthesize') {
        return {
          capability: 'audio.synthesize',
          metadataVersion: 'v1',
          resolvedBindingRef,
          metadataKind: 'audio.synthesize',
          metadata: {
            supportedAudioFormats: ['audio/wav'],
            defaultAudioFormat: 'audio/wav',
            supportedTimingModes: ['none'],
            supportsLanguage: false,
            supportsEmotion: false,
          },
        };
      }
      throw new Error('AI_ROUTE_UNSUPPORTED');
    },
  };
}

test('runtime route capability projection builds ready projection from injected Runtime route surface', async () => {
  const selectionStore = updateRuntimeRouteCapabilityBinding(
    createDefaultRuntimeRouteCapabilitySelectionStore(),
    'text.generate',
    { source: 'cloud', connectorId: 'tester-cloud', model: 'tester-model' },
  );
  const projection = await buildRuntimeRouteCapabilityProjection({
    capability: 'text.generate',
    selectionStore,
    routeRuntime: createRuntime(),
  });

  assert.equal(projection.supported, true);
  assert.equal(isRuntimeRouteCapabilityProjectionReady(projection), true);
  assert.equal(getRuntimeRouteCapabilityProjectionIssueKind(projection), null);
  assert.equal(projection.reasonCode, null);
  assert.equal(projection.resolvedBinding?.resolvedBindingRef, 'text.generate:resolved');
  assert.equal(projection.metadata?.metadataKind, 'text.generate');
});

test('runtime route capability projection fails closed without selection or route metadata', async () => {
  const missingSelection = await buildRuntimeRouteCapabilityProjection({
    capability: 'text.generate',
    selectionStore: createDefaultRuntimeRouteCapabilitySelectionStore(),
    routeRuntime: createRuntime(),
  });
  assert.equal(missingSelection.supported, false);
  assert.equal(missingSelection.reasonCode, 'selection_missing');
  assert.equal(isRuntimeRouteCapabilityProjectionSelectionRequired(missingSelection), true);
  assert.equal(getRuntimeRouteCapabilityProjectionIssueKind(missingSelection), 'needs_selection');

  const imageSelection = updateRuntimeRouteCapabilityBinding(
    createDefaultRuntimeRouteCapabilitySelectionStore(),
    'image.edit',
    { source: 'local', connectorId: '', model: 'image-model' },
  );
  const missingMetadata = await buildRuntimeRouteCapabilityProjection({
    capability: 'image.edit',
    selectionStore: imageSelection,
    routeRuntime: createRuntime(),
  });
  assert.equal(missingMetadata.supported, false);
  assert.equal(missingMetadata.reasonCode, 'metadata_missing');
  assert.equal(isRuntimeRouteCapabilityProjectionReady(missingMetadata), false);
  assert.equal(getRuntimeRouteCapabilityProjectionIssueKind(missingMetadata), 'metadata_missing');
  assert.equal(missingMetadata.capability, 'image.edit');
});

test('runtime route capability projection maps host and capability failures without owning route truth', async () => {
  const selectionStore = updateRuntimeRouteCapabilityBinding(
    createDefaultRuntimeRouteCapabilitySelectionStore(),
    'audio.synthesize',
    { source: 'cloud', connectorId: 'tester-cloud', model: 'tester-tts' },
  );
  const denied = await buildRuntimeRouteCapabilityProjection({
    capability: 'audio.synthesize',
    selectionStore,
    routeRuntime: createRuntime(),
    hostAllowed: false,
  });
  assert.equal(denied.reasonCode, 'host_denied');
  assert.equal(getRuntimeRouteCapabilityProjectionIssueKind(denied), 'host_denied');

  const unsupported = await buildRuntimeRouteCapabilityProjection({
    capability: 'video.generate',
    selectionStore: updateRuntimeRouteCapabilityBinding(
      createDefaultRuntimeRouteCapabilitySelectionStore(),
      'video.generate',
      { source: 'cloud', connectorId: 'tester-cloud', model: 'tester-video' },
    ),
    routeRuntime: {
      ...createRuntime(),
      resolve: async () => {
        throw new Error('AI_ROUTE_UNSUPPORTED');
      },
    },
  });
  assert.equal(unsupported.reasonCode, 'capability_unsupported');
  assert.equal(getRuntimeRouteCapabilityProjectionIssueKind(unsupported), 'capability_unsupported');
});

test('runtime route capability projection map refreshes requested capabilities', async () => {
  const selectionStore = updateRuntimeRouteCapabilityBinding(
    updateRuntimeRouteCapabilityBinding(
      createDefaultRuntimeRouteCapabilitySelectionStore(),
      'text.generate',
      { source: 'cloud', connectorId: 'tester-cloud', model: 'tester-model' },
    ),
    'audio.synthesize',
    { source: 'cloud', connectorId: 'tester-cloud', model: 'tester-tts' },
  );
  const projections = await buildRuntimeRouteCapabilityProjectionMap({
    selectionStore,
    routeRuntime: createRuntime(),
    capabilities: ['text.generate', 'audio.synthesize'],
  });

  assert.equal(projections['text.generate']?.supported, true);
  assert.equal(projections['audio.synthesize']?.supported, true);
  assert.equal(projections['image.edit'], undefined);
});
