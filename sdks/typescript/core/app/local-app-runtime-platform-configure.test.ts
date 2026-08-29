import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiLocalAppAgentConfigureClient,
  createNimiLocalAppAgentConfigureRuntimeShell,
  type NimiLocalAppAgentConfigureShell,
  type NimiLocalAppAgentConfigureRuntime,
} from './local-app-runtime-platform-configure.js';
import type { NimiLocalAppAgentHandle } from './local-app-runtime-platform-conversation.js';
import {
  AgentContextProjectionReasonCode,
  AgentConversationSummaryStatus,
  AgentExecutionState,
  AgentLifecycleStatus,
  AgentLocalSourceContextState,
  AgentLocalSourceCoverageSection,
  AgentLocalSourceCoverageState,
  AgentSourceCognitionStatus,
  AgentTurnContextLaneId,
  AgentTurnContextLaneState,
  AgentTurnContextState,
  AgentTurnContextTruncationReason,
  LocalAppAgentManagerActionAvailabilityState,
  LocalAppAgentManagerActionUnavailableReason,
  LocalAppAgentManagerProductAction,
} from '../../core-generated/runtime-typed-client.js';

const HANDLE = 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as NimiLocalAppAgentHandle;

const SHARED_AI_CONFIG = {
  owner: { owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} } },
  capabilities: [{
    capabilityContract: 'text.generate',
    requiredFeatures: [],
    route: { oneofKind: 'local', local: {} },
  }],
} as const;

const PARTICIPATION = [
  { role: 'conversation.primary', capabilityContract: 'text.generate' },
  { role: 'memory.embedding', capabilityContract: 'text.embed' },
  { role: 'conversation.input.voice', capabilityContract: 'audio.transcribe' },
  { role: 'conversation.output.voice', capabilityContract: 'audio.synthesize' },
  { role: 'conversation.realtime', capabilityContract: 'realtime.interact' },
  { role: 'conversation.action.image', capabilityContract: 'image.generate' },
] as const;

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
  avatarAutoplay: true,
  presentationRevision: '3',
} as const;

const MEMORY_PROJECTION = {
  outcome: 'ready',
  enabled: true,
  adoptionRequired: false,
  items: [],
  currentCount: 0,
  supersededCount: 0,
  forgottenCount: 0,
  nextPageToken: null,
} as const;

const MANAGER_PROJECTION = {
  lifecycleStatus: 'active',
  executionState: 'idle',
  statusText: 'Ready',
  currentEmotion: 'calm',
  source: {
    ready: true,
    state: 'ready',
    reasonCode: 'none',
    capturedAt: { seconds: '1750000000', nanos: 0 },
    coverageSections: [{
      section: 'identity',
      state: 'complete',
      requiredCount: 1,
      resolvedCount: 1,
      omittedCount: 0,
    }],
    lorebookReady: true,
    lorebookItemCount: 2,
    lorebookEstimatedTokens: '120',
  },
  context: {
    ready: true,
    state: 'ready',
    reasonCode: 'none',
    lanes: [{
      laneId: 'source_identity',
      state: 'included',
      includedItemCount: 1,
      omittedItemCount: 0,
      truncatedItemCount: 0,
      allocatedTokens: '64',
      usedTokens: '32',
    }],
    inputBudgetTokens: '1024',
    usedTokens: '32',
    requiredInputTokens: '32',
    requiredContextWindowTokens: '256',
    truncation: [{ reason: 'none', omittedItemCount: 0, truncatedItemCount: 0 }],
    transcriptTurnCount: 1,
    memoryItemCount: 0,
    mediaCount: 0,
    toolCount: 0,
    sourceAdapterStatus: 'ready',
    sourceSelectionStatus: 'ready',
    conversationSummaryStatus: 'absent',
    privateRecallCount: 0,
  },
  actionAvailability: {
    getSharedAIConfig: { state: 'available', reason: null },
    overwriteSharedAIConfig: { state: 'available', reason: null },
    readAutonomy: { state: 'available', reason: null },
    updateAutonomy: { state: 'available', reason: null },
    inspectMemory: { state: 'available', reason: null },
    correctMemory: { state: 'available', reason: null },
    forgetMemory: { state: 'available', reason: null },
    switchMemory: { state: 'available', reason: null },
    deleteAllMemory: { state: 'available', reason: null },
    replaceAppearance: { state: 'available', reason: null },
    restorePreviousAppearance: { state: 'unavailable', reason: 'previous-presentation-unavailable' },
  },
} as const;

