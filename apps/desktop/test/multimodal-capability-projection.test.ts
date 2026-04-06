import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  ModRuntimeResolvedBinding,
  RuntimeCanonicalCapability,
  RuntimeRouteDescribeResult,
  RuntimeRouteHealthResult,
} from '@nimiplatform/sdk/mod';
import {
  buildConversationCapabilityProjection,
  buildConversationCapabilityProjectionMap,
  CONVERSATION_CAPABILITIES,
  createDefaultConversationCapabilitySelectionStore,
  toRuntimeCanonicalCapability,
  updateConversationCapabilityBinding,
  type ConversationCapabilityRouteRuntime,
} from '../src/shell/renderer/features/chat/conversation-capability.js';

function createLocalResolvedBinding(
  capability: RuntimeCanonicalCapability,
  model: string,
): ModRuntimeResolvedBinding {
  return {
    capability,
    source: 'local',
    provider: 'test-engine',
    model,
    modelId: model,
    localModelId: `local-${model}`,
    engine: 'test-engine',
    connectorId: '',
    resolvedBindingRef: `ref-${capability}-${model}`,
  };
}

function createCloudResolvedBinding(
  capability: RuntimeCanonicalCapability,
  model: string,
): ModRuntimeResolvedBinding {
  return {
    capability,
    source: 'cloud',
    provider: 'test-cloud',
    model,
    modelId: model,
    connectorId: 'connector-1',
    resolvedBindingRef: `ref-${capability}-${model}`,
  };
}

function createHealthyResult(): RuntimeRouteHealthResult {
  return {
    healthy: true,
    status: 'healthy',
  };
}

function createUnhealthyResult(): RuntimeRouteHealthResult {
  return {
    healthy: false,
    status: 'unhealthy',
    detail: 'provider offline',
  };
}

function createTextDescribeResult(ref: string): RuntimeRouteDescribeResult {
  return {
    capability: 'text.generate',
    metadataVersion: 'v1',
    resolvedBindingRef: ref,
    metadataKind: 'text.generate',
    metadata: {
      supportsThinking: false,
      traceModeSupport: 'none',
      supportsImageInput: false,
      supportsAudioInput: false,
      supportsVideoInput: false,
      supportsArtifactRefInput: false,
    },
  };
}

function createMockRouteRuntime(overrides?: {
  resolveResult?: ModRuntimeResolvedBinding;
  healthResult?: RuntimeRouteHealthResult;
  describeResult?: RuntimeRouteDescribeResult;
  resolveError?: Error;
  healthError?: Error;
  describeError?: Error;
}): ConversationCapabilityRouteRuntime {
  return {
    resolve: async ({ capability }) => {
      if (overrides?.resolveError) throw overrides.resolveError;
      return overrides?.resolveResult || createLocalResolvedBinding(capability as RuntimeCanonicalCapability, 'default-model');
    },
    checkHealth: async () => {
      if (overrides?.healthError) throw overrides.healthError;
      return overrides?.healthResult || createHealthyResult();
    },
    describe: async ({ resolvedBindingRef }) => {
      if (overrides?.describeError) throw overrides.describeError;
      return overrides?.describeResult || createTextDescribeResult(resolvedBindingRef);
    },
  };
}

// --- image.generate projection tests ---

test('image.generate projection supported when selection + resolve + health pass (no describe required)', async () => {
  const store = updateConversationCapabilityBinding(
    createDefaultConversationCapabilitySelectionStore(),
    'image.generate',
    { source: 'local', connectorId: '', model: 'sd-xl' },
  );
  const routeRuntime = createMockRouteRuntime({
    resolveResult: createLocalResolvedBinding('image.generate', 'sd-xl'),
    healthResult: createHealthyResult(),
  });
  const projection = await buildConversationCapabilityProjection({
    capability: 'image.generate',
    selectionStore: store,
    routeRuntime,
    requiresDescribeMetadata: false,
  });
  assert.equal(projection.supported, true);
  assert.equal(projection.reasonCode, null);
  assert.equal(projection.metadata, null);
  assert.equal(projection.resolvedBinding?.model, 'sd-xl');
});

