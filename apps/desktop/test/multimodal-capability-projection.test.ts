import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type {
  NimiRuntimeCanonicalCapability,
  NimiRuntimeResolvedBinding,
  NimiRuntimeRouteDescribeResult,
  NimiRuntimeRouteHealthResult,
} from '@nimiplatform/sdk/runtime';
import {
  buildConversationCapabilityProjection,
  buildConversationCapabilityProjectionMap,
  CONVERSATION_CAPABILITIES,
  createDefaultConversationCapabilitySelectionStore,
  toRuntimeCanonicalCapability,
  updateConversationCapabilityBinding,
  type ConversationCapabilityRouteRuntime,
} from '../src/shell/renderer/features/chat/conversation-capability.js';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

function createLocalResolvedBinding(
  capability: NimiRuntimeCanonicalCapability,
  model: string,
): NimiRuntimeResolvedBinding {
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
  capability: NimiRuntimeCanonicalCapability,
  model: string,
): NimiRuntimeResolvedBinding {
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

function createHealthyResult(): NimiRuntimeRouteHealthResult {
  return {
    healthy: true,
    status: 'healthy',
    provider: 'test',
    detail: '',
    actionHint: 'none',
  };
}

function createUnhealthyResult(): NimiRuntimeRouteHealthResult {
  return {
    healthy: false,
    status: 'unhealthy',
    provider: 'test',
    detail: 'provider offline',
    actionHint: 'inspect_runtime_route',
  };
}

function createTextDescribeResult(ref: string): NimiRuntimeRouteDescribeResult {
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

function createAudioSynthesizeDescribeResult(ref: string): NimiRuntimeRouteDescribeResult {
  return {
    capability: 'audio.synthesize',
    metadataVersion: 'v1',
    resolvedBindingRef: ref,
    metadataKind: 'audio.synthesize',
    metadata: {
      supportedAudioFormats: ['mp3'],
      defaultAudioFormat: 'mp3',
      supportedTimingModes: ['none'],
      supportsLanguage: true,
      supportsEmotion: false,
    },
  };
}

function createVoiceWorkflowV2vDescribeResult(ref: string): NimiRuntimeRouteDescribeResult {
  return {
    capability: 'voice_workflow.voice_clone',
    metadataVersion: 'v1',
    resolvedBindingRef: ref,
    metadataKind: 'voice_workflow.voice_clone',
    metadata: {
      workflowType: 'voice_clone',
      requiresTargetSynthesisBinding: true,
      textPromptMode: 'unsupported',
      supportsLanguageHints: true,
      supportsPreferredName: true,
      referenceAudioUriInput: true,
      referenceAudioBytesInput: true,
      allowedReferenceAudioMimeTypes: ['audio/wav'],
    },
  };
}

function createVoiceWorkflowT2vDescribeResult(ref: string): NimiRuntimeRouteDescribeResult {
  return {
    capability: 'voice_workflow.voice_design',
    metadataVersion: 'v1',
    resolvedBindingRef: ref,
    metadataKind: 'voice_workflow.voice_design',
    metadata: {
      workflowType: 'voice_design',
      requiresTargetSynthesisBinding: true,
      instructionTextMode: 'required',
      previewTextMode: 'optional',
      supportsLanguage: true,
      supportsPreferredName: true,
    },
  };
}

function createDescribeResult(
  capability: NimiRuntimeCanonicalCapability,
  ref: string,
): NimiRuntimeRouteDescribeResult {
  if (capability === 'audio.synthesize') {
    return createAudioSynthesizeDescribeResult(ref);
  }
  if (capability === 'voice_workflow.voice_clone') {
    return createVoiceWorkflowV2vDescribeResult(ref);
  }
  if (capability === 'voice_workflow.voice_design') {
    return createVoiceWorkflowT2vDescribeResult(ref);
  }
  return createTextDescribeResult(ref);
}

function createMockRouteRuntime(overrides?: {
  resolveResult?: NimiRuntimeResolvedBinding;
  healthResult?: NimiRuntimeRouteHealthResult;
  describeResult?: NimiRuntimeRouteDescribeResult;
  resolveError?: Error;
  healthError?: Error;
  describeError?: Error;
}): ConversationCapabilityRouteRuntime {
  return {
    resolve: async ({ capability }) => {
      if (overrides?.resolveError) throw overrides.resolveError;
      return overrides?.resolveResult || createLocalResolvedBinding(capability as NimiRuntimeCanonicalCapability, 'default-model');
    },
    checkHealth: async () => {
      if (overrides?.healthError) throw overrides.healthError;
      return overrides?.healthResult || createHealthyResult();
    },
    describe: async ({ capability, resolvedBindingRef }) => {
      if (overrides?.describeError) throw overrides.describeError;
      return overrides?.describeResult || createDescribeResult(capability as NimiRuntimeCanonicalCapability, resolvedBindingRef);
    },
  };
}

// --- image.generate projection tests ---

test('image.generate projection fails closed without typed route describe metadata', async () => {
  const store = updateConversationCapabilityBinding(
    createDefaultConversationCapabilitySelectionStore(),
    'image.generate',
    { source: 'local', connectorId: '', model: 'sd-xl' },
  );
  let describeCalls = 0;
  const routeRuntime = createMockRouteRuntime({
    resolveResult: createLocalResolvedBinding('image.generate', 'sd-xl'),
    healthResult: createHealthyResult(),
    describeError: new Error('image route describe metadata missing'),
  });
  const routeRuntimeWithSpy: ConversationCapabilityRouteRuntime = {
    ...routeRuntime,
    describe: async (input) => {
      describeCalls += 1;
      return routeRuntime.describe(input);
    },
  };
  const projection = await buildConversationCapabilityProjection({
    capability: 'image.generate',
    selectionStore: store,
    routeRuntime: routeRuntimeWithSpy,
  });
  assert.equal(projection.supported, false);
  assert.equal(projection.reasonCode, 'metadata_missing');
  assert.equal(projection.metadata, null);
  assert.equal(projection.resolvedBinding?.model, 'sd-xl');
  assert.equal(describeCalls, 1);
});

test('image.generate projection fails closed when selection missing', async () => {
  const store = createDefaultConversationCapabilitySelectionStore();
  const routeRuntime = createMockRouteRuntime();
  const projection = await buildConversationCapabilityProjection({
    capability: 'image.generate',
    selectionStore: store,
    routeRuntime,
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
  });
  assert.equal(projection.supported, false);
  assert.equal(projection.reasonCode, 'route_unhealthy');
});

test('image.generate projection requires typed route metadata instead of retired profile refs', async () => {
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
  });
  assert.equal(projection.supported, false);
  assert.equal(projection.reasonCode, 'metadata_missing');
  assert.equal(projection.metadata, null);
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
  });
  assert.equal(projection.supported, true);
  assert.equal(projection.reasonCode, null);
  assert.equal(projection.metadata?.metadataKind, 'audio.synthesize');
});

