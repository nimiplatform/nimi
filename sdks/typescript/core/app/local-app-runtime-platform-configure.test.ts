import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiLocalAppAgentConfigureClient,
  type NimiLocalAppAgentConfigureShell,
} from './local-app-runtime-platform-configure.js';
import type { NimiLocalAppAgentHandle } from './local-app-runtime-platform-conversation.js';

const HANDLE = 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as NimiLocalAppAgentHandle;

const SHARED_AI_CONFIG = {
  owner: { owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} } },
  capabilities: [{
    capabilityContract: 'text.generate',
    requiredFeatures: [],
    route: { oneofKind: 'local', local: { loadoutRef: 'loadout:text' } },
  }],
} as const;

const AUTONOMY_PROJECTION = {
  enabled: true,
  config: {
    dailyTokenBudget: 1000,
    maxTokensPerHook: 100,
    minHookInterval: null,
    suspendUntil: null,
    mode: 'low',
  },
  usedTokensInWindow: 12,
  windowStartedAt: { seconds: '1750000000', nanos: 0 },
  budgetExhausted: false,
  suspendedUntil: null,
  autonomyRevision: '7',
} as const;

const PRESENTATION_PROJECTION = {
  profile: {
    backendKind: 'vrm',
    avatarAssetRef: 'asset://avatar/current',
    expressionProfileRef: '',
    idlePreset: 'idle-soft',
    interactionPolicyRef: '',
    defaultVoiceReference: '',
    avatarAutoplay: true,
    backgroundAssetRef: '',
    revision: '3',
  },
  previousProfile: null,
  defaultVoiceReference: '',
  presentationRevision: '3',
} as const;

function shell(calls: unknown[]): NimiLocalAppAgentConfigureShell {
  return {
    sharedAIConfig: {
      get: async () => {
        calls.push(['sharedAIConfig.get']);
        return { config: SHARED_AI_CONFIG, revision: '1', effectiveSelections: [] };
      },
      overwrite: async (input) => {
        calls.push(['sharedAIConfig.overwrite', input]);
        return {
          outcome: 'committed', config: { ...SHARED_AI_CONFIG, capabilities: input.capabilities },
          revision: '2',
        };
      },
      listOptions: async (query) => {
        calls.push(['sharedAIConfig.listOptions', query]);
        return { kind: 'local-loadouts', options: [], truncated: false };
      },
    },
    autonomy: {
      snapshot: async (input) => {
        calls.push(['autonomy.snapshot', input]);
        return AUTONOMY_PROJECTION;
      },
      update: async (input) => {
        calls.push(['autonomy.update', input]);
        return AUTONOMY_PROJECTION;
      },
    },
    presentation: {
      snapshot: async (input) => {
        calls.push(['presentation.snapshot', input]);
        return PRESENTATION_PROJECTION;
      },
      commit: async (input) => {
        calls.push(['presentation.commit', input]);
        return PRESENTATION_PROJECTION;
      },
    },
  };
}

function reasonCode(error: unknown): string | undefined {
  return (error as { reasonCode?: string }).reasonCode;
}

test('sharedAIConfig get/overwrite round-trips the subsystem-owned projection', async () => {
  const calls: unknown[] = [];
  const client = createNimiLocalAppAgentConfigureClient(shell(calls));
  assert.deepEqual(await client.sharedAIConfig.get(), { config: SHARED_AI_CONFIG, revision: '1', effectiveSelections: [] });
  const capabilities = [...SHARED_AI_CONFIG.capabilities] as never;
  const input = { expectedRevision: '1', capabilities };
  const overwrite = await client.sharedAIConfig.overwrite(input);
  assert.equal(overwrite.outcome, 'committed');
  assert.deepEqual(overwrite.config?.capabilities, SHARED_AI_CONFIG.capabilities);
  assert.deepEqual(await client.sharedAIConfig.listOptions({ kind: 'local-loadouts', capabilityContract: 'text.generate' }), {
    kind: 'local-loadouts', options: [], truncated: false,
  });
  assert.deepEqual(calls, [
    ['sharedAIConfig.get'],
    ['sharedAIConfig.overwrite', input],
    ['sharedAIConfig.listOptions', { kind: 'local-loadouts', capabilityContract: 'text.generate' }],
  ]);
});

test('sharedAIConfig rejects a non-subsystem owner projection', async () => {
  const base = shell([]);
  const client = createNimiLocalAppAgentConfigureClient({
    ...base,
    sharedAIConfig: {
      ...base.sharedAIConfig,
      get: async () => ({
        config: { owner: { owner: { oneofKind: 'app', app: { appId: 'app.example' } } }, capabilities: [] },
        revision: '0', effectiveSelections: [],
      }),
    },
  });
  await assert.rejects(
    () => client.sharedAIConfig.get(),
    (error: unknown) => reasonCode(error) === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );
});

test('autonomy snapshot projects the exact CAS carrier', async () => {
  const calls: unknown[] = [];
  const client = createNimiLocalAppAgentConfigureClient(shell(calls));
  const snapshot = await client.autonomy.snapshot({ agentHandle: HANDLE });
  assert.deepEqual(snapshot, {
    enabled: true,
    config: {
      dailyTokenBudget: 1000,
      maxTokensPerHook: 100,
      mode: 'low',
    },
    usedTokensInWindow: 12,
    windowStartedAt: { seconds: '1750000000', nanos: 0 },
    budgetExhausted: false,
    autonomyRevision: '7',
  });
  assert.deepEqual(calls, [['autonomy.snapshot', { agentHandle: HANDLE }]]);
});