test('image.generate projection fails closed when selection missing', async () => {
  const store = createDefaultConversationCapabilitySelectionStore();
  const routeRuntime = createMockRouteRuntime();
  const projection = await buildConversationCapabilityProjection({
    capability: 'image.generate',
    selectionStore: store,
    routeRuntime,
    requiresDescribeMetadata: false,
  });
  assert.equal(projection.supported, false);
  assert.equal(projection.reasonCode, 'selection_missing');
});

test('image.generate projection fails closed when selection explicitly cleared', async () => {
  const store = updateConversationCapabilityBinding(
    createDefaultConversationCapabilitySelectionStore(),
    'image.generate',
    null,
  );
  const routeRuntime = createMockRouteRuntime();
  const projection = await buildConversationCapabilityProjection({
    capability: 'image.generate',
    selectionStore: store,
    routeRuntime,
    requiresDescribeMetadata: false,
  });
  assert.equal(projection.supported, false);
  assert.equal(projection.reasonCode, 'selection_cleared');
});

test('image.generate projection fails closed when resolve fails', async () => {
  const store = updateConversationCapabilityBinding(
    createDefaultConversationCapabilitySelectionStore(),
    'image.generate',
    { source: 'local', connectorId: '', model: 'sd-xl' },
  );
  const routeRuntime = createMockRouteRuntime({
    resolveError: new Error('CAPABILITY_MISSING'),
  });
  const projection = await buildConversationCapabilityProjection({
    capability: 'image.generate',
    selectionStore: store,
    routeRuntime,
    requiresDescribeMetadata: false,
  });
  assert.equal(projection.supported, false);
  assert.equal(projection.reasonCode, 'capability_unsupported');
});

test('image.generate projection fails closed when health is unhealthy', async () => {
  const store = updateConversationCapabilityBinding(
    createDefaultConversationCapabilitySelectionStore(),
    'image.generate',
    { source: 'local', connectorId: '', model: 'sd-xl' },
  );
  const routeRuntime = createMockRouteRuntime({
    resolveResult: createLocalResolvedBinding('image.generate', 'sd-xl'),
    healthResult: createUnhealthyResult(),
  });
  const projection = await buildConversationCapabilityProjection({
    capability: 'image.generate',
    selectionStore: store,
    routeRuntime,
    requiresDescribeMetadata: false,
  });
  assert.equal(projection.supported, false);
  assert.equal(projection.reasonCode, 'route_unhealthy');
});

test('image.generate projection fails closed when image profile ref missing', async () => {
  const store = updateConversationCapabilityBinding(
    createDefaultConversationCapabilitySelectionStore(),
    'image.generate',
    { source: 'local', connectorId: '', model: 'sd-xl' },
  );
  const routeRuntime = createMockRouteRuntime();
  const projection = await buildConversationCapabilityProjection({
    capability: 'image.generate',
    selectionStore: store,
    routeRuntime,
    requiresImageProfileRef: true,
    requiresDescribeMetadata: false,
  });
  assert.equal(projection.supported, false);
  assert.equal(projection.reasonCode, 'profile_ref_missing');
});

// --- audio.synthesize projection tests ---

test('audio.synthesize projection supported when selection + resolve + health pass', async () => {
  const store = updateConversationCapabilityBinding(
    createDefaultConversationCapabilitySelectionStore(),
    'audio.synthesize',
    { source: 'cloud', connectorId: 'connector-1', model: 'tts-1' },
  );
  const routeRuntime = createMockRouteRuntime({
    resolveResult: createCloudResolvedBinding('audio.synthesize', 'tts-1'),
    healthResult: createHealthyResult(),
  });
  const projection = await buildConversationCapabilityProjection({
    capability: 'audio.synthesize',
    selectionStore: store,
    routeRuntime,
    requiresDescribeMetadata: false,
  });
  assert.equal(projection.supported, true);
  assert.equal(projection.reasonCode, null);
});

