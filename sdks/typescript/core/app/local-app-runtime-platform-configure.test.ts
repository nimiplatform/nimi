import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiLocalAppAgentConfigureClient,
  mapNimiLocalAppConfigureError,
  type NimiLocalAppAgentConfigureShell,
} from './local-app-runtime-platform-configure.js';
import type { NimiLocalAppAgentHandle } from './permission-types.js';

const handle = 'lah_runtime_opaque' as NimiLocalAppAgentHandle;
const readiness = {
  capability: 'text.generate',
  state: 'ready',
  reason: '',
  observedAt: { seconds: '12', nanos: 0 },
};
const configuration = {
  capabilities: ['text.generate'],
  intents: [{
    capability: 'text.generate',
    provider: '',
    logicalModelId: 'local/model',
    routePolicy: 'local',
    selectedParams: { temperature: 0.7 },
  }],
  readiness: [readiness],
  configurationRevision: '3',
  routeOptions: [{
    capability: 'text.generate',
    provider: '',
    logicalModelId: 'local/model',
    routePolicy: 'local',
    label: 'Local model',
    availability: 'ready',
  }],
  scopeOwnerId: 'runtime-local-agent-opaque',
  profileOrigin: null,
};
const publicAIConfig = {
  scopeRef: { kind: 'local-agent' as const, ownerId: 'runtime-local-agent-opaque' },
  capabilities: {
    logicalModelIds: { 'text.generate': 'local/model' },
    targetRefs: {},
    selectedComponents: {},
    selectedParams: { 'text.generate': { temperature: 0.7 } },
  },
  profileOrigin: null,
};
const publicRoutes = [{
  capability: 'text.generate',
  provider: '',
  routePolicy: 'local' as const,
}];
const autonomy = {
  enabled: true,
  config: {
    dailyTokenBudget: 1000,
    maxTokensPerHook: 100,
    minHookInterval: null,
    suspendUntil: null,
    mode: 'low',
  },
  usedTokensInWindow: 10,
  windowStartedAt: { seconds: '10', nanos: 0 },
  budgetExhausted: false,
  suspendedUntil: null,
  autonomyRevision: '4',
};
const presentation = {
  profile: null,
  previousProfile: null,
  defaultVoiceReference: '',
  presentationRevision: '5',
};
const aiProfile = {
  profileId: 'cloud-profile',
  title: 'Cloud Profile',
  capabilities: {
    'text.generate': {
      logicalModelId: 'model-1',
      targetRef: {
        kind: 'cloud-connector' as const,
        connectorId: 'connector-1',
        remoteModelCatalogId: 'remote-catalog-1',
        provider: 'openai-compatible',
        providerModelId: 'model-1',
      },
      params: { temperature: 0.2 },
      runtimeDescriptor: {
        executionMode: 'cloud_connector' as const,
        providerCapability: 'text.generate',
        credentialPolicy: 'managed',
      },
    },
  },
};
const aiProfileRequirements = [{
  requirementId: 'req-cloud',
  scopeRef: publicAIConfig.scopeRef,
  setupProjectionPolicy: 'fail-closed' as const,
  requiredSlices: [{
    requirementSliceId: 'slice-cloud',
    capability: 'text.generate',
    profileSliceRef: 'text-cloud',
    readinessPolicy: 'required' as const,
  }],
}];
const appliedConfiguration = {
  ...configuration,
  intents: [{
    capability: 'text.generate',
    provider: 'openai-compatible',
    logicalModelId: 'model-1',
    routePolicy: 'cloud',
    selectedParams: { temperature: 0.2 },
  }],
  configurationRevision: '4',
  readiness: [],
  routeOptions: [],
  profileOrigin: {
    profileId: 'cloud-profile',
    title: 'Cloud Profile',
    appliedAt: { seconds: '20', nanos: 0 },
  },
};

