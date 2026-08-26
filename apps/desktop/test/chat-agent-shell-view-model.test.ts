import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveAgentCharacterProfilePreviewTarget,
  resolveAgentCanonicalMessages,
  resolveAgentSelectedTargetId,
  resolveAgentTargetSummaries,
} from '../src/shell/renderer/features/chat/chat-agent-shell-view-model.js';
import {
  mergeAgentTargetWithPresentationProfile,
  overlayAgentTargetWithLiveProfileContent,
} from '../src/shell/renderer/features/chat/chat-agent-thread-model.js';
import type {
  AgentLocalTargetSnapshot,
  AgentLocalThreadSummary,
} from '../src/shell/renderer/bridge/runtime-bridge/types.js';

const sourceRef = {
  kind: 'personaCharacter' as const,
  id: 'persona-1',
  worldId: 'world-1',
  ownerAccountId: 'user-1',
  sourceHash: 'a'.repeat(64),
};

function sampleTargets(): AgentLocalTargetSnapshot[] {
  return [{
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    conversationAnchorId: 'anchor-agent-1',
    sourceRef,
    displayName: 'Companion',
    handle: 'companion',
    avatarUrl: null,
    worldId: 'world-1',
    worldName: 'World One',
    bio: 'friend agent',
    ownershipType: 'MASTER_OWNED',
    greeting: null,
    builtinDocsContext: null,
  }, {
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-2',
    localAgentRef: 'local-agent:user-1:agent-2',
    agentHandle: 'agent_ref_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    conversationAnchorId: 'anchor-agent-2',
    displayName: 'Scout',
    handle: 'scout',
    avatarUrl: 'https://example.com/scout.png',
    worldId: null,
    worldName: null,
    bio: null,
    ownershipType: null,
    greeting: null,
    builtinDocsContext: null,
  }];
}

function sampleThreads(): AgentLocalThreadSummary[] {
  return [{
    id: 'thread-agent-1',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    title: 'Companion',
    updatedAtMs: 100,
    lastMessageAtMs: 90,
    targetSnapshot: sampleTargets()[0]!,
  }];
}

test('agent shell view model resolves target summaries from agent targets and thread ownership', () => {
  const summaries = resolveAgentTargetSummaries({
    targets: sampleTargets(),
    threads: sampleThreads(),
  });

  assert.deepEqual(summaries.map((summary) => ({
    id: summary.id,
    canonicalSessionId: summary.canonicalSessionId,
    title: summary.title,
    handle: summary.handle,
    avatarUrl: summary.avatarUrl,
  })), [{
    id: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    canonicalSessionId: 'anchor-agent-1',
    title: 'Companion',
    handle: '@companion',
    avatarUrl: null,
  }, {
    id: 'agent_ref_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    canonicalSessionId: 'anchor-agent-2',
    title: 'Scout',
    handle: '@scout',
    avatarUrl: 'https://example.com/scout.png',
  }]);
  assert.deepEqual(summaries[0]?.metadata?.sourceRef, sourceRef);
});

test('agent composer profile preview requires saved Character sourceRef and never uses localAgentRef as source id', () => {
  assert.deepEqual(resolveAgentCharacterProfilePreviewTarget(sampleTargets()[0]), {
    kind: 'character',
    sourceRef,
    handle: 'companion',
    worldName: 'World One',
  });
  assert.equal(resolveAgentCharacterProfilePreviewTarget(sampleTargets()[1]), null);
});

test('agent shell view model prefers persisted thread snapshot avatar for target summaries', () => {
  const summaries = resolveAgentTargetSummaries({
    targets: sampleTargets(),
    threads: [{
      ...sampleThreads()[0]!,
      targetSnapshot: {
        ...sampleThreads()[0]!.targetSnapshot,
        avatarUrl: 'https://cdn.nimi.test/runtime/companion.png',
        presentationProfile: {
          backendKind: 'live2d',
          avatarAssetRef: 'asset://avatar/live2d/companion.model3.json',
          expressionProfileRef: null,
          idlePreset: 'companion.idle.soft',
          interactionPolicyRef: null,
          defaultVoiceReference: 'voice://agent-1/default',
          avatarAutoplay: true,
          backgroundAssetRef: 'agent-center-background:agent-1/main',
        },
      },
    }],
  });

  assert.equal(summaries[0]?.avatarUrl, 'https://cdn.nimi.test/runtime/companion.png');
  assert.deepEqual((summaries[0]?.metadata as Record<string, unknown>)?.presentationProfile, {
    backendKind: 'live2d',
    avatarAssetRef: 'asset://avatar/live2d/companion.model3.json',
    expressionProfileRef: null,
    idlePreset: 'companion.idle.soft',
    interactionPolicyRef: null,
    defaultVoiceReference: 'voice://agent-1/default',
    avatarAutoplay: true,
    backgroundAssetRef: 'agent-center-background:agent-1/main',
  });
});