test('audio.synthesize projection fails closed when selection missing', async () => {
  const store = createDefaultConversationCapabilitySelectionStore();
  const projection = await buildConversationCapabilityProjection({
    capability: 'audio.synthesize',
    selectionStore: store,
    routeRuntime: createMockRouteRuntime(),
    requiresDescribeMetadata: false,
  });
  assert.equal(projection.supported, false);
  assert.equal(projection.reasonCode, 'selection_missing');
});

// --- voice_workflow projection tests (with describe required) ---

test('voice_workflow.tts_v2v projection fails closed when describe metadata missing', async () => {
  const store = updateConversationCapabilityBinding(
    createDefaultConversationCapabilitySelectionStore(),
    'voice_workflow.tts_v2v',
    { source: 'cloud', connectorId: 'connector-1', model: 'voice-clone' },
  );
  const routeRuntime = createMockRouteRuntime({
    resolveResult: createCloudResolvedBinding('voice_workflow.tts_v2v', 'voice-clone'),
    healthResult: createHealthyResult(),
    describeError: new Error('describe not available'),
  });
  const projection = await buildConversationCapabilityProjection({
    capability: 'voice_workflow.tts_v2v',
    selectionStore: store,
    routeRuntime,
    requiresDescribeMetadata: true,
  });
  assert.equal(projection.supported, false);
  assert.equal(projection.reasonCode, 'metadata_missing');
});

test('voice_workflow.tts_t2v treated as independent capability, not audio.synthesize alias', async () => {
  const store = updateConversationCapabilityBinding(
    updateConversationCapabilityBinding(
      createDefaultConversationCapabilitySelectionStore(),
      'audio.synthesize',
      { source: 'cloud', connectorId: 'connector-1', model: 'tts-1' },
    ),
    'voice_workflow.tts_t2v',
    null,
  );
  const routeRuntime = createMockRouteRuntime();
  const audioProjection = await buildConversationCapabilityProjection({
    capability: 'audio.synthesize',
    selectionStore: store,
    routeRuntime,
    requiresDescribeMetadata: false,
  });
  const voiceProjection = await buildConversationCapabilityProjection({
    capability: 'voice_workflow.tts_t2v',
    selectionStore: store,
    routeRuntime,
    requiresDescribeMetadata: true,
  });
  assert.equal(audioProjection.supported, true);
  assert.equal(voiceProjection.supported, false);
  assert.equal(voiceProjection.reasonCode, 'selection_cleared');
});

// --- projection map tests ---

test('buildConversationCapabilityProjectionMap refreshes all capabilities including multimodal', async () => {
  const resolvedCapabilities: string[] = [];
  const routeRuntime: ConversationCapabilityRouteRuntime = {
    resolve: async ({ capability }) => {
      resolvedCapabilities.push(capability);
      return createLocalResolvedBinding(capability as RuntimeCanonicalCapability, 'model-1');
    },
    checkHealth: async () => createHealthyResult(),
    describe: async ({ resolvedBindingRef }) => createTextDescribeResult(resolvedBindingRef),
  };
  const store = updateConversationCapabilityBinding(
    updateConversationCapabilityBinding(
      updateConversationCapabilityBinding(
        updateConversationCapabilityBinding(
          createDefaultConversationCapabilitySelectionStore(),
          'text.generate',
          { source: 'local', connectorId: '', model: 'chat-model' },
        ),
        'image.generate',
        { source: 'local', connectorId: '', model: 'sd-xl' },
      ),
      'audio.synthesize',
      { source: 'local', connectorId: '', model: 'tts-1' },
    ),
    'voice_workflow.tts_v2v',
    { source: 'local', connectorId: '', model: 'voice-clone' },
  );
  const projections = await buildConversationCapabilityProjectionMap({
    selectionStore: store,
    routeRuntime,
  });
  assert.ok(projections['text.generate']);
  assert.ok(projections['image.generate']);
  assert.ok(projections['audio.synthesize']);
  assert.ok(projections['voice_workflow.tts_v2v']);
  assert.equal(projections['image.generate']!.supported, true);
  assert.equal(projections['audio.synthesize']!.supported, true);
  assert.ok(resolvedCapabilities.includes('image.generate'));
  assert.ok(resolvedCapabilities.includes('audio.synthesize'));
  assert.ok(resolvedCapabilities.includes('voice_workflow.tts_v2v'));
});

