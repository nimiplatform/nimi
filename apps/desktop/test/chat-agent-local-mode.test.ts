import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  CORE_CHAT_AGENT_MOD_ID,
  invokeChatAgentRuntime,
  isAgentLocalRouteReady,
  resolveAgentLocalRoute,
} from '../src/shell/renderer/features/chat/chat-agent-runtime.js';
import {
  findAgentConversationThreadByAgentId,
  resolveAgentConversationActiveThreadId,
  toAgentFriendTargetsFromSocialSnapshot,
} from '../src/shell/renderer/features/chat/chat-agent-thread-model.js';
import {
  resolveAgentChatThinkingSupport,
  resolveChatThinkingConfig,
} from '../src/shell/renderer/features/chat/chat-thinking.js';
import type { AgentLocalThreadSummary } from '../src/shell/renderer/bridge/runtime-bridge/chat-agent-types.js';
import {
  buildAgentEffectiveCapabilityResolution,
  createAISnapshot,
} from '../src/shell/renderer/features/chat/conversation-capability.js';
import { createEmptyAIConfig } from '@nimiplatform/sdk/mod';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

test('agent local mode filters social snapshot to agent friends and fails close on broken agent targets', () => {
  const targets = toAgentFriendTargetsFromSocialSnapshot({
    friends: [
      {
        id: 'human-1',
        displayName: 'Human',
        handle: 'human',
        isAgent: false,
      },
      {
        id: 'agent-1',
        displayName: 'Companion',
        handle: 'companion',
        isAgent: true,
        worldId: 'world-1',
        worldName: 'World One',
        bio: 'friend agent',
        ownershipType: 'MASTER_OWNED',
      },
    ],
  });

  assert.deepEqual(targets, [{
    agentId: 'agent-1',
    displayName: 'Companion',
    handle: 'companion',
    avatarUrl: null,
    worldId: 'world-1',
    worldName: 'World One',
    bio: 'friend agent',
    ownershipType: 'MASTER_OWNED',
  }]);

  assert.throws(() => {
    toAgentFriendTargetsFromSocialSnapshot({
      friends: [{
        id: 'agent-2',
        displayName: '',
        handle: 'broken',
        isAgent: true,
      }],
    });
  }, /displayName is required/);
});

test('agent local mode keeps one thread per agent when restoring selection', () => {
  const threads: AgentLocalThreadSummary[] = [
    {
      id: 'thread-agent-1',
      agentId: 'agent-1',
      title: 'Agent One',
      updatedAtMs: 100,
      lastMessageAtMs: 90,
      archivedAtMs: null,
      targetSnapshot: {
        agentId: 'agent-1',
        displayName: 'Agent One',
        handle: 'agent-one',
        avatarUrl: null,
        worldId: null,
        worldName: null,
        bio: null,
        ownershipType: null,
      },
    },
    {
      id: 'thread-agent-2',
      agentId: 'agent-2',
      title: 'Agent Two',
      updatedAtMs: 200,
      lastMessageAtMs: 180,
      archivedAtMs: null,
      targetSnapshot: {
        agentId: 'agent-2',
        displayName: 'Agent Two',
        handle: 'agent-two',
        avatarUrl: null,
        worldId: null,
        worldName: null,
        bio: null,
        ownershipType: null,
      },
    },
  ];

  assert.equal(findAgentConversationThreadByAgentId(threads, 'agent-2')?.id, 'thread-agent-2');
  assert.equal(resolveAgentConversationActiveThreadId({
    threads,
    selectionThreadId: null,
    selectionAgentId: 'agent-2',
    lastSelectedThreadId: 'thread-agent-1',
  }), 'thread-agent-2');
  assert.equal(resolveAgentConversationActiveThreadId({
    threads,
    selectionThreadId: 'thread-missing',
    selectionAgentId: 'agent-1',
    lastSelectedThreadId: 'thread-agent-2',
  }), 'thread-agent-1');
});

test('agent local runtime route readiness stays fail-close for non-local routes', async () => {
  const localRoute = await resolveAgentLocalRoute('agent-1', {
    resolveAgentChatRouteImpl: async () => ({
      channel: 'LOCAL',
      providerSelectable: false,
      reason: 'ok',
      sessionClass: 'AGENT_LOCAL',
    }),
  });
  const remoteRoute = await resolveAgentLocalRoute('agent-1', {
    resolveAgentChatRouteImpl: async () => ({
      channel: 'CLOUD',
      providerSelectable: true,
      reason: 'remote',
      sessionClass: 'HUMAN_DIRECT',
    }),
  });

  assert.equal(isAgentLocalRouteReady(localRoute), true);
  assert.equal(isAgentLocalRouteReady(remoteRoute), false);
  await assert.rejects(
    () => resolveAgentLocalRoute('agent-1', {
      resolveAgentChatRouteImpl: async () => ({ channel: 'bad' }),
    }),
    /channel is invalid/,
  );
});

