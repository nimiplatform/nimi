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
  const presentationSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-presentation.tsx');
  const effectsSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-effects.ts');
  assert.match(adapterSource, /dataSync\.loadSocialSnapshot\(\)/);
  assert.match(adapterSource, /chatAgentStoreClient\.createThread/);
  assert.match(adapterSource, /chatAgentStoreClient\.commitTurnResult/);
  assert.match(adapterSource, /createAgentLocalChatConversationProvider/);
  assert.match(adapterSource, /matchConversationTurnEvent/);
  assert.match(adapterSource, /createInitialAgentSubmitDriverState/);
  assert.match(adapterSource, /reduceAgentSubmitDriverEvent/);
  assert.match(adapterSource, /resolveCompletedAgentSubmitDriverCheckpoint/);
  assert.match(adapterSource, /resolveInterruptedAgentSubmitDriverCheckpoint/);
  assert.match(adapterSource, /resolveAgentSubmitDriverProjectionRefresh/);
  assert.match(adapterSource, /useAgentConversationEffects/);
  assert.match(adapterSource, /useAgentConversationPresentation/);
  assert.match(adapterSource, /resolveAuthoritativeAgentThreadBundle/);
  assert.match(adapterSource, /assertAgentTurnLifecycleCompleted/);
  assert.match(adapterSource, /setSubmittingThreadId\(activeThreadId\)/);
  assert.match(adapterSource, /setFooterHostState\(activeThreadId,\s*null\)/);
  assert.match(adapterSource, /finally\s*\{\s*setSubmittingThreadId\(null\);/);
  assert.match(adapterSource, /submitSession\.lifecycle\.projectionVersion\s*\?\s*await chatAgentStoreClient\.getThreadBundle\(activeThreadId\)/);
  assert.match(adapterSource, /if \(submitSession\.lifecycle\.projectionVersion\) \{\s+refreshedBundle = await chatAgentStoreClient\.getThreadBundle\(activeThreadId\)/);
  assert.match(adapterSource, /projectionRefreshPromise = chatAgentStoreClient\.getThreadBundle\(activeThreadId\)/);
  assert.match(presentationSource, /resolveAgentFooterViewState/);
  assert.match(presentationSource, /resolveAgentConversationSurfaceState/);
  assert.match(presentationSource, /resolveAgentConversationHostView/);
  assert.match(presentationSource, /resolveAgentConversationHostSnapshot/);
  assert.match(presentationSource, /resolveAgentTargetSummaries/);
  assert.match(presentationSource, /resolveAgentCanonicalMessages/);
  assert.match(presentationSource, /resolveAgentSelectedTargetId/);
  assert.match(effectsSource, /applyDriverEffects/);
  assert.match(effectsSource, /applyHostInteractionPatch/);
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