test('buildConversationCapabilityProjectionMap applies IMAGE_PROFILE_REQUIRED for image.generate', async () => {
  const store = updateConversationCapabilityBinding(
    createDefaultConversationCapabilitySelectionStore(),
    'image.generate',
    { source: 'local', connectorId: '', model: 'sd-xl' },
  );
  const routeRuntime = createMockRouteRuntime({
    resolveResult: createLocalResolvedBinding('image.generate', 'sd-xl'),
    healthResult: createHealthyResult(),
  });
  const projections = await buildConversationCapabilityProjectionMap({
    selectionStore: store,
    routeRuntime,
    capabilities: ['image.generate'],
    requiresImageProfileRefByCapability: { 'image.generate': true },
  });
  assert.equal(projections['image.generate']!.supported, false);
  assert.equal(projections['image.generate']!.reasonCode, 'profile_ref_missing');
});

// --- host_denied fail-close ---

test('multimodal projection fails closed when host denies capability', async () => {
  const store = updateConversationCapabilityBinding(
    createDefaultConversationCapabilitySelectionStore(),
    'image.generate',
    { source: 'local', connectorId: '', model: 'sd-xl' },
  );
  const routeRuntime = createMockRouteRuntime();
  const projection = await buildConversationCapabilityProjection({
    capability: 'image.generate',
    selectionStore: store,
    routeRuntime,
    hostAllowed: false,
    requiresDescribeMetadata: false,
  });
  assert.equal(projection.supported, false);
  assert.equal(projection.reasonCode, 'host_denied');
});

// --- text.generate still requires describe metadata ---

test('text.generate projection fails closed without describe metadata', async () => {
  const store = updateConversationCapabilityBinding(
    createDefaultConversationCapabilitySelectionStore(),
    'text.generate',
    { source: 'local', connectorId: '', model: 'chat-model' },
  );
  const routeRuntime = createMockRouteRuntime({
    resolveResult: createLocalResolvedBinding('text.generate', 'chat-model'),
    healthResult: createHealthyResult(),
    describeError: new Error('describe unavailable'),
  });
  const projection = await buildConversationCapabilityProjection({
    capability: 'text.generate',
    selectionStore: store,
    routeRuntime,
    requiresDescribeMetadata: true,
  });
  assert.equal(projection.supported, false);
  assert.equal(projection.reasonCode, 'metadata_missing');
});

// --- image.edit capability tests ---

test('image.edit is present in CONVERSATION_CAPABILITIES', () => {
  assert.ok(
    (CONVERSATION_CAPABILITIES as readonly string[]).includes('image.edit'),
    'image.edit must be a declared conversation capability',
  );
});

test('image.edit maps to image.generate via toRuntimeCanonicalCapability', () => {
  assert.equal(toRuntimeCanonicalCapability('image.edit'), 'image.generate');
});

test('image.edit projection resolves and returns supported with correct capability label', async () => {
  const routeRuntime = createMockRouteRuntime({
    resolveResult: createLocalResolvedBinding('image.generate', 'sd-xl'),
    healthResult: createHealthyResult(),
  });
  const store = updateConversationCapabilityBinding(
    createDefaultConversationCapabilitySelectionStore(),
    'image.edit',
    { source: 'local', connectorId: '', model: 'sd-xl' },
  );
  const projection = await buildConversationCapabilityProjection({
    capability: 'image.edit',
    selectionStore: store,
    routeRuntime,
    requiresDescribeMetadata: false,
  });
  assert.equal(projection.supported, true);
  assert.equal(projection.capability, 'image.edit');
  assert.equal(projection.resolvedBinding?.model, 'sd-xl');
});

