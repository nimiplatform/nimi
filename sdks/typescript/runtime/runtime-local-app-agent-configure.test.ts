import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentExecutionState,
  AgentLifecycleStatus,
  CognitionMemoryEpistemicStatus,
  CognitionMemoryLifecycle,
  CognitionMemoryOutcome,
  LocalAgentCapabilityParticipationRole,
  LocalAppAgentManagerActionAvailabilityState,
  LocalAppAgentManagerActionUnavailableReason,
  LocalAppAgentManagerProductAction,
  LocalAppAgentAutonomyMode,
  ReasonCode,
} from '../core-generated/runtime-typed-client.js';
import {
  createNimiLocalAppAgentConfigureClient,
} from '../core/app/local-app-runtime-platform-configure.js';
import type { NimiLocalAppAgentHandle } from '../core/app/local-app-runtime-platform-conversation.js';
import {
  createNimiRuntimeLocalAppAgentConfigureShell,
  type NimiRuntimeLocalAppAgentConfigureTransport,
} from './runtime-local-app-agent-configure.js';

const HANDLE = 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as NimiLocalAppAgentHandle;

const MANAGER_ACTION_AVAILABILITY = [
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

const PARTICIPATION = [
  [LocalAgentCapabilityParticipationRole.CONVERSATION_PRIMARY, 'text.generate'],
  [LocalAgentCapabilityParticipationRole.MEMORY_EMBEDDING, 'text.embed'],
  [LocalAgentCapabilityParticipationRole.CONVERSATION_INPUT_VOICE, 'audio.transcribe'],
  [LocalAgentCapabilityParticipationRole.CONVERSATION_OUTPUT_VOICE, 'audio.synthesize'],
  [LocalAgentCapabilityParticipationRole.CONVERSATION_REALTIME, 'realtime.interact'],
  [LocalAgentCapabilityParticipationRole.CONVERSATION_ACTION_IMAGE, 'image.generate'],
].map(([role, capabilityContract]) => ({
  role: role as LocalAgentCapabilityParticipationRole,
  capabilityContract: capabilityContract as string,
}));

const SHARED_CONFIG = {
  owner: { owner: { oneofKind: 'runtimeLocalAgentSubsystem' as const, runtimeLocalAgentSubsystem: {} } },
  capabilities: [],
};

const SHARED_PROJECTION = {
  config: SHARED_CONFIG,
  revision: '4',
  effectiveSelections: [],
  participation: PARTICIPATION,
};

const AUTONOMY_PROJECTION = {
  enabled: true,
  config: {
    dailyTokenBudget: '1200',
    maxTokensPerHook: '120',
    minHookInterval: { seconds: '30', nanos: 0 },
    mode: LocalAppAgentAutonomyMode.LOW,
  },
  usedTokensInWindow: '12',
  windowStartedAt: { seconds: '1750000000', nanos: 0 },
  budgetExhausted: false,
  autonomyRevision: '7',
};

const PRESENTATION_PROJECTION = {
  defaultVoiceReference: 'preset_voice_id:serena',
  presentationRevision: '3',
  avatarAutoplay: true,
};

const MEMORY_PROJECTION = {
  outcome: CognitionMemoryOutcome.READY,
  enabled: true,
  adoptionRequired: false,
  items: [{
    memoryId: 'memory-1',
    content: 'Prefers jasmine tea.',
    epistemicStatus: CognitionMemoryEpistemicStatus.EXPLICIT,
    lifecycle: CognitionMemoryLifecycle.CURRENT,
    occurredAt: { seconds: '1750000000', nanos: 0 },
    updatedAt: { seconds: '1750000010', nanos: 0 },
    sourceExplanation: 'Committed conversation fact.',
  }],
  currentCount: '1',
  supersededCount: '0',
  forgottenCount: '0',
  nextPageToken: 'opaque-next-page',
};

test('Runtime configure adapter carries all canonical Agent Product operations without identity sideband', async () => {
  const calls: Array<readonly [string, unknown]> = [];
  const transport: NimiRuntimeLocalAppAgentConfigureTransport = {
    async getLocalAppAgentManagerSnapshot(request) {
      calls.push(['manager.snapshot', request]);
      return {
        snapshot: {
          lifecycleStatus: AgentLifecycleStatus.ACTIVE,
          executionState: AgentExecutionState.IDLE,
          statusText: 'Ready',
          currentEmotion: 'calm',
          actionAvailability: MANAGER_ACTION_AVAILABILITY,
          // Simulate an upstream object with forbidden implementation details;
          // the bounded adapter must never forward them.
          localAgentRef: 'private-agent-ref',
          ownerUserId: 'private-owner',
          privateBinding: { bankRef: 'private-bank' },
        } as never,
      };
    },
    async getLocalAppSharedLocalAgentAIConfig(request) {
      calls.push(['shared.get', request]);
      return { projection: SHARED_PROJECTION };
    },
    async overwriteLocalAppSharedLocalAgentAIConfig(request) {
      calls.push(['shared.overwrite', request]);
      return { projection: { ...SHARED_PROJECTION, revision: '5' }, committed: true, reasonCode: ReasonCode.NONE };
    },
    async listLocalAppSharedLocalAgentAIConfigOptions(request) {
      calls.push(['shared.listOptions', request]);
      return {
        result: {
          oneofKind: 'presetVoices',
          presetVoices: { options: [{ voiceId: 'serena', name: 'Serena', supportedLangs: ['en', 'zh'] }] },
        },
        truncated: false,
      };
    },
    async getLocalAppAgentAutonomySnapshot(request) {
      calls.push(['autonomy.snapshot', request]);
      return { projection: AUTONOMY_PROJECTION };
    },
    async updateLocalAppAgentAutonomy(request) {
      calls.push(['autonomy.update', request]);
      return { projection: { ...AUTONOMY_PROJECTION, autonomyRevision: '8' } };
    },
    async getLocalAppAgentPresentationSnapshot(request) {
      calls.push(['presentation.snapshot', request]);
      return { projection: PRESENTATION_PROJECTION };
    },
    async commitLocalAppAgentPresentation(request) {
      calls.push(['presentation.commit', request]);
      return { projection: { ...PRESENTATION_PROJECTION, presentationRevision: '4' } };
    },
    async inspectLocalAppAgentMemory(request) {
      calls.push(['memory.inspect', request]);
      return { projection: MEMORY_PROJECTION };
    },
    async correctLocalAppAgentMemory(request) {
      calls.push(['memory.correct', request]);
      return { outcome: CognitionMemoryOutcome.COMMITTED, affectedMemoryIds: ['memory-1'], projection: MEMORY_PROJECTION };
    },
    async forgetLocalAppAgentMemory(request) {
      calls.push(['memory.forget', request]);
      return { outcome: CognitionMemoryOutcome.FORGOTTEN, affectedMemoryIds: ['memory-1'], projection: MEMORY_PROJECTION };
    },
    async setLocalAppAgentMemoryEnabled(request) {
      calls.push(['memory.setEnabled', request]);
      return { outcome: CognitionMemoryOutcome.COMMITTED, projection: MEMORY_PROJECTION };
    },
    async deleteAllLocalAppAgentMemory(request) {
      calls.push(['memory.deleteAll', request]);
      return { outcome: CognitionMemoryOutcome.DELETED, affectedMemoryIds: ['memory-1'], projection: MEMORY_PROJECTION };
    },
  };

  const client = createNimiLocalAppAgentConfigureClient(
    createNimiRuntimeLocalAppAgentConfigureShell(transport),
  );

  const manager = await client.manager.snapshot({ agentHandle: HANDLE, conversationAnchorId: 'conversation-1' });
  assert.deepEqual(manager, {
    lifecycleStatus: 'active',
    executionState: 'idle',
    statusText: 'Ready',
    currentEmotion: 'calm',
    source: null,
    context: null,
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
  });
  assert.equal('localAgentRef' in manager, false);
  assert.equal('ownerUserId' in manager, false);
  assert.equal('privateBinding' in manager, false);

  assert.equal((await client.sharedAIConfig.get()).revision, '4');
  assert.equal((await client.sharedAIConfig.overwrite({ capabilities: [], expectedRevision: '4' })).revision, '5');
  assert.deepEqual(await client.sharedAIConfig.listOptions({ kind: 'preset-voices' }), {
    kind: 'preset-voices',
    options: [{ voiceId: 'serena', name: 'Serena', supportedLangs: ['en', 'zh'] }],
    truncated: false,
  });

  assert.equal((await client.autonomy.snapshot({ agentHandle: HANDLE })).config?.mode, 'low');
  assert.equal((await client.autonomy.update({
    agentHandle: HANDLE,
    expectedAutonomyRevision: '7',
    intent: { enabled: true },
  })).autonomyRevision, '8');
  assert.equal((await client.presentation.snapshot({ agentHandle: HANDLE })).presentationRevision, '3');
  assert.equal((await client.presentation.commit({
    agentHandle: HANDLE,
    expectedPresentationRevision: '3',
    intent: { avatarAutoplay: true },
    importedAssets: [],
  })).presentationRevision, '4');

  const memoryPage = await client.memory.inspect({ agentHandle: HANDLE });
  assert.equal(memoryPage.items[0]?.epistemicStatus, 'explicit');
  assert.equal(memoryPage.nextPageToken, 'opaque-next-page');
  assert.equal((await client.memory.correct({ agentHandle: HANDLE, memoryId: 'memory-1', correctedContent: 'Prefers oolong tea.' })).outcome, 'committed');
  assert.equal((await client.memory.forget({ agentHandle: HANDLE, memoryIds: ['memory-1'], confirmed: true })).outcome, 'forgotten');
  assert.equal((await client.memory.setEnabled({ agentHandle: HANDLE, enabled: false })).outcome, 'committed');
  assert.equal((await client.memory.deleteAll({ agentHandle: HANDLE, confirmed: true })).outcome, 'deleted');

  assert.equal(calls.length, 13);
  for (const [, request] of calls) {
    assert.equal(hasForbiddenIdentity(request), false);
  }

  const forgottenClient = createNimiLocalAppAgentConfigureClient(
    createNimiRuntimeLocalAppAgentConfigureShell({
      ...transport,
      async inspectLocalAppAgentMemory() {
        return {
          projection: {
            ...MEMORY_PROJECTION,
            items: [{
              ...MEMORY_PROJECTION.items[0]!,
              lifecycle: CognitionMemoryLifecycle.FORGOTTEN,
            }],
            currentCount: '0',
            forgottenCount: '1',
          },
        };
      },
    }),
  );
  await assert.rejects(
    () => forgottenClient.memory.inspect({ agentHandle: HANDLE }),
    (error: unknown) => (
      typeof error === 'object'
      && error !== null
      && (error as { reasonCode?: unknown }).reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID'
    ),
  );
});

function hasForbiddenIdentity(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasForbiddenIdentity);
  const record = value as Record<string, unknown>;
  return Object.keys(record).some((key) => [
    'localAgentRef', 'ownerUserId', 'runtimeSourceRef', 'accountId', 'privateBinding',
  ].includes(key)) || Object.values(record).some(hasForbiddenIdentity);
}