const RUNTIME_MANAGER_ACTION_AVAILABILITY = [
  LocalAppAgentManagerProductAction.SHARED_AI_CONFIG_READ,
  LocalAppAgentManagerProductAction.SHARED_AI_CONFIG_WRITE,
  LocalAppAgentManagerProductAction.AUTONOMY_READ,
  LocalAppAgentManagerProductAction.AUTONOMY_WRITE,
  LocalAppAgentManagerProductAction.MEMORY_INSPECT,
  LocalAppAgentManagerProductAction.MEMORY_CORRECT,
  LocalAppAgentManagerProductAction.MEMORY_FORGET,
  LocalAppAgentManagerProductAction.MEMORY_SWITCH,
  LocalAppAgentManagerProductAction.MEMORY_DELETE,
  LocalAppAgentManagerProductAction.APPEARANCE_COMMIT,
  LocalAppAgentManagerProductAction.APPEARANCE_RESTORE,
].map((action) => ({
  action,
  state: action === LocalAppAgentManagerProductAction.APPEARANCE_RESTORE
    ? LocalAppAgentManagerActionAvailabilityState.UNAVAILABLE
    : LocalAppAgentManagerActionAvailabilityState.AVAILABLE,
  reason: action === LocalAppAgentManagerProductAction.APPEARANCE_RESTORE
    ? LocalAppAgentManagerActionUnavailableReason.PREVIOUS_PRESENTATION_UNAVAILABLE
    : LocalAppAgentManagerActionUnavailableReason.NONE,
}));