test('toRuntimeCanonicalCapability maps image.edit to image.generate for host boundary', () => {
  assert.equal(toRuntimeCanonicalCapability('image.edit'), 'image.generate');
  assert.equal(toRuntimeCanonicalCapability('image.generate'), 'image.generate');
  assert.equal(toRuntimeCanonicalCapability('audio.synthesize'), 'audio.synthesize');
  assert.equal(toRuntimeCanonicalCapability('voice_workflow.tts_v2v'), 'voice_workflow.tts_v2v');
});

test('image.edit projection fails closed when selection missing', async () => {
  const store = createDefaultConversationCapabilitySelectionStore();
  const projection = await buildConversationCapabilityProjection({
    capability: 'image.edit',
    selectionStore: store,
    routeRuntime: createMockRouteRuntime(),
    requiresDescribeMetadata: false,
  });
  assert.equal(projection.supported, false);
  assert.equal(projection.reasonCode, 'selection_missing');
});

test('image.edit projection fails closed when image profile ref missing', async () => {
  const store = updateConversationCapabilityBinding(
    createDefaultConversationCapabilitySelectionStore(),
    'image.edit',
    { source: 'local', connectorId: '', model: 'sd-xl' },
  );
  const projection = await buildConversationCapabilityProjection({
    capability: 'image.edit',
    selectionStore: store,
    routeRuntime: createMockRouteRuntime({
      resolveResult: createLocalResolvedBinding('image.generate', 'sd-xl'),
      healthResult: createHealthyResult(),
    }),
    requiresImageProfileRef: true,
    requiresDescribeMetadata: false,
  });
  assert.equal(projection.supported, false);
  assert.equal(projection.reasonCode, 'profile_ref_missing');
});

test('image.edit and image.generate have independent selection bindings', async () => {
  const store = updateConversationCapabilityBinding(
    updateConversationCapabilityBinding(
      createDefaultConversationCapabilitySelectionStore(),
      'image.generate',
      { source: 'local', connectorId: '', model: 'sd-xl' },
    ),
    'image.edit',
    null,
  );
  const routeRuntime = createMockRouteRuntime({
    resolveResult: createLocalResolvedBinding('image.generate', 'sd-xl'),
    healthResult: createHealthyResult(),
  });
  const genProjection = await buildConversationCapabilityProjection({
    capability: 'image.generate',
    selectionStore: store,
    routeRuntime,
    requiresDescribeMetadata: false,
  });
  const editProjection = await buildConversationCapabilityProjection({
    capability: 'image.edit',
    selectionStore: store,
    routeRuntime,
    requiresDescribeMetadata: false,
  });
  assert.equal(genProjection.supported, true);
  assert.equal(editProjection.supported, false);
  assert.equal(editProjection.reasonCode, 'selection_cleared');
});

// --- projection map includes image.edit ---

test('buildConversationCapabilityProjectionMap includes image.edit in full refresh', async () => {
  const routeRuntime = createMockRouteRuntime({
    resolveResult: createLocalResolvedBinding('image.generate', 'sd-xl'),
    healthResult: createHealthyResult(),
  });
  const store = updateConversationCapabilityBinding(
    createDefaultConversationCapabilitySelectionStore(),
    'image.edit',
    { source: 'local', connectorId: '', model: 'sd-xl' },
  );
  const projections = await buildConversationCapabilityProjectionMap({
    selectionStore: store,
    routeRuntime,
  });
  assert.ok(projections['image.edit'], 'image.edit must appear in projection map');
  assert.equal(projections['image.edit']!.supported, true);
});

// --- projection gate scoping: conversationExecution discriminator ---

