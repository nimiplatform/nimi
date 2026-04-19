import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveChatAgentAvatarStageRenderModel,
  resolveChatAgentAvatarStageModel,
} from '../src/shell/renderer/features/chat/chat-agent-avatar-stage-model.js';
import { createIdleChatAgentAvatarAttentionState } from '../src/shell/renderer/features/chat/chat-agent-avatar-attention-state.js';

test('agent avatar stage model prefers desktop-local bound VRM resource when present', () => {
  const model = resolveChatAgentAvatarStageModel({
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
    localResource: {
      resourceId: 'resource-1',
      kind: 'vrm',
      displayName: 'Bound Avatar',
      sourceFilename: 'bound.vrm',
      storedPath: '/tmp/bound-avatar',
      fileUrl: 'file:///tmp/bound-avatar/bound.vrm',
      posterPath: null,
      importedAtMs: 100,
      updatedAtMs: 100,
      status: 'ready',
    },
  });

  assert.equal(model.presentation.backendKind, 'vrm');
  assert.equal(model.presentation.avatarAssetRef, 'desktop-avatar://resource-1/bound.vrm');
  assert.equal(model.fallbackPresentation.backendKind, 'sprite2d');
  assert.equal(model.viewportInput.posterUrl, 'https://cdn.nimi.test/companion.png');
  assert.equal(model.snapshot.interaction.phase, 'speaking');
  assert.equal(model.snapshot.interaction.actionCue, 'Speaking…');
  assert.equal(model.snapshot.interaction.visemeId, 'ee');
  assert.equal(model.snapshot.interaction.attentionTarget, 'camera');
});

test('agent avatar stage model prefers desktop-local bound Live2D resource when present', () => {
  const model = resolveChatAgentAvatarStageModel({
    selectedTarget: {
      id: 'agent-live2d',
      source: 'agent',
      canonicalSessionId: 'thread-live2d',
      title: 'Airi',
      handle: '@airi',
      bio: 'live2d companion',
      avatarUrl: 'https://cdn.nimi.test/airi.png',
      avatarFallback: 'A',
      previewText: null,
      updatedAt: null,
      unreadCount: 0,
      status: 'active',
      isOnline: null,
      metadata: {},
    },
    characterData: {
      name: 'Airi',
      avatarUrl: 'https://cdn.nimi.test/airi.png',
      avatarPresentationProfile: {
        backendKind: 'sprite2d',
        avatarAssetRef: 'https://cdn.nimi.test/airi.png',
      },
      interactionState: {
        phase: 'idle',
        label: 'Here with you',
        emotion: 'calm',
      },
    },
    localResource: {
      resourceId: 'resource-live2d',
      kind: 'live2d',
      displayName: 'Airi Live2D',
      sourceFilename: 'airi.model3.json',
      storedPath: '/tmp/airi-live2d',
      fileUrl: 'file:///tmp/airi-live2d/airi.model3.json',
      posterPath: null,
      importedAtMs: 100,
      updatedAtMs: 100,
      status: 'ready',
    },
  });

  assert.equal(model.presentation.backendKind, 'live2d');
  assert.equal(model.presentation.avatarAssetRef, 'desktop-avatar://resource-live2d/airi.model3.json');
  assert.equal(model.fallbackPresentation.backendKind, 'sprite2d');
  assert.equal(model.fallbackSnapshot.presentation.backendKind, 'sprite2d');
  assert.equal(model.viewportInput.assetRef, 'desktop-avatar://resource-live2d/airi.model3.json');
});