function shell(calls: unknown[]): NimiLocalAppAgentConfigureShell {
  return {
    sharedAIConfig: {
      get: async () => {
        calls.push(['sharedAIConfig.get']);
        return { config: SHARED_AI_CONFIG, revision: '1', effectiveSelections: [], participation: PARTICIPATION };
      },
      overwrite: async (input) => {
        calls.push(['sharedAIConfig.overwrite', input]);
        return {
          outcome: 'committed', config: { ...SHARED_AI_CONFIG, capabilities: input.capabilities },
          revision: '2', participation: PARTICIPATION,
        };
      },
      listOptions: async (query) => {
        calls.push(['sharedAIConfig.listOptions', query]);
        if (query.kind === 'preset-voices') {
          return {
            kind: 'preset-voices',
            options: [{ voiceId: 'serena', name: 'Serena', supportedLangs: ['zh', 'en'] }],
            truncated: false,
          };
        }
        if (query.kind === 'voice-assets') {
          return {
            kind: 'voice-assets',
            options: [{ voiceAssetId: 'voice-asset-1' }],
            truncated: false,
          };
        }
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
      readAsset: async (input) => {
        calls.push(['presentation.readAsset', input]);
        return {
          assetRef: 'vrm_0123456789ab',
          role: 'avatar',
          backendKind: 'vrm',
          fileName: 'avatar.vrm',
          mediaType: 'model/gltf-binary',
          content: [1, 2, 3],
          sha256: 'a'.repeat(64),
        };
      },
      commit: async (input) => {
        calls.push(['presentation.commit', input]);
        return PRESENTATION_PROJECTION;
      },
    },
    memory: {
      inspect: async (input) => {
        calls.push(['memory.inspect', input]);
        return MEMORY_PROJECTION;
      },
      correct: async () => ({ outcome: 'committed', affectedMemoryIds: [], projection: MEMORY_PROJECTION }),
      forget: async () => ({ outcome: 'forgotten', affectedMemoryIds: [], projection: MEMORY_PROJECTION }),
      setEnabled: async () => ({ outcome: 'committed', affectedMemoryIds: [], projection: MEMORY_PROJECTION }),
      deleteAll: async () => ({ outcome: 'deleted', affectedMemoryIds: [], projection: MEMORY_PROJECTION }),
    },
    manager: {
      snapshot: async (input) => {
        calls.push(['manager.snapshot', input]);
        return MANAGER_PROJECTION;
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
  assert.deepEqual(await client.sharedAIConfig.get(), { config: SHARED_AI_CONFIG, revision: '1', effectiveSelections: [], participation: PARTICIPATION });
  const capabilities = [...SHARED_AI_CONFIG.capabilities] as never;
  const input = { expectedRevision: '1', capabilities };
  const overwrite = await client.sharedAIConfig.overwrite(input);
  assert.equal(overwrite.outcome, 'committed');
  assert.deepEqual(overwrite.config?.capabilities, SHARED_AI_CONFIG.capabilities);
  assert.deepEqual(await client.sharedAIConfig.listOptions({ kind: 'local-loadouts', capabilityContract: 'text.generate' }), {
    kind: 'local-loadouts', options: [], truncated: false,
  });
  assert.deepEqual(await client.sharedAIConfig.listOptions({ kind: 'preset-voices' }), {
    kind: 'preset-voices',
    options: [{ voiceId: 'serena', name: 'Serena', supportedLangs: ['zh', 'en'] }],
    truncated: false,
  });
  assert.deepEqual(await client.sharedAIConfig.listOptions({ kind: 'voice-assets' }), {
    kind: 'voice-assets',
    options: [{ voiceAssetId: 'voice-asset-1' }],
    truncated: false,
  });
  assert.deepEqual(calls, [
    ['sharedAIConfig.get'],
    ['sharedAIConfig.overwrite', input],
    ['sharedAIConfig.listOptions', { kind: 'local-loadouts', capabilityContract: 'text.generate' }],
    ['sharedAIConfig.listOptions', { kind: 'preset-voices' }],
    ['sharedAIConfig.listOptions', { kind: 'voice-assets' }],
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
        participation: PARTICIPATION,
      }),
    },
  });
  await assert.rejects(
    () => client.sharedAIConfig.get(),
    (error: unknown) => reasonCode(error) === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );
});

test('sharedAIConfig rejects over-bounded preset voice projections', async () => {
  const base = shell([]);
  const client = createNimiLocalAppAgentConfigureClient({
    ...base,
    sharedAIConfig: {
      ...base.sharedAIConfig,
      listOptions: async () => ({
        kind: 'preset-voices', truncated: true,
        options: Array.from({ length: 101 }, (_, index) => ({
          voiceId: `voice-${index}`, name: `Voice ${index}`, supportedLangs: ['en'],
        })),
      }),
    },
  });
  await assert.rejects(
    () => client.sharedAIConfig.listOptions({ kind: 'preset-voices' }),
    (error: unknown) => reasonCode(error) === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );
});

