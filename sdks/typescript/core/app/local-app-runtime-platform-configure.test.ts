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
  routeIntents: [{ capability: 'text.generate', provider: '', model: 'local/model', routePolicy: 'local' }],
  readiness: [readiness],
  configurationRevision: '3',
};
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

function shell(calls: unknown[]): NimiLocalAppAgentConfigureShell {
  return {
    configurationSnapshot: async (input) => { calls.push(['configurationSnapshot', input]); return configuration; },
    updateConfiguration: async (input) => { calls.push(['updateConfiguration', input]); return configuration; },
    readinessSnapshot: async (input) => {
      calls.push(['readinessSnapshot', input]);
      return { capabilities: [readiness], configurationRevision: '3' };
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

test('agents.configure exposes exactly seven opaque-handle-only typed operations', async () => {
  const calls: unknown[] = [];
  const client = createNimiLocalAppAgentConfigureClient(shell(calls));
  assert.deepEqual(Object.keys(client), [
    'configurationSnapshot',
    'updateConfiguration',
    'readinessSnapshot',
    'autonomySnapshot',
    'updateAutonomy',
    'presentationSnapshot',
    'commitPresentation',
  ]);
  assert.equal((await client.configurationSnapshot({ agentHandle: handle })).configurationRevision, '3');
  assert.equal((await client.updateConfiguration({
    agentHandle: handle,
    expectedConfigurationRevision: '2',
    routeIntents: configuration.routeIntents,
  })).outcome, 'updated');
  assert.equal((await client.readinessSnapshot({ agentHandle: handle })).capabilities[0]?.state, 'ready');
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

  assert.equal(calls.length, 7);
  const serialized = JSON.stringify(calls);
  for (const forbidden of ['ownerUserId', 'runtimeSourceRef', 'localAgentRef', 'subjectUserId', 'accountId', 'sessionId']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(calls.every((entry) => JSON.stringify(entry).includes('lah_runtime_opaque')), true);
});

test('missing configure carrier is a typed carrier-unavailable construction error', () => {
  assert.throws(
    () => createNimiLocalAppAgentConfigureClient(undefined as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_CARRIER_UNAVAILABLE',
  );
});

test('all seven operations preserve reserved denial and permission id from the real carrier', async () => {
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
    () => client.updateConfiguration({ agentHandle: handle, expectedConfigurationRevision: '1', routeIntents: configuration.routeIntents }),
    () => client.readinessSnapshot({ agentHandle: handle }),
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
    [653, 'LOCAL_APP_PERMISSION_REVOKED', 'revoked'],
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
    routeIntents: configuration.routeIntents,
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
    routeIntents: configuration.routeIntents,
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
});
