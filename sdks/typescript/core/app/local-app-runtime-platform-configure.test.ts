import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiLocalAppAgentConfigureClient,
  mapNimiLocalAppConfigureError,
  type NimiLocalAppAgentConfigureShell,
} from './local-app-runtime-platform-configure.js';
import type { NimiLocalAppAgentHandle } from './permission-types.js';

const handle = 'lah_runtime_opaque' as NimiLocalAppAgentHandle;

const localIntent = {
  capabilityContract: 'text.generate',
  requiredFeatures: [],
  route: { oneofKind: 'local' as const, local: {} },
};

const portableProfile = {
  profileId: 'shared-local',
  title: 'Shared Local',
  capabilities: {
    'text.generate': {
      route: 'local' as const,
      requiredFeatures: [],
    },
  },
};

function sharedConfig(capabilities: unknown = [localIntent]) {
  return {
    owner: {
      owner: {
        oneofKind: 'runtimeLocalAgentSubsystem',
        runtimeLocalAgentSubsystem: {},
      },
    },
    capabilities,
  };
}

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
  presentationRevision: '0',
};

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

function shell(calls: unknown[]): NimiLocalAppAgentConfigureShell {
  return {
    sharedAgentAIConfigGet: async () => {
      calls.push(['sharedAgentAIConfigGet']);
      return sharedConfig();
    },
    sharedAgentAIConfigOverwrite: async (capabilities) => {
      calls.push(['sharedAgentAIConfigOverwrite', capabilities]);
      return sharedConfig(capabilities);
    },
    sharedAgentAIProfilePreview: async (profileJson) => {
      calls.push(['sharedAgentAIProfilePreview', profileJson]);
      return { before: sharedConfig(), after: sharedConfig() };
    },
    sharedAgentAIProfileApply: async (profileJson) => {
      calls.push(['sharedAgentAIProfileApply', profileJson]);
      return sharedConfig();
    },
    autonomySnapshot: async (input) => {
      calls.push(['autonomySnapshot', input]);
      return autonomy;
    },
    updateAutonomy: async (input) => {
      calls.push(['updateAutonomy', input]);
      return autonomy;
    },
    presentationSnapshot: async (input) => {
      calls.push(['presentationSnapshot', input]);
      return presentation;
    },
    commitPresentation: async (input) => {
      calls.push(['commitPresentation', input]);
      return presentation;
    },
  };
}

test('agents.configure exposes shared AIConfig/profile plus per-Agent autonomy/presentation', async () => {
  const calls: unknown[] = [];
  const client = createNimiLocalAppAgentConfigureClient(shell(calls));
  assert.deepEqual(Object.keys(client), [
    'sharedAIConfig',
    'sharedAIProfile',
    'autonomySnapshot',
    'updateAutonomy',
    'presentationSnapshot',
    'commitPresentation',
  ]);
  assert.deepEqual(Object.keys(client.sharedAIConfig), ['get', 'overwrite']);
  assert.deepEqual(Object.keys(client.sharedAIProfile), ['preview', 'apply']);

  assert.equal(
    (await client.sharedAIConfig.get()).owner?.owner.oneofKind,
    'runtimeLocalAgentSubsystem',
  );
  assert.deepEqual((await client.sharedAIConfig.overwrite([localIntent])).capabilities, [localIntent]);
  const preview = await client.sharedAIProfile.preview(portableProfile);
  assert.equal(preview.source.profileId, 'shared-local');
  assert.equal(preview.identical, true);
  await assert.doesNotReject(() => client.sharedAIProfile.apply(portableProfile));

  assert.equal((await client.autonomySnapshot({ agentHandle: handle })).autonomyRevision, '4');
  assert.equal((await client.updateAutonomy({
    agentHandle: handle,
    expectedAutonomyRevision: '3',
    intent: { enabled: false },
  })).outcome, 'updated');
  assert.equal(
    (await client.presentationSnapshot({ agentHandle: handle })).presentationRevision,
    '0',
  );
  assert.equal((await client.commitPresentation({
    agentHandle: handle,
    expectedPresentationRevision: '0',
    intent: presentationIntent,
    importedAssets: [],
  })).outcome, 'committed');

  assert.deepEqual(calls.slice(0, 2), [
    ['sharedAgentAIConfigGet'],
    ['sharedAgentAIConfigOverwrite', [localIntent]],
  ]);
  const profileCalls = calls.slice(2, 4) as [string, string][];
  assert.deepEqual(profileCalls.map(([name]) => name), [
    'sharedAgentAIProfilePreview',
    'sharedAgentAIProfileApply',
  ]);
  assert.deepEqual(JSON.parse(profileCalls[0]?.[1] ?? ''), portableProfile);
  assert.equal(JSON.stringify(calls.slice(0, 4)).match(/agentHandle|revision|readiness/gu), null);
  assert.deepEqual(calls[4], ['autonomySnapshot', { agentHandle: handle }]);
});