test('sharedAIConfig rejects malformed custom VoiceAsset projections', async () => {
  const base = shell([]);
  const client = createNimiLocalAppAgentConfigureClient({
    ...base,
    sharedAIConfig: {
      ...base.sharedAIConfig,
      listOptions: async () => ({
        kind: 'voice-assets', truncated: false,
        options: [{ voiceAssetId: ' voice-asset-1' }],
      }),
    },
  });
  await assert.rejects(
    () => client.sharedAIConfig.listOptions({ kind: 'voice-assets' }),
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

test('manager snapshot carries only the handle and optional conversation anchor and projects safe bounded state', async () => {
  const calls: unknown[] = [];
  const client = createNimiLocalAppAgentConfigureClient(shell(calls));
  const snapshot = await client.manager.snapshot({
    agentHandle: HANDLE,
    conversationAnchorId: 'conversation-anchor-1',
  });
  assert.deepEqual(snapshot, MANAGER_PROJECTION);
  assert.deepEqual(calls, [['manager.snapshot', {
    agentHandle: HANDLE,
    conversationAnchorId: 'conversation-anchor-1',
  }]]);
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /promptHash|reservedReasoningTokens|generation|localAgentRef|ownerUserId|sourceHash|provider|storage/u,
  );
});

test('manager snapshot preserves optional omissions independently from required coverage', async () => {
  const base = shell([]);
  const projection = {
    ...MANAGER_PROJECTION,
    source: {
      ...MANAGER_PROJECTION.source,
      coverageSections: [{
        section: 'dependency_closure',
        state: 'complete',
        requiredCount: 1,
        resolvedCount: 1,
        omittedCount: 1,
      }],
    },
  } as const;
  const client = createNimiLocalAppAgentConfigureClient({
    ...base,
    manager: { snapshot: async () => projection },
  });
  assert.deepEqual(
    (await client.manager.snapshot({ agentHandle: HANDLE })).source?.coverageSections,
    projection.source.coverageSections,
  );

  const invalid = createNimiLocalAppAgentConfigureClient({
    ...base,
    manager: { snapshot: async () => ({
      ...projection,
      source: {
        ...projection.source,
        coverageSections: [{
          ...projection.source.coverageSections[0],
          requiredCount: 2,
          resolvedCount: 1,
        }],
      },
    }) },
  });
  await assert.rejects(
    () => invalid.manager.snapshot({ agentHandle: HANDLE }),
    (error: unknown) => reasonCode(error) === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );
});

test('manager snapshot rejects expanded input and over-bounded or private projections fail closed', async () => {
  const calls: unknown[] = [];
  const client = createNimiLocalAppAgentConfigureClient(shell(calls));
  await assert.rejects(
    () => client.manager.snapshot({ agentHandle: HANDLE, ownerUserId: 'forged' } as never),
    (error: unknown) => reasonCode(error)?.startsWith('SDK_LOCAL_APP_') === true,
  );

  const base = shell([]);
  for (const projection of [
    { ...MANAGER_PROJECTION, promptHash: 'forbidden' },
    {
      ...MANAGER_PROJECTION,
      context: { ...MANAGER_PROJECTION.context!, reservedReasoningTokens: '64' },
    },
    {
      ...MANAGER_PROJECTION,
      context: { ...MANAGER_PROJECTION.context!, lanes: [{ ...MANAGER_PROJECTION.context!.lanes[0]!, generation: '1' }] },
    },
    {
      ...MANAGER_PROJECTION,
      actionAvailability: {
        ...MANAGER_PROJECTION.actionAvailability,
        correctMemory: { state: 'available', reason: 'memory-disabled' },
      },
    },
    {
      ...MANAGER_PROJECTION,
      actionAvailability: Object.fromEntries(
        Object.entries(MANAGER_PROJECTION.actionAvailability).filter(([action]) => action !== 'forgetMemory'),
      ),
    },
  ]) {
    const malformed = createNimiLocalAppAgentConfigureClient({
      ...base,
      manager: { snapshot: async () => projection },
    });
    await assert.rejects(
      () => malformed.manager.snapshot({ agentHandle: HANDLE }),
      (error: unknown) => reasonCode(error) === 'SDK_LOCAL_APP_PROJECTION_INVALID',
    );
  }
  assert.deepEqual(calls, []);
});

test('Memory projection rejects forgotten record content while preserving forgotten outcome and count', async () => {
  const base = shell([]);
  const forgottenProjection = {
    ...MEMORY_PROJECTION,
    outcome: 'forgotten',
    items: [{
      memoryId: 'memory-forgotten',
      content: 'This content must not cross the SDK boundary.',
      epistemicStatus: 'explicit',
      lifecycle: 'forgotten',
      occurredAt: '2026-08-28T00:00:00.000Z',
      updatedAt: '2026-08-28T00:01:00.000Z',
      sourceExplanation: 'Forgotten owner record.',
    }],
    forgottenCount: 1,
  } as const;
  const client = createNimiLocalAppAgentConfigureClient({
    ...base,
    memory: {
      ...base.memory,
      inspect: async () => forgottenProjection,
      forget: async () => ({
        outcome: 'forgotten' as const,
        affectedMemoryIds: ['memory-forgotten'],
        projection: { ...forgottenProjection, items: [] },
      }),
    },
  });

  await assert.rejects(
    () => client.memory.inspect({ agentHandle: HANDLE }),
    (error: unknown) => reasonCode(error) === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );
  const result = await client.memory.forget({
    agentHandle: HANDLE,
    memoryIds: ['memory-forgotten'],
    confirmed: true,
  });
  assert.equal(result.outcome, 'forgotten');
  assert.equal(result.projection.forgottenCount, 1);
  assert.deepEqual(result.projection.items, []);
});

test('Memory inspect carries one bounded opaque page request and preserves the next-page seam', async () => {
  const calls: unknown[] = [];
  const base = shell(calls);
  const client = createNimiLocalAppAgentConfigureClient({
    ...base,
    memory: {
      ...base.memory,
      inspect: async (input) => {
        calls.push(['paged-memory.inspect', input]);
        return { ...MEMORY_PROJECTION, nextPageToken: 'opaque-page-2' };
      },
    },
  });
  const page = await client.memory.inspect({
    agentHandle: HANDLE,
    limit: 25,
    pageToken: 'opaque-page-1',
  });
  assert.equal(page.nextPageToken, 'opaque-page-2');
  assert.deepEqual(calls, [['paged-memory.inspect', {
    agentHandle: HANDLE,
    limit: 25,
    pageToken: 'opaque-page-1',
  }]]);

  for (const input of [
    { agentHandle: HANDLE, limit: 0 },
    { agentHandle: HANDLE, limit: 101 },
    { agentHandle: HANDLE, pageToken: ' opaque-page' },
  ]) {
    await assert.rejects(
      () => client.memory.inspect(input),
      (error: unknown) => reasonCode(error) === 'SDK_LOCAL_APP_PROJECTION_INVALID',
    );
  }
  assert.equal(calls.length, 1);
});

test('Desktop Runtime transport uses the same canonical configure shell and strips generated enum/wrapper shape', async () => {
  const calls: unknown[] = [];
  const runtime = {
    async getLocalAppAgentManagerSnapshot(input: unknown) {
      calls.push(input);
      return {
        snapshot: {
          lifecycleStatus: AgentLifecycleStatus.ACTIVE,
          executionState: AgentExecutionState.CHAT_ACTIVE,
          statusText: 'Chatting',
          currentEmotion: 'focused',
          source: {
            ready: true,
            state: AgentLocalSourceContextState.READY,
            reasonCode: AgentContextProjectionReasonCode.NONE,
            capturedAt: { seconds: '1750000000', nanos: 0 },
            coverageSections: [{
              section: AgentLocalSourceCoverageSection.IDENTITY,
              state: AgentLocalSourceCoverageState.COMPLETE,
              requiredCount: 1,
              resolvedCount: 1,
              omittedCount: 0,
            }],
            lorebookReady: true,
            lorebookItemCount: 1,
            lorebookEstimatedTokens: '64',
          },
          context: {
            ready: true,
            state: AgentTurnContextState.READY,
            reasonCode: AgentContextProjectionReasonCode.NONE,
            lanes: [{
              laneId: AgentTurnContextLaneId.SOURCE_IDENTITY,
              state: AgentTurnContextLaneState.INCLUDED,
              includedItemCount: 1,
              omittedItemCount: 0,
              truncatedItemCount: 0,
              allocatedTokens: '64',
              usedTokens: '32',
            }],
            inputBudgetTokens: '1024',
            usedTokens: '32',
            requiredInputTokens: '32',
            requiredContextWindowTokens: '256',
            truncation: [{
              reason: AgentTurnContextTruncationReason.NONE,
              omittedItemCount: 0,
              truncatedItemCount: 0,
            }],
            transcriptTurnCount: 1,
            memoryItemCount: 0,
            mediaCount: 0,
            toolCount: 0,
            sourceAdapterStatus: AgentSourceCognitionStatus.READY,
            sourceSelectionStatus: AgentSourceCognitionStatus.READY,
            conversationSummaryStatus: AgentConversationSummaryStatus.ABSENT,
            privateRecallCount: 0,
          },
          actionAvailability: RUNTIME_MANAGER_ACTION_AVAILABILITY,
        },
      };
    },
  } as unknown as NimiLocalAppAgentConfigureRuntime;
  const client = createNimiLocalAppAgentConfigureClient(
    createNimiLocalAppAgentConfigureRuntimeShell(runtime),
  );
  const snapshot = await client.manager.snapshot({
    agentHandle: HANDLE,
    conversationAnchorId: 'anchor-1',
  });
  assert.deepEqual(calls, [{ agentHandle: HANDLE, conversationAnchorId: 'anchor-1' }]);
  assert.equal(snapshot.lifecycleStatus, 'active');
  assert.equal(snapshot.executionState, 'chat-active');
  assert.equal(snapshot.context?.lanes[0]?.laneId, 'source_identity');
  assert.doesNotMatch(JSON.stringify(snapshot), /promptHash|reservedReasoningTokens|generation|sourceHash/u);
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

test('presentation asset read carries only current handle and committed asset ref', async () => {
  const calls: unknown[] = [];
  const client = createNimiLocalAppAgentConfigureClient(shell(calls));
  const asset = await client.presentation.readAsset({
    agentHandle: HANDLE,
    assetRef: 'vrm_0123456789ab',
  });
  assert.deepEqual(calls, [['presentation.readAsset', {
    agentHandle: HANDLE,
    assetRef: 'vrm_0123456789ab',
  }]]);
  assert.equal(asset.role, 'avatar');
  assert.equal(asset.backendKind, 'vrm');
  assert.deepEqual([...asset.content], [1, 2, 3]);
  assert.equal(Object.isFrozen(asset), true);
});

test('presentation voice-only patch preserves top-level voice and autoplay without an Avatar backend', async () => {
  const calls: unknown[] = [];
  const base = shell(calls);
  const client = createNimiLocalAppAgentConfigureClient({
    ...base,
    presentation: {
      ...base.presentation,
      snapshot: async () => ({
        profile: null,
        previousProfile: null,
        defaultVoiceReference: '',
        avatarAutoplay: false,
        presentationRevision: '0',
      }),
      commit: async (input) => {
        calls.push(['presentation.commit', input]);
        const voice = String(input.intent.defaultVoiceReference || '');
        const autoplay = Boolean(input.intent.avatarAutoplay);
        return {
          profile: {
            backendKind: null,
            avatarAssetRef: '',
            expressionProfileRef: '',
            idlePreset: '',
            interactionPolicyRef: '',
            defaultVoiceReference: voice,
            avatarAutoplay: autoplay,
            backgroundAssetRef: '',
            revision: '1',
          },
          previousProfile: null,
          defaultVoiceReference: voice,
          avatarAutoplay: autoplay,
          presentationRevision: '1',
        };
      },
    },
  });

  const committed = await client.presentation.commit({
    agentHandle: HANDLE,
    expectedPresentationRevision: '0',
    intent: { defaultVoiceReference: 'preset_voice_id:serena', avatarAutoplay: true },
    importedAssets: [],
  });
  assert.deepEqual(committed, {
    profile: {
      backendKind: null,
      avatarAssetRef: '',
      expressionProfileRef: '',
      idlePreset: '',
      interactionPolicyRef: '',
      defaultVoiceReference: 'preset_voice_id:serena',
      avatarAutoplay: true,
      backgroundAssetRef: '',
      revision: '1',
    },
    previousProfile: null,
    defaultVoiceReference: 'preset_voice_id:serena',
    avatarAutoplay: true,
    presentationRevision: '1',
  });
  assert.deepEqual(calls, [['presentation.commit', {
    agentHandle: HANDLE,
    expectedPresentationRevision: '0',
    intent: { defaultVoiceReference: 'preset_voice_id:serena', avatarAutoplay: true },
    importedAssets: [],
  }]]);
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