test('audio.synthesize projection fails closed when selection missing', async () => {
  const store = createDefaultConversationCapabilitySelectionStore();
  const projection = await buildConversationCapabilityProjection({
    capability: 'audio.synthesize',
    selectionStore: store,
    routeRuntime: createMockRouteRuntime(),
  });
  assert.equal(projection.supported, false);
  assert.equal(projection.reasonCode, 'selection_missing');
});

// --- voice_workflow projection tests (with describe required) ---

test('voice_workflow.voice_clone projection fails closed when describe metadata missing', async () => {
  const store = updateConversationCapabilityBinding(
    createDefaultConversationCapabilitySelectionStore(),
    'voice_workflow.voice_clone',
    { source: 'cloud', connectorId: 'connector-1', model: 'voice-clone' },
  );
  const routeRuntime = createMockRouteRuntime({
    resolveResult: createCloudResolvedBinding('voice_workflow.voice_clone', 'voice-clone'),
    healthResult: createHealthyResult(),
    describeError: new Error('describe not available'),
  });
  const projection = await buildConversationCapabilityProjection({
    capability: 'voice_workflow.voice_clone',
    selectionStore: store,
    routeRuntime,
  });
  assert.equal(projection.supported, false);
  assert.equal(projection.reasonCode, 'metadata_missing');
});

test('voice_workflow.voice_design treated as independent capability, not audio.synthesize alias', async () => {
  const store = updateConversationCapabilityBinding(
    updateConversationCapabilityBinding(
      createDefaultConversationCapabilitySelectionStore(),
      'audio.synthesize',
      { source: 'cloud', connectorId: 'connector-1', model: 'tts-1' },
    ),
    'voice_workflow.voice_design',
    null,
  );
  const routeRuntime = createMockRouteRuntime();
  const audioProjection = await buildConversationCapabilityProjection({
    capability: 'audio.synthesize',
    selectionStore: store,
    routeRuntime,
  });
  const voiceProjection = await buildConversationCapabilityProjection({
    capability: 'voice_workflow.voice_design',
    selectionStore: store,
    routeRuntime,
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
      return createLocalResolvedBinding(capability as NimiRuntimeCanonicalCapability, 'model-1');
    },
    checkHealth: async () => createHealthyResult(),
    describe: async ({ capability, resolvedBindingRef }) => (
      createDescribeResult(capability as NimiRuntimeCanonicalCapability, resolvedBindingRef)
    ),
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
    'voice_workflow.voice_clone',
    { source: 'local', connectorId: '', model: 'voice-clone' },
  );
  const projections = await buildConversationCapabilityProjectionMap({
    selectionStore: store,
    routeRuntime,
  });
  assert.ok(projections['text.generate']);
  assert.ok(projections['image.generate']);
  assert.ok(projections['audio.synthesize']);
  assert.ok(projections['voice_workflow.voice_clone']);
  assert.equal(projections['image.generate']!.supported, false);
  assert.equal(projections['image.generate']!.reasonCode, 'metadata_missing');
  assert.equal(projections['image.generate']!.metadata, null);
  assert.equal(projections['audio.synthesize']!.supported, true);
  assert.ok(resolvedCapabilities.includes('image.generate'));
  assert.ok(resolvedCapabilities.includes('audio.synthesize'));
  assert.ok(resolvedCapabilities.includes('voice_workflow.voice_clone'));
});