function shell(calls: unknown[]): NimiLocalAppAgentConfigureShell {
  return {
    configurationSnapshot: async (input) => { calls.push(['configurationSnapshot', input]); return configuration; },
    updateConfiguration: async (input) => { calls.push(['updateConfiguration', input]); return configuration; },
    readinessSnapshot: async (input) => {
      calls.push(['readinessSnapshot', input]);
      return { capabilities: [readiness], configurationRevision: '3' };
    },
    aiProfilePreview: async (input) => {
      calls.push(['aiProfilePreview', input]);
      return {
        before: configuration,
        after: appliedConfiguration,
        outcome: 'ready_to_apply',
        baseRevision: '3',
        blockingCapabilities: [],
        reasonCodes: [],
        actionRefs: [],
        probeWarnings: [],
      };
    },
    aiProfileApply: async (input) => {
      calls.push(['aiProfileApply', input]);
      return {
        projection: appliedConfiguration,
        outcome: 'ready_to_apply',
        blockingCapabilities: [],
        reasonCodes: [],
        actionRefs: [],
        probeWarnings: [],
      };
    },
    autonomySnapshot: async (input) => { calls.push(['autonomySnapshot', input]); return autonomy; },
    updateAutonomy: async (input) => { calls.push(['updateAutonomy', input]); return autonomy; },
    presentationSnapshot: async (input) => { calls.push(['presentationSnapshot', input]); return presentation; },
    commitPresentation: async (input) => { calls.push(['commitPresentation', input]); return presentation; },
  };
}

const presentationIntent = {
  backendKind: 'vrm' as const,
  avatarAssetRef: 'candidate-asset',
  expressionProfileRef: '',
  idlePreset: '',
  interactionPolicyRef: '',
  defaultVoiceReference: '',
  avatarAutoplay: false,
  backgroundAssetRef: '',
};