test('shared AIConfig rejects owner input and mismatched owner projections', async () => {
  let mutations = 0;
  const carrier = shell([]);
  carrier.sharedAgentAIConfigGet = async () => ({
    owner: { owner: { oneofKind: 'app', app: { appId: 'forbidden' } } },
    capabilities: [],
  });
  carrier.sharedAgentAIConfigOverwrite = async () => {
    mutations += 1;
    return sharedConfig();
  };
  const client = createNimiLocalAppAgentConfigureClient(carrier);
  await assert.rejects(
    () => client.sharedAIConfig.get(),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode
      === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );
  await assert.rejects(
    () => client.sharedAIConfig.overwrite([{ owner: {} }] as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode
      === 'SDK_LOCAL_APP_AUTHORITY_FIELD_FORBIDDEN',
  );
  assert.equal(mutations, 0);
});

test('shared AIProfile normalizes portable input and fails before transport on invalid input', async () => {
  const calls: unknown[] = [];
  const client = createNimiLocalAppAgentConfigureClient(shell(calls));
  const source = JSON.stringify(portableProfile, null, 2);
  const preview = await client.sharedAIProfile.preview(source);
  assert.deepEqual(preview.source, portableProfile);
  assert.equal(typeof (calls[0] as unknown[])[1], 'string');
  assert.equal((calls[0] as unknown[])[1], JSON.stringify(portableProfile));
  await assert.rejects(
    () => client.sharedAIProfile.apply('{'),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'AI_PROFILE_INVALID',
  );
  assert.equal(calls.length, 1);
});

test('configure shell namespace rejects legacy or expanded methods', () => {
  const carrier = shell([]) as NimiLocalAppAgentConfigureShell & Record<string, unknown>;
  carrier.configurationSnapshot = async () => ({});
  assert.throws(
    () => createNimiLocalAppAgentConfigureClient(carrier),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode
      === 'SDK_LOCAL_APP_CARRIER_REQUIRED',
  );
});

test('autonomy and presentation preserve typed conflict and validation outcomes', async () => {
  const conflictCarrier = shell([]);
  conflictCarrier.updateAutonomy = async () => {
    throw Object.assign(new Error('conflict'), {
      reasonCode: 'AGENT_AUTONOMY_REVISION_CONFLICT',
      details: { expected_revision: '3', committed_revision: '4' },
    });
  };
  conflictCarrier.commitPresentation = async () => {
    throw Object.assign(new Error('invalid asset'), {
      reasonCode: 'AGENT_PRESENTATION_ASSET_TYPE_INVALID',
      details: { asset_role: 'avatar' },
    });
  };
  const client = createNimiLocalAppAgentConfigureClient(conflictCarrier);
  const autonomyResult = await client.updateAutonomy({
    agentHandle: handle,
    expectedAutonomyRevision: '3',
    intent: { enabled: false },
  });
  assert.equal(autonomyResult.outcome, 'conflict');
  const presentationResult = await client.commitPresentation({
    agentHandle: handle,
    expectedPresentationRevision: '0',
    intent: presentationIntent,
    importedAssets: [],
  });
  assert.equal(presentationResult.outcome, 'validation-failed');
});

test('configure error mapping keeps only admitted public metadata', () => {
  const mapped = mapNimiLocalAppConfigureError({
    reasonCode: '671',
    details: {
      expected_revision: '3',
      committed_revision: '4',
      account_id: 'private',
    },
  });
  assert.equal(mapped.reasonCode, 'AGENT_AUTONOMY_REVISION_CONFLICT');
  assert.equal(mapped.category, 'autonomy-revision-conflict');
  assert.deepEqual(mapped.reasonMetadata, {
    expected_revision: '3',
    committed_revision: '4',
    permission_id: 'agents.configure',
  });
});
