import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveAgentCanonicalMessages,
  resolveAgentSelectedTargetId,
  resolveAgentTargetSummaries,
} from '../src/shell/renderer/features/chat/chat-agent-shell-view-model.js';
import {
  buildAgentThreadMetadataUpdate,
  mergeAgentTargetWithPresentationProfile,
} from '../src/shell/renderer/features/chat/chat-agent-thread-model.js';
import type {
  AgentLocalTargetSnapshot,
  AgentLocalThreadSummary,
} from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import { resolveAgentChatBehavior as resolveAgentChatBehaviorFromResolver } from '../src/shell/renderer/features/chat/chat-agent-behavior-resolver.js';

function sampleTargets(): AgentLocalTargetSnapshot[] {
  return [{
    agentId: 'agent-1',
    displayName: 'Companion',
    handle: 'companion',
    avatarUrl: null,
    worldId: 'world-1',
    worldName: 'World One',
    bio: 'friend agent',
    ownershipType: 'MASTER_OWNED',
  }, {
    agentId: 'agent-2',
    displayName: 'Scout',
    handle: 'scout',
    avatarUrl: 'https://example.com/scout.png',
    worldId: null,
    worldName: null,
    bio: null,
    ownershipType: null,
  }];
}

function sampleThreads(): AgentLocalThreadSummary[] {
  return [{
    id: 'thread-agent-1',
    agentId: 'agent-1',
    title: 'Companion',
    updatedAtMs: 100,
    lastMessageAtMs: 90,
    archivedAtMs: null,
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
    id: 'agent-1',
    canonicalSessionId: 'thread-agent-1',
    title: 'Companion',
    handle: '@companion',
    avatarUrl: null,
  }, {
    id: 'agent-2',
    canonicalSessionId: 'agent-2',
    title: 'Scout',
    handle: '@scout',
    avatarUrl: 'https://example.com/scout.png',
  }]);
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
          backendKind: 'sprite2d',
          avatarAssetRef: 'https://cdn.nimi.test/runtime/companion.png',
          expressionProfileRef: null,
          idlePreset: 'companion.idle.soft',
          interactionPolicyRef: null,
          defaultVoiceReference: 'voice://agent-1/default',
        },
      },
    }],
  });

  assert.equal(summaries[0]?.avatarUrl, 'https://cdn.nimi.test/runtime/companion.png');
  assert.deepEqual((summaries[0]?.metadata as Record<string, unknown>)?.presentationProfile, {
    backendKind: 'sprite2d',
    avatarAssetRef: 'https://cdn.nimi.test/runtime/companion.png',
    expressionProfileRef: null,
    idlePreset: 'companion.idle.soft',
    interactionPolicyRef: null,
    defaultVoiceReference: 'voice://agent-1/default',
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
    activeTargetId: 'agent-1',
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
  assert.equal(messages[1]?.sessionId, 'thread-agent-1');
  assert.equal(messages[1]?.targetId, 'agent-1');
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
    activeTargetId: 'agent-1',
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
    activeTargetId: 'agent-1',
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

test('agent shell view model resolves selected target id fail-close', () => {
  assert.equal(resolveAgentSelectedTargetId({
    selectionAgentId: 'agent-1',
    activeTargetId: 'agent-2',
  }), 'agent-1');
  assert.equal(resolveAgentSelectedTargetId({
    selectionAgentId: null,
    activeTargetId: 'agent-2',
  }), 'agent-2');
  assert.equal(resolveAgentSelectedTargetId({
    selectionAgentId: null,
    activeTargetId: null,
  }), null);
});

test('agent shell view model merges runtime presentation profile onto desktop target snapshots', () => {
  const merged = mergeAgentTargetWithPresentationProfile(sampleTargets()[0]!, {
    backendKind: 'sprite2d',
    avatarAssetRef: 'https://cdn.nimi.test/runtime/companion.png',
    expressionProfileRef: null,
    idlePreset: 'companion.idle.soft',
    interactionPolicyRef: null,
    defaultVoiceReference: 'voice://agent-1/default',
  });

  assert.equal(merged?.avatarUrl, 'https://cdn.nimi.test/runtime/companion.png');
  assert.deepEqual(merged?.presentationProfile, {
    backendKind: 'sprite2d',
    avatarAssetRef: 'https://cdn.nimi.test/runtime/companion.png',
    expressionProfileRef: null,
    idlePreset: 'companion.idle.soft',
    interactionPolicyRef: null,
    defaultVoiceReference: 'voice://agent-1/default',
  });
});

test('agent shell view model emits thread metadata update when authoritative target snapshot changes', () => {
  const thread = sampleThreads()[0]!;
  const mergedTarget = mergeAgentTargetWithPresentationProfile(thread.targetSnapshot, {
    backendKind: 'sprite2d',
    avatarAssetRef: 'https://cdn.nimi.test/runtime/companion.png',
    expressionProfileRef: null,
    idlePreset: 'companion.idle.soft',
    interactionPolicyRef: null,
    defaultVoiceReference: 'voice://agent-1/default',
  });
  const update = buildAgentThreadMetadataUpdate({
    thread,
    target: mergedTarget,
  });

  assert.deepEqual(update, {
    id: 'thread-agent-1',
    title: 'Companion',
    updatedAtMs: 100,
    lastMessageAtMs: 90,
    archivedAtMs: null,
    targetSnapshot: mergedTarget,
  });
  assert.equal(buildAgentThreadMetadataUpdate({
    thread: {
      ...thread,
      targetSnapshot: mergedTarget!,
    },
    target: mergedTarget,
  }), null);
});

test('agent behavior resolver produces a canonical resolved behavior object from feature-local settings', () => {
  const resolved = resolveAgentChatBehaviorFromResolver({
    userText: '我今天有点难过，想你了',
    settings: {
      thinkingPreference: 'on',
      maxOutputTokensOverride: null,
    },
  });

  assert.equal(resolved.settings.thinkingPreference, 'on');
  assert.equal(resolved.resolvedTurnMode, 'intimate');
  assert.equal(resolved.resolvedExperiencePolicy.autonomyPolicy, 'guarded');
  assert.equal(resolved.resolvedExperiencePolicy.contentBoundary, 'default');
});

test('agent behavior resolver keeps explicit-media turns single-message without user toggles', () => {
  const resolved = resolveAgentChatBehaviorFromResolver({
    userText: '发张图给我看看',
    settings: {
      thinkingPreference: 'off',
      maxOutputTokensOverride: null,
    },
  });

  assert.equal(resolved.resolvedTurnMode, 'explicit-media');
  assert.equal(resolved.resolvedExperiencePolicy.contentBoundary, 'explicit-media-request');
  assert.equal(resolved.resolvedExperiencePolicy.autonomyPolicy, 'guarded');
});