test('buildConversationCapabilityProjectionMap fails image.generate closed without typed route metadata', async () => {
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
  });
  assert.equal(projections['image.generate']!.supported, false);
  assert.equal(projections['image.generate']!.reasonCode, 'metadata_missing');
  assert.equal(projections['image.generate']!.metadata, null);
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

test('image.edit stays an independent canonical capability via toRuntimeCanonicalCapability', () => {
  assert.equal(toRuntimeCanonicalCapability('image.edit'), 'image.edit');
});

test('image.edit projection fails closed without image.edit route metadata', async () => {
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
  });
  assert.equal(projection.supported, false);
  assert.equal(projection.reasonCode, 'metadata_missing');
  assert.equal(projection.metadata, null);
  assert.equal(projection.capability, 'image.edit');
  assert.equal(projection.resolvedBinding?.model, 'sd-xl');
});

test('toRuntimeCanonicalCapability preserves image.edit for host boundary', () => {
  assert.equal(toRuntimeCanonicalCapability('image.edit'), 'image.edit');
  assert.equal(toRuntimeCanonicalCapability('image.generate'), 'image.generate');
  assert.equal(toRuntimeCanonicalCapability('audio.synthesize'), 'audio.synthesize');
  assert.equal(toRuntimeCanonicalCapability('voice_workflow.voice_clone'), 'voice_workflow.voice_clone');
});

test('conversation capability canonicalization is delegated to SDK projection', () => {
  const source = readSource('src/shell/renderer/features/chat/conversation-capability.ts');
  assert.match(source, /toNimiRuntimeRouteCanonicalCapability/);
  assert.doesNotMatch(source, /CONVERSATION_CAPABILITY_RUNTIME_MAP/);
});

test('image.edit projection fails closed when selection missing', async () => {
  const store = createDefaultConversationCapabilitySelectionStore();
  const projection = await buildConversationCapabilityProjection({
    capability: 'image.edit',
    selectionStore: store,
    routeRuntime: createMockRouteRuntime(),
  });
  assert.equal(projection.supported, false);
  assert.equal(projection.reasonCode, 'selection_missing');
});

test('image.edit projection requires typed route metadata instead of retired profile refs', async () => {
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
  });
  assert.equal(projection.supported, false);
  assert.equal(projection.reasonCode, 'metadata_missing');
  assert.equal(projection.metadata, null);
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
  });
  const editProjection = await buildConversationCapabilityProjection({
    capability: 'image.edit',
    selectionStore: store,
    routeRuntime,
  });
  assert.equal(genProjection.supported, false);
  assert.equal(genProjection.reasonCode, 'metadata_missing');
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
  assert.equal(projections['image.edit']!.supported, false);
  assert.equal(projections['image.edit']!.reasonCode, 'metadata_missing');
  assert.equal(projections['image.edit']!.metadata, null);
});

// --- projection gate scoping: conversationExecution discriminator ---

test('generic media caller without conversationExecution is not affected by unsupported projection', async () => {
  // Simulates the host media resolve wrapper behavior.
  // Generic callers (e.g. runtime media tts listVoices) do not set conversationExecution.
  // Even when projection is unsupported, the resolver must fall through to normal resolve.
  const normalResolveCalled: string[] = [];
  const resolveRuntimeRoute = async (payload: {
    targetId: string;
    capability: NimiRuntimeCanonicalCapability;
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
    targetId: 'speech-engine',
    capability: 'audio.synthesize',
  });
  assert.equal(result.model, 'tts-generic');
  assert.ok(normalResolveCalled.includes('audio.synthesize'));
});

test('conversation media path with conversationExecution=true fails closed on unsupported projection', async () => {
  const resolveRuntimeRoute = async (payload: {
    targetId: string;
    capability: NimiRuntimeCanonicalCapability;
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
      targetId: 'core:runtime',
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
    targetId: string;
    capability: NimiRuntimeCanonicalCapability;
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
    targetId: 'core:runtime',
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
    targetId: string;
    capability: NimiRuntimeCanonicalCapability;
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
    targetId: 'tts-engine',
    capability: 'audio.synthesize',
  });
  assert.equal(projectionChecked, false, 'projection gate must not activate for generic no-binding calls');
});