test('agent shell view model resolves canonical messages with user/agent sender metadata', () => {
  const messages = resolveAgentCanonicalMessages({
    messages: [{
      id: 'user-1',
      threadId: 'thread-agent-1',
      role: 'user',
      text: 'hello',
      createdAt: '2026-04-05T00:00:00.000Z',
      updatedAt: '2026-04-05T00:00:00.000Z',
      status: 'complete',
      error: null,
      metadata: {},
    }, {
      id: 'assistant-1',
      threadId: 'thread-agent-1',
      role: 'assistant',
      text: 'hi there',
      createdAt: '2026-04-05T00:00:01.000Z',
      updatedAt: '2026-04-05T00:00:02.000Z',
      status: 'complete',
      error: null,
      metadata: {
        reasoningText: 'thinking',
        debugType: 'agent-text-turn',
        followUpTurn: true,
        followUpInstruction: '如果对方还没回复，就轻轻追问一句。',
        followUpDelayMs: 400,
      },
    }],
    activeThreadId: 'thread-agent-1',
    activeConversationAnchorId: 'anchor-agent-1',
    activeTargetId: 'local-agent:user-1:agent-1',
    character: {
      name: 'Companion',
      avatarUrl: null,
      handle: '@companion',
    },
  });

  assert.equal(messages[0]?.senderName, 'You');
  assert.equal(messages[0]?.senderKind, 'human');
  assert.equal(messages[1]?.senderName, 'Companion');
  assert.equal(messages[1]?.senderKind, 'agent');
  assert.equal(messages[1]?.sessionId, 'anchor-agent-1');
  assert.equal(messages[1]?.targetId, 'local-agent:user-1:agent-1');
  assert.equal((messages[1]?.metadata as Record<string, unknown>)?.followUpTurn, true);
  assert.equal((messages[1]?.metadata as Record<string, unknown>)?.followUpInstruction, '如果对方还没回复，就轻轻追问一句。');
  assert.equal((messages[1]?.metadata as Record<string, unknown>)?.followUpDelayMs, 400);
});

test('agent shell view model maps image messages to canonical image kinds with media metadata', () => {
  const messages = resolveAgentCanonicalMessages({
    messages: [{
      id: 'assistant-image-1',
      threadId: 'thread-agent-1',
      role: 'assistant',
      text: '一张客栈插画',
      createdAt: '2026-04-05T00:00:03.000Z',
      updatedAt: '2026-04-05T00:00:04.000Z',
      status: 'complete',
      error: null,
      metadata: {
        kind: 'image',
        mediaUrl: 'https://cdn.nimi.test/inn-scene.png',
        mediaMimeType: 'image/png',
        artifactId: 'artifact-1',
      },
    }, {
      id: 'assistant-image-pending-1',
      threadId: 'thread-agent-1',
      role: 'assistant',
      text: 'Generating image...',
      createdAt: '2026-04-05T00:00:05.000Z',
      updatedAt: '2026-04-05T00:00:05.000Z',
      status: 'pending',
      error: null,
      metadata: {
        kind: 'image',
        mediaUrl: null,
      },
    }],
    activeThreadId: 'thread-agent-1',
    activeConversationAnchorId: 'anchor-agent-1',
    activeTargetId: 'local-agent:user-1:agent-1',
    character: {
      name: 'Companion',
      avatarUrl: null,
      handle: '@companion',
    },
  });

  assert.equal(messages[0]?.kind, 'image');
  assert.equal((messages[0]?.metadata as Record<string, unknown>)?.mediaUrl, 'https://cdn.nimi.test/inn-scene.png');
  assert.equal(messages[1]?.kind, 'image-pending');
});

test('agent shell view model maps voice messages to canonical voice kinds and preserves transcript metadata', () => {
  const messages = resolveAgentCanonicalMessages({
    messages: [{
      id: 'assistant-voice-1',
      threadId: 'thread-agent-1',
      role: 'assistant',
      text: '',
      createdAt: '2026-04-05T00:00:06.000Z',
      updatedAt: '2026-04-05T00:00:06.000Z',
      status: 'complete',
      error: null,
      metadata: {
        kind: 'voice',
        voiceUrl: 'file:///tmp/agent-voice.mp3',
        voiceTranscript: '你好呀，我在这里。',
        playbackCueEnvelope: {
          version: 'v1',
          source: 'provider',
          cues: [{
            offsetMs: 0,
            durationMs: 120,
            amplitude: 0.42,
            visemeId: 'aa',
          }],
        },
      },
    }],
    activeThreadId: 'thread-agent-1',
    activeConversationAnchorId: 'anchor-agent-1',
    activeTargetId: 'local-agent:user-1:agent-1',
    character: {
      name: 'Companion',
      avatarUrl: null,
      handle: '@companion',
    },
  });

  assert.equal(messages[0]?.kind, 'voice');
  assert.equal((messages[0]?.metadata as Record<string, unknown>)?.voiceUrl, 'file:///tmp/agent-voice.mp3');
  assert.equal((messages[0]?.metadata as Record<string, unknown>)?.voiceTranscript, '你好呀，我在这里。');
  assert.deepEqual((messages[0]?.metadata as Record<string, unknown>)?.playbackCueEnvelope, {
    version: 'v1',
    source: 'provider',
    cues: [{
      offsetMs: 0,
      durationMs: 120,
      amplitude: 0.42,
      visemeId: 'aa',
    }],
  });
});