test('agent local runtime invoke passes core mod id and agentId to the runtime call', async () => {
  const projection = {
    capability: 'text.generate' as const,
    selectedBinding: {
      source: 'local' as const,
      connectorId: '',
      model: 'llama3',
    },
    resolvedBinding: {
      capability: 'text.generate' as const,
      source: 'local' as const,
      provider: 'llama',
      model: 'llama3',
      modelId: 'llama3',
      localModelId: 'local-chat-1',
      connectorId: '',
      endpoint: 'http://127.0.0.1:11434/v1',
      localProviderEndpoint: 'http://127.0.0.1:11434/v1',
    },
    health: {
      healthy: true,
      status: 'healthy' as const,
      detail: 'ready',
    },
    metadata: {
      capability: 'text.generate' as const,
      metadataVersion: 'v1' as const,
      resolvedBindingRef: 'local:llama3',
      metadataKind: 'text.generate' as const,
      metadata: {
        supportsThinking: false,
        traceModeSupport: 'none' as const,
        supportsImageInput: false,
        supportsAudioInput: false,
        supportsVideoInput: false,
        supportsArtifactRefInput: false,
      },
    },
    supported: true,
    reasonCode: null,
  };
  const agentResolution = buildAgentEffectiveCapabilityResolution({
    textProjection: projection,
    eligibility: {
      channel: 'LOCAL',
      providerSelectable: false,
      reason: 'ok',
      sessionClass: 'AGENT_LOCAL',
    },
  });
  const executionSnapshot = createAISnapshot({
    config: createEmptyAIConfig(),
    capability: 'text.generate',
    projection,
    agentResolution,
  });

  const result = await invokeChatAgentRuntime({
    agentId: 'agent-1',
    prompt: 'hello',
    threadId: 'thread-1',
    reasoningPreference: 'off',
    routeResult: {
      channel: 'LOCAL',
      providerSelectable: false,
      reason: 'ok',
      sessionClass: 'AGENT_LOCAL',
    },
    agentResolution,
    executionSnapshot,
    runtimeConfigState: null,
    runtimeFields: {
      targetType: '',
      targetAccountId: '',
      agentId: '',
      targetId: '',
      worldId: '',
      provider: 'llama',
      runtimeModelType: 'chat',
      localProviderEndpoint: 'http://127.0.0.1:11434/v1',
      localProviderModel: 'llama3',
      localOpenAiEndpoint: 'http://127.0.0.1:11434/v1',
      connectorId: '',
      mode: 'STORY',
      turnIndex: 1,
      userConfirmedUpload: false,
    },
  }, {
    invokeModLlmImpl: async (input) => {
      assert.equal(input.modId, CORE_CHAT_AGENT_MOD_ID);
      assert.equal(input.agentId, 'agent-1');
      return {
        text: 'hi',
        traceId: 'trace-1',
        promptTraceId: 'prompt-trace-1',
      };
    },
  });

  assert.equal(result.text, 'hi');
});