test('autonomy update enforces handle, revision, and intent shape before the carrier', async () => {
  const calls: unknown[] = [];
  const client = createNimiLocalAppAgentConfigureClient(shell(calls));
  const updated = await client.autonomy.update({
    agentHandle: HANDLE,
    expectedAutonomyRevision: '7',
    intent: {
      enabled: true,
      config: { dailyTokenBudget: 1000, maxTokensPerHook: 100, mode: 'medium' },
    },
  });
  assert.equal(updated.autonomyRevision, '7');
  assert.deepEqual(calls, [['autonomy.update', {
    agentHandle: HANDLE,
    expectedAutonomyRevision: '7',
    intent: {
      enabled: true,
      config: { dailyTokenBudget: 1000, maxTokensPerHook: 100, mode: 'medium' },
    },
  }]]);

  for (const [label, input] of [
    ['stale zero revision', {
      agentHandle: HANDLE, expectedAutonomyRevision: '0', intent: { enabled: true },
    }],
    ['leading zero revision', {
      agentHandle: HANDLE, expectedAutonomyRevision: '07', intent: { enabled: true },
    }],
    ['empty intent', {
      agentHandle: HANDLE, expectedAutonomyRevision: '1', intent: {},
    }],
    ['raw agent id', {
      agentHandle: 'raw-agent-id', expectedAutonomyRevision: '1', intent: { enabled: true },
    }],
    ['authority material', {
      agentHandle: HANDLE, expectedAutonomyRevision: '1', intent: { enabled: true }, sessionId: 'forged',
    }],
  ] as const) {
    await assert.rejects(
      () => client.autonomy.update(input as never),
      (error: unknown) => reasonCode(error)?.startsWith('SDK_LOCAL_APP_') === true,
      label,
    );
  }
  assert.deepEqual(calls.length, 1);
});

test('autonomy update rejects malformed projections fail-closed', async () => {
  const base = shell([]);
  const client = createNimiLocalAppAgentConfigureClient({
    ...base,
    autonomy: {
      ...base.autonomy,
      snapshot: async () => ({ ...AUTONOMY_PROJECTION, autonomyRevision: 'not-a-revision' }),
    },
  });
  await assert.rejects(
    () => client.autonomy.snapshot({ agentHandle: HANDLE }),
    (error: unknown) => reasonCode(error) === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );
});

test('presentation commit carries exact intent, imported assets, and the restore projection', async () => {
  const calls: unknown[] = [];
  const client = createNimiLocalAppAgentConfigureClient(shell(calls));
  const committed = await client.presentation.commit({
    agentHandle: HANDLE,
    expectedPresentationRevision: '0',
    intent: {
      backendKind: 'vrm',
      avatarAssetRef: 'asset://avatar/current',
      expressionProfileRef: '',
      idlePreset: 'idle-soft',
      interactionPolicyRef: '',
      defaultVoiceReference: '',
      avatarAutoplay: true,
      backgroundAssetRef: '',
    },
    importedAssets: [{
      role: 'avatar',
      fileName: 'avatar.vrm',
      mediaType: 'model/gltf-binary',
      content: new Uint8Array([1, 2, 255]),
      sha256: 'abc123',
    }],
  });
  assert.equal(committed.presentationRevision, '3');
  assert.equal(committed.previousProfile, null);
  const commitCall = calls[0] as [string, { importedAssets: Array<{ content: Uint8Array }> }];
  assert.equal(commitCall[0], 'presentation.commit');
  assert.deepEqual([...commitCall[1].importedAssets[0]!.content], [1, 2, 255]);
});

test('presentation snapshot projects the previous profile restore carrier', async () => {
  const base = shell([]);
  const previous = {
    backendKind: 'sprite2d',
    avatarAssetRef: 'asset://avatar/previous',
    expressionProfileRef: '',
    idlePreset: '',
    interactionPolicyRef: '',
    defaultVoiceReference: '',
    avatarAutoplay: false,
    backgroundAssetRef: '',
    revision: '2',
  };
  const client = createNimiLocalAppAgentConfigureClient({
    ...base,
    presentation: {
      ...base.presentation,
      snapshot: async () => ({ ...PRESENTATION_PROJECTION, previousProfile: previous }),
    },
  });
  const snapshot = await client.presentation.snapshot({ agentHandle: HANDLE });
  assert.equal(snapshot.previousProfile?.backendKind, 'sprite2d');
  assert.equal(snapshot.previousProfile?.revision, '2');
});

test('presentation commit rejects expanded intent and malformed assets before the carrier', async () => {
  const calls: unknown[] = [];
  const client = createNimiLocalAppAgentConfigureClient(shell(calls));
  const intent = {
    backendKind: 'vrm',
    avatarAssetRef: '',
    expressionProfileRef: '',
    idlePreset: '',
    interactionPolicyRef: '',
    defaultVoiceReference: '',
    avatarAutoplay: false,
    backgroundAssetRef: '',
  };
  await assert.rejects(
    () => client.presentation.commit({
      agentHandle: HANDLE,
      expectedPresentationRevision: '1',
      intent: { ...intent, revision: '9' } as never,
      importedAssets: [],
    }),
    (error: unknown) => reasonCode(error) === 'SDK_LOCAL_APP_INPUT_INVALID',
  );
  await assert.rejects(
    () => client.presentation.commit({
      agentHandle: HANDLE,
      expectedPresentationRevision: '1',
      intent,
      importedAssets: [{
        role: 'avatar',
        fileName: 'avatar.vrm',
        mediaType: 'model/gltf-binary',
        content: new Uint8Array(0),
        sha256: 'abc123',
      }],
    }),
    (error: unknown) => reasonCode(error) === 'SDK_LOCAL_APP_INPUT_INVALID',
  );
  assert.deepEqual(calls, []);
});
