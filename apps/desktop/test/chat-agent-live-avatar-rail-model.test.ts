import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveChatAgentLiveAvatarRailModel } from '../src/shell/renderer/features/chat/chat-agent-live-avatar-rail-model.js';

test('agent live avatar rail model falls back to desktop-local mock VRM presentation when no live backend exists', () => {
  const model = resolveChatAgentLiveAvatarRailModel({
    selectedTarget: {
      id: 'agent-1',
      source: 'agent',
      canonicalSessionId: 'thread-1',
      title: 'Companion',
      handle: '@companion',
      bio: 'friend agent',
      avatarUrl: 'https://cdn.nimi.test/companion.png',
      avatarFallback: 'C',
      previewText: null,
      updatedAt: null,
      unreadCount: 0,
      status: 'active',
      isOnline: null,
      metadata: {},
    },
    characterData: {
      name: 'Companion',
      avatarUrl: 'https://cdn.nimi.test/companion.png',
      avatarPresentationProfile: {
        backendKind: 'sprite2d',
        avatarAssetRef: 'https://cdn.nimi.test/companion.png',
      },
      interactionState: {
        phase: 'speaking',
        label: 'Speaking…',
        emotion: 'focus',
        amplitude: 0.42,
        visemeId: 'ee',
      },
    },
  });

  assert.equal(model.presentation.backendKind, 'vrm');
  assert.match(model.presentation.avatarAssetRef, /^(fallback:\/\/agent-live-rail\/|file:\/\/.*AliciaSolid\.vrm$)/);
  assert.equal(model.viewportInput.posterUrl, 'https://cdn.nimi.test/companion.png');
  assert.equal(model.snapshot.interaction.phase, 'speaking');
  assert.equal(model.snapshot.interaction.actionCue, 'Speaking…');
  assert.equal(model.snapshot.interaction.visemeId, 'ee');
});

test('agent live avatar rail model preserves runtime-backed VRM presentation when present', () => {
  const model = resolveChatAgentLiveAvatarRailModel({
    selectedTarget: {
      id: 'agent-2',
      source: 'agent',
      canonicalSessionId: 'thread-2',
      title: 'Scout',
      handle: '@scout',
      bio: null,
      avatarUrl: null,
      avatarFallback: 'S',
      previewText: null,
      updatedAt: null,
      unreadCount: 0,
      status: 'active',
      isOnline: null,
      metadata: {},
    },
    characterData: {
      name: 'Scout',
      avatarPresentationProfile: {
        backendKind: 'vrm',
        avatarAssetRef: 'https://cdn.nimi.test/scout.vrm',
        idlePreset: 'scout-idle',
        expressionProfileRef: 'desktop://profiles/scout',
      },
      interactionState: {
        phase: 'idle',
        emotion: 'calm',
      },
    },
  });

  assert.equal(model.presentation.backendKind, 'vrm');
  assert.equal(model.presentation.avatarAssetRef, 'https://cdn.nimi.test/scout.vrm');
  assert.equal(model.viewportInput.assetRef, 'https://cdn.nimi.test/scout.vrm');
  assert.equal(model.snapshot.interaction.actionCue, 'Here with you');
});