test('agents.configure exposes exactly nine opaque-handle-only typed operations', async () => {
  const calls: unknown[] = [];
  const client = createNimiLocalAppAgentConfigureClient(shell(calls));
  assert.deepEqual(Object.keys(client), [
    'configurationSnapshot',
    'updateConfiguration',
    'readinessSnapshot',
    'previewAIProfile',
    'applyAIProfile',
    'autonomySnapshot',
    'updateAutonomy',
    'presentationSnapshot',
    'commitPresentation',
  ]);
  const snapshot = await client.configurationSnapshot({ agentHandle: handle });
  assert.equal(snapshot.configurationRevision, '3');
  assert.deepEqual(snapshot.aiConfig, publicAIConfig);
  assert.deepEqual(snapshot.routeOptions, configuration.routeOptions);
  assert.equal((await client.updateConfiguration({
    agentHandle: handle,
    expectedConfigurationRevision: '2',
    config: publicAIConfig,
    routes: publicRoutes,
  })).outcome, 'updated');
  assert.equal((await client.readinessSnapshot({ agentHandle: handle })).capabilities[0]?.state, 'ready');
  const preview = await client.previewAIProfile({
    agentHandle: handle,
    scopeRef: publicAIConfig.scopeRef,
    profile: aiProfile,
    requirementDeclarations: aiProfileRequirements,
  });
  assert.equal(preview.outcome, 'ready_to_apply');
  assert.equal(preview.baseVersion, 'runtime-agent-revision:3');
  assert.deepEqual(preview.after?.capabilities.targetRefs, {});
  const apply = await client.applyAIProfile({
    agentHandle: handle,
    scopeRef: publicAIConfig.scopeRef,
    profile: aiProfile,
    requirementDeclarations: aiProfileRequirements,
    expectedBaseVersion: preview.baseVersion,
  });
  assert.equal(apply.success, true);
  assert.deepEqual(apply.config?.capabilities.targetRefs, {});
  assert.equal((await client.autonomySnapshot({ agentHandle: handle })).autonomyRevision, '4');
  assert.equal((await client.updateAutonomy({
    agentHandle: handle,
    expectedAutonomyRevision: '3',
    intent: { enabled: true },
  })).outcome, 'updated');
  assert.equal((await client.presentationSnapshot({ agentHandle: handle })).presentationRevision, '5');
  assert.equal((await client.commitPresentation({
    agentHandle: handle,
    expectedPresentationRevision: '5',
    intent: presentationIntent,
    importedAssets: [],
  })).outcome, 'committed');

  assert.equal(calls.length, 11);
  const serialized = JSON.stringify(calls);
  for (const forbidden of ['ownerUserId', 'runtimeSourceRef', 'localAgentRef', 'subjectUserId', 'accountId', 'sessionId']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(calls.every((entry) => JSON.stringify(entry).includes('lah_runtime_opaque')), true);
});

test('agents.configure preserves configured-unverified image readiness', async () => {
  const calls: unknown[] = [];
  const base = shell(calls);
  const client = createNimiLocalAppAgentConfigureClient({
    ...base,
    readinessSnapshot: async () => ({
      capabilities: [{
        capability: 'image.generate',
        state: 'configured_unverified',
        reason: 'image_configured_unverified',
        observedAt: null,
      }],
      configurationRevision: '3',
    }),
  });

  assert.deepEqual((await client.readinessSnapshot({ agentHandle: handle })).capabilities[0], {
    capability: 'image.generate',
    state: 'configured_unverified',
    reason: 'image_configured_unverified',
  });
});

test('configuration selectedComponents accepts absent, empty, and public projections but rejects private fields', async () => {
  const component = {
    occurrenceId: 'text-encoder',
    order: 0,
    role: 'encoder',
    componentKind: 'text_encoder',
    logicalModelId: 'local/text-encoder',
    required: true,
  };
  const intent = configuration.intents[0]!;
  for (const [selectedComponents, expected] of [
    [undefined, {}],
    [[], {}],
    [[component], { 'text.generate': [component] }],
  ] as const) {
    const transport = shell([]);
    transport.configurationSnapshot = async () => ({
      ...configuration,
      intents: [{
        ...intent,
        ...(selectedComponents === undefined ? {} : { selectedComponents }),
      }],
    });
    const snapshot = await createNimiLocalAppAgentConfigureClient(transport)
      .configurationSnapshot({ agentHandle: handle });
    assert.deepEqual(snapshot.aiConfig.capabilities.selectedComponents, expected);
  }

  const privateCarrier = shell([]);
  privateCarrier.configurationSnapshot = async () => ({
    ...configuration,
    intents: [{
      ...intent,
      selectedComponents: [{ ...component, localAssetId: 'private-asset' }],
    }],
  });
  await assert.rejects(
    () => createNimiLocalAppAgentConfigureClient(privateCarrier)
      .configurationSnapshot({ agentHandle: handle }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );

  const privateParamsCarrier = shell([]);
  privateParamsCarrier.configurationSnapshot = async () => ({
    ...configuration,
    intents: [{
      ...intent,
      selectedParams: { steps: 25, localAssetId: 'private-asset' },
    }],
  });
  await assert.rejects(
    () => createNimiLocalAppAgentConfigureClient(privateParamsCarrier)
      .configurationSnapshot({ agentHandle: handle }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );
});

test('missing configure carrier is a typed carrier-unavailable construction error', () => {
  assert.throws(
    () => createNimiLocalAppAgentConfigureClient(undefined as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_CARRIER_UNAVAILABLE',
  );
});

test('all nine operations preserve reserved denial and permission id from the real carrier', async () => {
  const transport = shell([]);
  const reserved = async (): Promise<never> => {
    throw {
      reasonCode: 668,
      details: { permission_id: 'agents.configure', permission_reason: 'reserved_not_admitted' },
    };
  };
  for (const method of Object.keys(transport) as Array<keyof NimiLocalAppAgentConfigureShell>) {
    transport[method] = reserved as never;
  }
  const client = createNimiLocalAppAgentConfigureClient(transport);
  const operations = [
    () => client.configurationSnapshot({ agentHandle: handle }),
    () => client.updateConfiguration({
      agentHandle: handle,
      expectedConfigurationRevision: '1',
      config: publicAIConfig,
      routes: publicRoutes,
    }),
    () => client.readinessSnapshot({ agentHandle: handle }),
    () => client.previewAIProfile({
      agentHandle: handle,
      scopeRef: publicAIConfig.scopeRef,
      profile: aiProfile,
      requirementDeclarations: aiProfileRequirements,
    }),
    () => client.applyAIProfile({
      agentHandle: handle,
      scopeRef: publicAIConfig.scopeRef,
      profile: aiProfile,
      requirementDeclarations: aiProfileRequirements,
    }),
    () => client.autonomySnapshot({ agentHandle: handle }),
    () => client.updateAutonomy({ agentHandle: handle, expectedAutonomyRevision: '1', intent: { enabled: false } }),
    () => client.presentationSnapshot({ agentHandle: handle }),
    () => client.commitPresentation({ agentHandle: handle, expectedPresentationRevision: '0', intent: presentationIntent, importedAssets: [] }),
  ];
  for (const operation of operations) {
    await assert.rejects(operation, (error: unknown) => {
      const typed = error as ReturnType<typeof mapNimiLocalAppConfigureError>;
      return typed.reasonCode === 'LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED'
        && typed.permissionId === 'agents.configure'
        && typed.reasonMetadata.permission_id === 'agents.configure';
    });
  }
});

test('ReasonCodes 668-671 and permission denial metadata map without collapse', () => {
  const cases = [
    [668, 'LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED', 'reserved-not-admitted'],
    [669, 'LOCAL_APP_PERMISSION_UNKNOWN', 'unknown-permission'],
    [670, 'AGENT_AI_CONFIG_REVISION_CONFLICT', 'configuration-revision-conflict'],
    [671, 'AGENT_AUTONOMY_REVISION_CONFLICT', 'autonomy-revision-conflict'],
    [651, 'LOCAL_APP_PERMISSION_REQUIRED', 'not-granted'],
    [652, 'LOCAL_APP_PERMISSION_DENIED', 'denied'],
    [653, 'LOCAL_APP_PERMISSION_REVOKED', 'not-granted'],
  ] as const;
  for (const [raw, reasonCode, category] of cases) {
    const error = mapNimiLocalAppConfigureError({
      reasonCode: raw,
      details: {
        permission_id: 'agents.configure',
        permission_reason: category,
        diagnostic_stage: 'operation-coordinator',
        owner_selector_digest: 'must-not-cross-public-carrier',
      },
    });
    assert.equal(error.reasonCode, reasonCode);
    assert.equal(error.category, category);
    assert.equal(error.permissionId, 'agents.configure');
    assert.equal(error.reasonMetadata.permission_id, 'agents.configure');
    assert.equal(error.reasonMetadata.permission_reason, category);
    assert.equal('owner_selector_digest' in error.reasonMetadata, false);
  }
});

test('presentation commit accepts initial revision zero and keeps decimal strings at the carrier boundary', async () => {
  const calls: unknown[] = [];
  const transport = shell(calls);
  transport.presentationSnapshot = async (input) => {
    calls.push(['presentationSnapshot', input]);
    return { ...presentation, presentationRevision: '0' };
  };
  transport.commitPresentation = async (input) => {
    calls.push(['commitPresentation', input]);
    return { ...presentation, presentationRevision: '1' };
  };
  const client = createNimiLocalAppAgentConfigureClient(transport);
  assert.equal((await client.presentationSnapshot({ agentHandle: handle })).presentationRevision, '0');
  const result = await client.commitPresentation({
    agentHandle: handle,
    expectedPresentationRevision: '0',
    intent: presentationIntent,
    importedAssets: [],
  });
  assert.equal(result.outcome, 'committed');
  assert.deepEqual(calls.at(-1), ['commitPresentation', {
    agentHandle: 'lah_runtime_opaque',
    expectedPresentationRevision: '0',
    intent: presentationIntent,
    importedAssets: [],
  }]);
});

test('local-app update-configuration awaits the committed carrier projection', async () => {
  let resolveCommit!: (value: typeof configuration) => void;
  const committed = new Promise<typeof configuration>((resolve) => { resolveCommit = resolve; });
  const transport = shell([]);
  transport.updateConfiguration = async () => committed;
  const client = createNimiLocalAppAgentConfigureClient(transport);
  let settled = false;
  const pending = client.updateConfiguration({
    agentHandle: handle,
    expectedConfigurationRevision: '2',
    config: publicAIConfig,
    routes: publicRoutes,
  }).finally(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  resolveCommit(configuration);
  assert.equal((await pending).outcome, 'updated');
  assert.equal(settled, true);
});

test('configuration and autonomy stale revisions return typed conflicts', async () => {
  const conflictShell = shell([]);
  conflictShell.updateConfiguration = async () => {
    throw { reasonCode: 'AGENT_AI_CONFIG_REVISION_CONFLICT', details: { permission_id: 'agents.configure' } };
  };
  conflictShell.updateAutonomy = async () => {
    throw { reasonCode: 'AGENT_AUTONOMY_REVISION_CONFLICT', details: { permission_id: 'agents.configure' } };
  };
  const client = createNimiLocalAppAgentConfigureClient(conflictShell);
  const configResult = await client.updateConfiguration({
    agentHandle: handle,
    expectedConfigurationRevision: '2',
    config: publicAIConfig,
    routes: publicRoutes,
  });
  assert.equal(configResult.outcome, 'conflict');
  if (configResult.outcome === 'conflict') {
    assert.equal(configResult.conflict.reasonCode, 'AGENT_AI_CONFIG_REVISION_CONFLICT');
  }
  const autonomyResult = await client.updateAutonomy({
    agentHandle: handle,
    expectedAutonomyRevision: '3',
    intent: { enabled: false },
  });
  assert.equal(autonomyResult.outcome, 'conflict');
  if (autonomyResult.outcome === 'conflict') {
    assert.equal(autonomyResult.conflict.reasonCode, 'AGENT_AUTONOMY_REVISION_CONFLICT');
  }
});

test('presentation validation failures return typed categories and bounded metadata', async () => {
  const transport = shell([]);
  transport.commitPresentation = async () => {
    throw {
      reasonCode: 676,
      details: {
        validation_category: 'integrity',
        asset_role: 'avatar',
        media_type: 'model/gltf-binary',
        backend_kind: 'vrm',
        raw_path: 'must-not-cross',
      },
    };
  };
  const client = createNimiLocalAppAgentConfigureClient(transport);
  const result = await client.commitPresentation({
    agentHandle: handle,
    expectedPresentationRevision: '0',
    intent: presentationIntent,
    importedAssets: [],
  });
  assert.equal(result.outcome, 'validation-failed');
  if (result.outcome === 'validation-failed') {
    assert.equal(result.failure.reasonCode, 'AGENT_PRESENTATION_ASSET_INTEGRITY_MISMATCH');
    assert.equal(result.failure.category, 'presentation-integrity');
    assert.equal(result.failure.reasonMetadata.validation_category, 'integrity');
    assert.equal('raw_path' in result.failure.reasonMetadata, false);
  }
});

test('configure input rejects raw identity fields before transport', async () => {
  let calls = 0;
  const transport = shell([]);
  transport.configurationSnapshot = async () => { calls += 1; return configuration; };
  const client = createNimiLocalAppAgentConfigureClient(transport);
  await assert.rejects(
    () => client.configurationSnapshot({ agentHandle: handle, localAgentRef: 'raw' } as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID',
  );
  assert.equal(calls, 0);

  await assert.rejects(
    () => client.updateConfiguration({
      agentHandle: handle,
      expectedConfigurationRevision: '3',
      config: {
        ...publicAIConfig,
        capabilities: {
          ...publicAIConfig.capabilities,
          selectedParams: { 'text.generate': { localAssetId: 'private-asset' } },
        },
      },
      routes: publicRoutes,
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_AUTHORITY_FIELD_FORBIDDEN',
  );
  assert.equal(calls, 0);
});

test('configuration route options reject private inventory material and unknown availability', async () => {
  const transport = shell([]);
  transport.configurationSnapshot = async () => ({
    ...configuration,
    routeOptions: [{
      ...configuration.routeOptions[0],
      endpoint: 'http://127.0.0.1:9999/private',
    }],
  });
  const client = createNimiLocalAppAgentConfigureClient(transport);
  await assert.rejects(
    () => client.configurationSnapshot({ agentHandle: handle }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );

  transport.configurationSnapshot = async () => ({
    ...configuration,
    routeOptions: [{ ...configuration.routeOptions[0], availability: 'unhealthy' }],
  });
  await assert.rejects(
    () => client.configurationSnapshot({ agentHandle: handle }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );
});