test('agent submit derives routeResult from AgentEffectiveCapabilityResolution eligibility', () => {
  // Verify the host-actions file uses agentResolution.eligibility, not resolveAgentLocalRoute
  const hostActionsSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-host-actions.ts');
  // Must derive routeResult from eligibility
  assert.match(
    hostActionsSource,
    /eligibility = input\.agentResolution/,
    'host actions must derive route from agentResolution eligibility',
  );
  // Must not call resolveAgentLocalRoute
  assert.doesNotMatch(
    hostActionsSource,
    /await resolveAgentLocalRoute\(/,
    'host actions must not call resolveAgentLocalRoute',
  );
});

test('agent submit fail-closes when AgentEffectiveCapabilityResolution.ready is false', () => {
  const supportedProjection = {
    capability: 'text.generate' as const,
    selectedBinding: { source: 'local' as const, connectorId: '', model: 'qwen3' },
    resolvedBinding: { capability: 'text.generate' as const, resolvedBindingRef: 'local:llama:qwen3', source: 'local' as const, provider: 'llama', model: 'qwen3', modelId: 'qwen3', connectorId: '' },
    health: { healthy: true, status: 'healthy' as const, detail: 'ready' },
    metadata: { capability: 'text.generate' as const, metadataVersion: 'v1' as const, resolvedBindingRef: 'local:llama:qwen3', metadataKind: 'text.generate' as const, metadata: { supportsThinking: false, traceModeSupport: 'none' as const, supportsImageInput: false, supportsAudioInput: false, supportsVideoInput: false, supportsArtifactRefInput: false } },
    supported: true,
    reasonCode: null,
  };

  // projection_unavailable
  const res1 = buildAgentEffectiveCapabilityResolution({
    textProjection: null,
    eligibility: { channel: 'LOCAL', sessionClass: 'AGENT_LOCAL', providerSelectable: false, reason: 'ok' },
  });
  assert.equal(res1.ready, false);
  assert.equal(res1.reason, 'projection_unavailable');

  // eligibility_denied
  const res2 = buildAgentEffectiveCapabilityResolution({
    textProjection: supportedProjection,
    eligibility: null,
  });
  assert.equal(res2.ready, false);
  assert.equal(res2.reason, 'eligibility_denied');

  // HUMAN_DIRECT passes through unchanged — Desktop must not rewrite to AGENT_LOCAL
  const res3 = buildAgentEffectiveCapabilityResolution({
    textProjection: supportedProjection,
    eligibility: { channel: 'LOCAL', sessionClass: 'HUMAN_DIRECT', providerSelectable: false, reason: 'human' },
  });
  assert.equal(res3.eligibility?.sessionClass, 'HUMAN_DIRECT');

  // ok
  const res4 = buildAgentEffectiveCapabilityResolution({
    textProjection: supportedProjection,
    eligibility: { channel: 'LOCAL', sessionClass: 'AGENT_LOCAL', providerSelectable: false, reason: 'ok' },
  });
  assert.equal(res4.ready, true);
  assert.equal(res4.reason, 'ok');
});

test('agent local mode keeps thinking unsupported and forces effective off config', () => {
  assert.deepEqual(resolveAgentChatThinkingSupport(), {
    supported: false,
    reason: 'agent_route_unsupported',
  });
  assert.deepEqual(
    resolveChatThinkingConfig('on', resolveAgentChatThinkingSupport()),
    {
      mode: 'off',
      traceMode: 'hide',
    },
  );
});

test('agent shell stays desktop-owned and uses social snapshot plus local agent store', () => {
  const adapterSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-adapter.tsx');
  const hostActionsSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-host-actions.ts');
  const presentationSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-presentation.tsx');
  const effectsSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-effects.ts');
  assert.match(adapterSource, /dataSync\.loadSocialSnapshot\(\)/);
  assert.match(adapterSource, /createAgentLocalChatConversationProvider/);
  assert.match(adapterSource, /useAgentConversationEffects/);
  assert.match(adapterSource, /useAgentConversationPresentation/);
  assert.match(hostActionsSource, /chatAgentStoreClient\.createThread/);
  assert.match(hostActionsSource, /chatAgentStoreClient\.commitTurnResult/);
  assert.match(hostActionsSource, /matchConversationTurnEvent/);
  assert.match(hostActionsSource, /createInitialAgentSubmitDriverState/);
  assert.match(hostActionsSource, /reduceAgentSubmitDriverEvent/);
  assert.match(hostActionsSource, /resolveCompletedAgentSubmitDriverCheckpoint/);
  assert.match(hostActionsSource, /resolveInterruptedAgentSubmitDriverCheckpoint/);
  assert.match(hostActionsSource, /resolveAgentSubmitDriverProjectionRefresh/);
  assert.match(hostActionsSource, /resolveAuthoritativeAgentThreadBundle/);
  assert.match(hostActionsSource, /assertAgentTurnLifecycleCompleted/);
  assert.match(hostActionsSource, /setSubmittingThreadId\(input\.activeThreadId\)/);
  assert.match(hostActionsSource, /setFooterHostState\(input\.activeThreadId,\s*null\)/);
  assert.match(hostActionsSource, /finally\s*\{\s*input\.setSubmittingThreadId\(null\);/);
  assert.match(hostActionsSource, /submitSession\.lifecycle\.projectionVersion\s*\?\s*await chatAgentStoreClient\.getThreadBundle\(input\.activeThreadId\)/);
  assert.match(hostActionsSource, /if \(submitSession\.lifecycle\.projectionVersion\) \{\s+refreshedBundle = await chatAgentStoreClient\.getThreadBundle\(input\.activeThreadId\)/);
  assert.match(hostActionsSource, /projectionRefreshPromise = chatAgentStoreClient\.getThreadBundle\(input\.activeThreadId!\)/);
  assert.match(presentationSource, /resolveAgentFooterViewState/);
  assert.match(presentationSource, /resolveAgentConversationSurfaceState/);
  assert.match(presentationSource, /resolveAgentConversationHostView/);
  assert.match(presentationSource, /resolveAgentConversationHostSnapshot/);
  assert.match(presentationSource, /resolveAgentTargetSummaries/);
  assert.match(presentationSource, /resolveAgentCanonicalMessages/);
  assert.match(presentationSource, /resolveAgentSelectedTargetId/);
  assert.match(effectsSource, /applyDriverEffects/);
  assert.match(effectsSource, /applyHostInteractionPatch/);
  assert.doesNotMatch(adapterSource, /chatAgentStoreClient\.createThread/);
  assert.doesNotMatch(adapterSource, /chatAgentStoreClient\.commitTurnResult/);
  assert.doesNotMatch(adapterSource, /matchConversationTurnEvent/);
  assert.doesNotMatch(adapterSource, /createInitialAgentSubmitDriverState/);
  assert.doesNotMatch(adapterSource, /reduceAgentSubmitDriverEvent/);
  assert.doesNotMatch(adapterSource, /resolveCompletedAgentSubmitDriverCheckpoint/);
  assert.doesNotMatch(adapterSource, /resolveInterruptedAgentSubmitDriverCheckpoint/);
  assert.doesNotMatch(adapterSource, /resolveAgentSubmitDriverProjectionRefresh/);
  assert.doesNotMatch(adapterSource, /resolveAuthoritativeAgentThreadBundle/);
  assert.doesNotMatch(adapterSource, /assertAgentTurnLifecycleCompleted/);
  assert.doesNotMatch(adapterSource, /streamState\s*&&\s*streamState\.phase === 'waiting'/);
  assert.doesNotMatch(adapterSource, /streamState\s*&&\s*\(streamState\.phase === 'waiting' \|\| streamState\.phase === 'streaming'\)/);
  assert.doesNotMatch(adapterSource, /overlayAgentAssistantVisibleState/);
  assert.doesNotMatch(adapterSource, /createInitialAgentSubmitSessionState/);
  assert.doesNotMatch(adapterSource, /reduceAgentSubmitSessionEvent/);
  assert.doesNotMatch(adapterSource, /resolveCompletedAgentSubmitSession/);
  assert.doesNotMatch(adapterSource, /resolveInterruptedAgentSubmitSession/);
  assert.doesNotMatch(adapterSource, /resolveProjectionRefreshAgentSubmitSession/);
  assert.doesNotMatch(adapterSource, /resolveCompletedAgentSubmitHostFlow/);
  assert.doesNotMatch(adapterSource, /resolveInterruptedAgentSubmitHostFlow/);
  assert.doesNotMatch(adapterSource, /resolveAgentProjectionRefreshOutcome/);
  assert.doesNotMatch(adapterSource, /resolveCompletedAgentHostInteraction/);
  assert.doesNotMatch(adapterSource, /resolveInterruptedAgentHostInteraction/);
  assert.doesNotMatch(adapterSource, /resolveProjectionRefreshAgentHostInteraction/);
  assert.doesNotMatch(adapterSource, /applyAuthoritativeBundle/);
  assert.doesNotMatch(adapterSource, /applySubmitOutcome/);
  assert.doesNotMatch(adapterSource, /if \(!refreshOutcome\.hostInteractionPatch\)/);
  assert.doesNotMatch(adapterSource, /let streamedText =/);
  assert.doesNotMatch(adapterSource, /let streamedReasoningText =/);
  assert.doesNotMatch(adapterSource, /let runtimeTraceId =/);
  assert.doesNotMatch(adapterSource, /let promptTraceId =/);
  assert.doesNotMatch(adapterSource, /let assistantVisible =/);
  assert.doesNotMatch(adapterSource, /let workingBundle =/);
  assert.doesNotMatch(adapterSource, /chatAgentStoreClient\.createMessage/);
  assert.doesNotMatch(adapterSource, /chatAgentStoreClient\.updateMessage/);
  assert.doesNotMatch(adapterSource, /relay:/);
  assert.doesNotMatch(adapterSource, /nimi-mods\/runtime\/local-chat/);
  assert.doesNotMatch(adapterSource, /RuntimeStatusSidebar/);
});