test('agent avatar stage model preserves runtime-backed VRM presentation when present', () => {
  const model = resolveChatAgentAvatarStageModel({
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
  assert.equal(model.fallbackPresentation.backendKind, 'vrm');
  assert.equal(model.snapshot.interaction.actionCue, 'Here with you');
});

test('agent avatar stage model carries idle status cue label and emotion into the snapshot', () => {
  const model = resolveChatAgentAvatarStageModel({
    selectedTarget: {
      id: 'agent-status-cue',
      source: 'agent',
      canonicalSessionId: 'thread-status-cue',
      title: 'Companion',
      handle: '@companion',
      bio: null,
      avatarUrl: null,
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
      interactionState: {
        phase: 'idle',
        label: 'Feeling playful',
        emotion: 'playful',
        amplitude: 0.58,
      },
    },
  });

  assert.equal(model.snapshot.interaction.phase, 'idle');
  assert.equal(model.snapshot.interaction.emotion, 'playful');
  assert.equal(model.snapshot.interaction.actionCue, 'Feeling playful');
  assert.equal(model.snapshot.interaction.amplitude, 0.58);
});

test('agent avatar stage model carries runtime committed steady-state label into the snapshot', () => {
  const model = resolveChatAgentAvatarStageModel({
    selectedTarget: {
      id: 'agent-runtime-projection',
      source: 'agent',
      canonicalSessionId: 'thread-runtime-projection',
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
      interactionState: {
        phase: 'idle',
        label: 'Out exploring',
        amplitude: 0.12,
      },
    },
  });

  assert.equal(model.snapshot.interaction.phase, 'idle');
  assert.equal(model.snapshot.interaction.actionCue, 'Out exploring');
  assert.equal(model.snapshot.interaction.emotion, 'calm');
  assert.equal(model.snapshot.interaction.amplitude, 0.12);
});

test('agent avatar stage model preserves voice phase while admitting attention locally', () => {
  const model = resolveChatAgentAvatarStageModel({
    selectedTarget: {
      id: 'agent-4',
      source: 'agent',
      canonicalSessionId: 'thread-4',
      title: 'Guide',
      handle: '@guide',
      bio: null,
      avatarUrl: 'https://cdn.nimi.test/guide.png',
      avatarFallback: 'G',
      previewText: null,
      updatedAt: null,
      unreadCount: 0,
      status: 'active',
      isOnline: null,
      metadata: {},
    },
    characterData: {
      name: 'Guide',
      interactionState: {
        phase: 'speaking',
        label: 'Speaking…',
        emotion: 'focus',
        amplitude: 0.7,
        visemeId: 'ee',
      },
    },
    attentionState: {
      active: true,
      presence: 1,
      normalizedX: 0.55,
      normalizedY: -0.35,
      attentionBoost: 'engaged',
    },
  });

  assert.equal(model.snapshot.interaction.phase, 'speaking');
  assert.equal(model.snapshot.interaction.attentionTarget, 'pointer');
  assert.equal(model.attentionState.attentionBoost, 'engaged');
});

test('agent avatar stage model applies chat avatar smoke override to bound vrm interaction state', () => {
  const runtimeWindow = globalThis as typeof globalThis & {
    __NIMI_CHAT_AVATAR_SMOKE_OVERRIDE__?: Record<string, unknown> | null;
  };
  runtimeWindow.__NIMI_CHAT_AVATAR_SMOKE_OVERRIDE__ = {
    phase: 'speaking',
    label: 'Speaking…',
    emotion: 'focus',
    amplitude: 0.82,
    visemeId: 'aa',
  };

  try {
    const model = resolveChatAgentAvatarStageModel({
      selectedTarget: {
        id: 'agent-vrm-override',
        source: 'agent',
        canonicalSessionId: 'thread-vrm-override',
        title: 'Companion',
        handle: '@companion',
        bio: null,
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
        interactionState: {
          phase: 'idle',
          label: 'Here with you',
          emotion: 'calm',
          amplitude: 0.08,
        },
      },
      localResource: {
        resourceId: 'resource-vrm-override',
        kind: 'vrm',
        displayName: 'Bound Avatar',
        sourceFilename: 'bound.vrm',
        storedPath: '/tmp/bound-avatar',
        fileUrl: 'file:///tmp/bound-avatar/bound.vrm',
        posterPath: null,
        importedAtMs: 100,
        updatedAtMs: 100,
        status: 'ready',
      },
    });

    assert.equal(model.presentation.backendKind, 'vrm');
    assert.equal(model.snapshot.interaction.phase, 'speaking');
    assert.equal(model.snapshot.interaction.actionCue, 'Speaking…');
    assert.equal(model.snapshot.interaction.emotion, 'focus');
    assert.equal(model.snapshot.interaction.amplitude, 0.82);
    assert.equal(model.snapshot.interaction.visemeId, 'aa');
  } finally {
    runtimeWindow.__NIMI_CHAT_AVATAR_SMOKE_OVERRIDE__ = null;
  }
});

test('agent avatar stage model falls back to idle attention state when none is provided', () => {
  const model = resolveChatAgentAvatarStageModel({
    selectedTarget: {
      id: 'agent-5',
      source: 'agent',
      canonicalSessionId: 'thread-5',
      title: 'Poster',
      handle: '@poster',
      bio: null,
      avatarUrl: null,
      avatarFallback: 'P',
      previewText: null,
      updatedAt: null,
      unreadCount: 0,
      status: 'active',
      isOnline: null,
      metadata: {},
    },
    characterData: {
      name: 'Poster',
      interactionState: {
        phase: 'idle',
      },
    },
  });

  assert.deepEqual(model.attentionState, createIdleChatAgentAvatarAttentionState());
  assert.equal(model.snapshot.interaction.attentionTarget, 'camera');
});

test('agent avatar stage model falls back to sprite presentation when no local binding or runtime live backend exists', () => {
  const model = resolveChatAgentAvatarStageModel({
    selectedTarget: {
      id: 'agent-3',
      source: 'agent',
      canonicalSessionId: 'thread-3',
      title: 'Poster',
      handle: '@poster',
      bio: null,
      avatarUrl: 'https://cdn.nimi.test/poster.png',
      avatarFallback: 'P',
      previewText: null,
      updatedAt: null,
      unreadCount: 0,
      status: 'active',
      isOnline: null,
      metadata: {},
    },
    characterData: {
      name: 'Poster',
      avatarUrl: 'https://cdn.nimi.test/poster.png',
      interactionState: {
        phase: 'idle',
      },
    },
  });

  assert.equal(model.presentation.backendKind, 'sprite2d');
  assert.equal(model.presentation.avatarAssetRef, 'https://cdn.nimi.test/poster.png');
  assert.equal(model.viewportInput.posterUrl, 'https://cdn.nimi.test/poster.png');
});

test('agent avatar stage render model keeps active live2d snapshot until the viewport fails closed', () => {
  const stageModel = resolveChatAgentAvatarStageModel({
    selectedTarget: {
      id: 'agent-live2d-stage',
      source: 'agent',
      canonicalSessionId: 'thread-live2d-stage',
      title: 'Airi',
      handle: '@airi',
      bio: null,
      avatarUrl: 'https://cdn.nimi.test/airi.png',
      avatarFallback: 'A',
      previewText: null,
      updatedAt: null,
      unreadCount: 0,
      status: 'active',
      isOnline: null,
      metadata: {},
    },
    characterData: {
      name: 'Airi',
      avatarUrl: 'https://cdn.nimi.test/airi.png',
      interactionState: {
        phase: 'speaking',
        label: 'Speaking…',
      },
    },
    localResource: {
      resourceId: 'resource-live2d',
      kind: 'live2d',
      displayName: 'Airi Live2D',
      sourceFilename: 'airi.model3.json',
      storedPath: '/tmp/airi-live2d',
      fileUrl: 'file:///tmp/airi-live2d/airi.model3.json',
      posterPath: null,
      importedAtMs: 100,
      updatedAtMs: 100,
      status: 'ready',
    },
  });

  const activeStage = resolveChatAgentAvatarStageRenderModel({
    stageModel,
    loadStatus: {
      live2d: 'loading',
      vrm: 'idle',
    },
  });
  const fallbackStage = resolveChatAgentAvatarStageRenderModel({
    stageModel,
    loadStatus: {
      live2d: 'error',
      vrm: 'idle',
    },
  });

  assert.equal(activeStage.rendererFallbackApplied, false);
  assert.equal(activeStage.snapshot.presentation.backendKind, 'live2d');
  assert.equal(activeStage.viewportInput.assetRef, 'desktop-avatar://resource-live2d/airi.model3.json');
  assert.equal(fallbackStage.rendererFallbackApplied, true);
  assert.equal(fallbackStage.snapshot.presentation.backendKind, 'sprite2d');
  assert.equal(fallbackStage.viewportInput.assetRef, stageModel.fallbackSnapshot.presentation.avatarAssetRef);
});

test('agent avatar stage render model does not rewrite vrm stage selection on load errors', () => {
  const stageModel = resolveChatAgentAvatarStageModel({
    selectedTarget: {
      id: 'agent-vrm-stage',
      source: 'agent',
      canonicalSessionId: 'thread-vrm-stage',
      title: 'Companion',
      handle: '@companion',
      bio: null,
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
      interactionState: {
        phase: 'speaking',
        label: 'Speaking…',
      },
    },
    localResource: {
      resourceId: 'resource-vrm',
      kind: 'vrm',
      displayName: 'Bound Avatar',
      sourceFilename: 'bound.vrm',
      storedPath: '/tmp/bound-avatar',
      fileUrl: 'file:///tmp/bound-avatar/bound.vrm',
      posterPath: null,
      importedAtMs: 100,
      updatedAtMs: 100,
      status: 'ready',
    },
  });

  const stage = resolveChatAgentAvatarStageRenderModel({
    stageModel,
    loadStatus: {
      live2d: 'idle',
      vrm: 'error',
    },
  });

  assert.equal(stage.rendererFallbackApplied, false);
  assert.equal(stage.snapshot.presentation.backendKind, 'vrm');
  assert.equal(stage.viewportInput.assetRef, 'desktop-avatar://resource-vrm/bound.vrm');
});