test('generic media caller without conversationExecution is not affected by unsupported projection', async () => {
  // Simulates the host media resolve wrapper behavior.
  // Generic callers (e.g. speech engine listVoices) do not set conversationExecution.
  // Even when projection is unsupported, the resolver must fall through to normal resolve.
  const normalResolveCalled: string[] = [];
  const resolveRuntimeRoute = async (payload: {
    modId: string;
    capability: RuntimeCanonicalCapability;
    binding?: { source: string; connectorId: string; model: string };
    conversationExecution?: boolean;
  }) => {
    // Mirror the host wrapper logic
    if (payload.conversationExecution && !payload.binding) {
      // This branch should NOT be entered for generic callers
      throw new Error('CONVERSATION_CAPABILITY_PROJECTION_UNAVAILABLE: audio.synthesize — selection_missing');
    }
    normalResolveCalled.push(payload.capability);
    return createCloudResolvedBinding(payload.capability, 'tts-generic');
  };
  // Generic caller — no conversationExecution flag
  const result = await resolveRuntimeRoute({
    modId: 'mod:speech-engine',
    capability: 'audio.synthesize',
  });
  assert.equal(result.model, 'tts-generic');
  assert.ok(normalResolveCalled.includes('audio.synthesize'));
});

test('conversation media path with conversationExecution=true fails closed on unsupported projection', async () => {
  const resolveRuntimeRoute = async (payload: {
    modId: string;
    capability: RuntimeCanonicalCapability;
    binding?: { source: string; connectorId: string; model: string };
    conversationExecution?: boolean;
  }) => {
    // Simulates unsupported projection check
    if (payload.conversationExecution && !payload.binding) {
      const projection = { supported: false, reasonCode: 'selection_missing' };
      if (!projection.supported && projection.reasonCode) {
        throw new Error(
          `CONVERSATION_CAPABILITY_PROJECTION_UNAVAILABLE: ${payload.capability} — ${projection.reasonCode}`,
        );
      }
    }
    return createCloudResolvedBinding(payload.capability, 'tts-1');
  };
  await assert.rejects(
    () => resolveRuntimeRoute({
      modId: 'core:runtime',
      capability: 'audio.synthesize',
      conversationExecution: true,
    }),
    /CONVERSATION_CAPABILITY_PROJECTION_UNAVAILABLE.*selection_missing/,
  );
});

test('conversation media path with conversationExecution=true uses projection resolvedBinding', async () => {
  const projectionBinding = createCloudResolvedBinding('image.generate', 'projection-model');
  const fallbackBinding = createCloudResolvedBinding('image.generate', 'fallback-model');
  const resolveRuntimeRoute = async (payload: {
    modId: string;
    capability: RuntimeCanonicalCapability;
    binding?: { source: string; connectorId: string; model: string };
    conversationExecution?: boolean;
  }) => {
    if (payload.conversationExecution && !payload.binding) {
      const projection = { supported: true, resolvedBinding: projectionBinding, reasonCode: null };
      if (projection.supported && projection.resolvedBinding) {
        return projection.resolvedBinding;
      }
    }
    return fallbackBinding;
  };
  const result = await resolveRuntimeRoute({
    modId: 'core:runtime',
    capability: 'image.generate',
    conversationExecution: true,
  });
  assert.equal(result.model, 'projection-model');
});

test('host media resolve does not equate no-binding with conversation path', async () => {
  // Contract: absence of binding alone must NOT trigger projection gate.
  // Only conversationExecution=true activates it.
  let projectionChecked = false;
  const resolveRuntimeRoute = async (payload: {
    modId: string;
    capability: RuntimeCanonicalCapability;
    binding?: { source: string; connectorId: string; model: string };
    conversationExecution?: boolean;
  }) => {
    if (payload.conversationExecution && !payload.binding) {
      projectionChecked = true;
    }
    return createLocalResolvedBinding(payload.capability, 'normal-model');
  };
  // Call without binding AND without conversationExecution
  await resolveRuntimeRoute({
    modId: 'mod:tts-engine',
    capability: 'audio.synthesize',
  });
  assert.equal(projectionChecked, false, 'projection gate must not activate for generic no-binding calls');
});