test('agent shell view model projects messages into the active Runtime anchor session', () => {
  const messages = resolveAgentCanonicalMessages({
    messages: [{
      id: 'assistant-anchor-a',
      threadId: 'thread-agent-1a',
      role: 'assistant',
      text: 'anchor a reply',
      createdAt: '2026-04-05T00:01:00.000Z',
      updatedAt: '2026-04-05T00:01:00.000Z',
      status: 'complete',
      error: null,
      metadata: {
        conversationAnchorId: 'anchor-a',
      },
    }, {
      id: 'assistant-anchor-b',
      threadId: 'thread-agent-1b',
      role: 'assistant',
      text: 'anchor b reply',
      createdAt: '2026-04-05T00:02:00.000Z',
      updatedAt: '2026-04-05T00:02:00.000Z',
      status: 'complete',
      error: null,
      metadata: {
        conversationAnchorId: 'anchor-b',
      },
    }],
    activeThreadId: 'thread-agent-1a',
    activeConversationAnchorId: 'anchor-active',
    activeTargetId: 'local-agent:user-1:agent-1',
    character: {
      name: 'Companion',
      avatarUrl: null,
      handle: '@companion',
    },
  });

  assert.equal(messages[0]?.targetId, 'local-agent:user-1:agent-1');
  assert.equal(messages[1]?.targetId, 'local-agent:user-1:agent-1');
  assert.equal(messages[0]?.sessionId, 'anchor-active');
  assert.equal(messages[1]?.sessionId, 'anchor-active');
});

test('agent shell view model resolves selected target id fail-close', () => {
  assert.equal(resolveAgentSelectedTargetId({
    selectionAgentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    activeTargetId: 'local-agent:user-1:agent-2',
  }), 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  assert.equal(resolveAgentSelectedTargetId({
    selectionAgentHandle: null,
    activeTargetId: 'local-agent:user-1:agent-2',
  }), 'local-agent:user-1:agent-2');
  assert.equal(resolveAgentSelectedTargetId({
    selectionAgentHandle: null,
    activeTargetId: null,
  }), null);
});

test('agent shell view model merges runtime presentation profile onto desktop target snapshots', () => {
  const merged = mergeAgentTargetWithPresentationProfile(sampleTargets()[0]!, {
    backendKind: 'live2d',
    avatarAssetRef: 'asset://avatar/live2d/companion.model3.json',
    expressionProfileRef: null,
    idlePreset: 'companion.idle.soft',
    interactionPolicyRef: null,
    defaultVoiceReference: 'voice://agent-1/default',
    avatarAutoplay: true,
    backgroundAssetRef: null,
  });

  assert.equal(merged?.avatarUrl, null);
  assert.deepEqual(merged?.presentationProfile, {
    backendKind: 'live2d',
    avatarAssetRef: 'asset://avatar/live2d/companion.model3.json',
    expressionProfileRef: null,
    idlePreset: 'companion.idle.soft',
    interactionPolicyRef: null,
    defaultVoiceReference: 'voice://agent-1/default',
    avatarAutoplay: true,
    backgroundAssetRef: null,
  });
});

test('live Character avatar refreshes an existing thread snapshot without resetting thread data', () => {
  const threadTarget = {
    ...sampleTargets()[0]!,
    agentHandle: 'agent_ref_previous_generation',
  };
  const liveTarget = {
    ...threadTarget,
    agentHandle: 'agent_ref_current_generation',
    avatarUrl: 'https://cdn.nimi.test/character/companion.png',
  };

  const merged = overlayAgentTargetWithLiveProfileContent(threadTarget, liveTarget);

  assert.equal(merged?.avatarUrl, liveTarget.avatarUrl);
  assert.equal(merged?.agentHandle, liveTarget.agentHandle);
  assert.equal(merged?.localAgentRef, threadTarget.localAgentRef);
  assert.equal(merged?.runtimeSourceRef, threadTarget.runtimeSourceRef);
});
