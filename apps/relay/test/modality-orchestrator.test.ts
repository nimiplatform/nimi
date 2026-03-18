// Unit tests for modality-orchestrator.ts — beat modality assignment (RL-PIPE-006)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { orchestrateBeatModalities } from '../src/main/chat-pipeline/modality-orchestrator.js';
import type {
  DerivedInteractionProfile,
  InteractionBeat,
  InteractionSnapshot,
} from '../src/main/chat-pipeline/types.js';
import type { ResolvedExperiencePolicy } from '../src/main/chat-pipeline/resolved-experience-policy.js';

function createProfile(overrides: Partial<DerivedInteractionProfile> = {}): DerivedInteractionProfile {
  return {
    expression: {
      responseLength: 'medium', formality: 'casual', sentiment: 'positive',
      pacingBias: 'balanced', firstBeatStyle: 'gentle', infoAnswerStyle: 'balanced',
      emojiUsage: 'occasional',
      ...(overrides.expression || {}),
    },
    relationship: {
      defaultDistance: 'friendly', warmth: 'warm', flirtAffinity: 'light',
      proactiveStyle: 'gentle', intimacyGuard: 'balanced',
      ...(overrides.relationship || {}),
    },
    voice: {
      voiceId: 'alloy', language: 'zh-CN', genderGuard: 'female',
      speedRange: 'balanced', pitchRange: 'mid', emotionEnabled: true,
      voiceAffinity: 'high',
      ...(overrides.voice || {}),
    },
    visual: {
      artStyle: 'anime', fashionStyle: 'casual', personaCue: 'gentle',
      nsfwLevel: 'safe', imageAffinity: 'medium', videoAffinity: 'low',
      ...(overrides.visual || {}),
    },
    modalityTraits: {
      textBias: 'medium', voiceBias: 'high', imageBias: 'medium',
      videoBias: 'low', latencyTolerance: 'medium',
      ...(overrides.modalityTraits || {}),
    },
    signals: overrides.signals || [],
  };
}

function createBeat(overrides: Partial<InteractionBeat> = {}): InteractionBeat {
  return {
    beatId: 'beat-1',
    turnId: 'turn-1',
    beatIndex: 0,
    beatCount: 1,
    intent: 'answer',
    relationMove: 'friendly',
    sceneMove: 'daily',
    modality: 'text',
    text: 'Hello!',
    pauseMs: 0,
    cancellationScope: 'turn',
    ...overrides,
  };
}

function createPolicy(overrides: Partial<ResolvedExperiencePolicy> = {}): ResolvedExperiencePolicy {
  return {
    deliveryPolicy: { style: 'natural', allowMultiReply: true, ...(overrides.deliveryPolicy || {}) },
    voicePolicy: {
      enabled: true, autonomy: 'natural', conversationMode: 'off',
      autoPlayReplies: false, selectedVoiceId: 'alloy', selectionMode: 'auto',
      ...(overrides.voicePolicy || {}),
    },
    mediaPolicy: {
      autonomy: 'natural', visualComfortLevel: 'natural-visuals', routeSource: 'cloud',
      nsfwPolicy: 'local-only', allowVisualAuto: true, allowAutoVisualHighRisk: false,
      ...(overrides.mediaPolicy || {}),
    },
    contentBoundary: {
      relationshipBoundaryPreset: 'balanced', visualComfortLevel: 'natural-visuals',
      routeSource: 'cloud', relationshipState: 'friendly',
      ...(overrides.contentBoundary || {}),
    },
    inspectFlags: { diagnosticsVisible: true, runtimeInspectorVisible: false, ...(overrides.inspectFlags || {}) },
  };
}

// ─── voiceConversation=on forces voice ────────────────────────────────────

describe('orchestrateBeatModalities — voice conversation on', () => {
  it('forces voice when conversationMode=on', () => {
    const beats = orchestrateBeatModalities({
      beats: [createBeat()],
      turnMode: 'emotional',
      interactionProfile: createProfile(),
      snapshot: null,
      policy: createPolicy({ voicePolicy: { enabled: true, autonomy: 'natural', conversationMode: 'on', autoPlayReplies: true, selectedVoiceId: 'alloy', selectionMode: 'auto' } }),
    });
    assert.equal(beats[0].modality, 'voice');
    assert.equal(beats[0].autoPlayVoice, true);
  });
});

// ─── explicit-media sets image/video modality ─────────────────────────────

describe('orchestrateBeatModalities — explicit media', () => {
  it('sets image modality for explicit-media with image assetRequest', () => {
    const beats = orchestrateBeatModalities({
      beats: [createBeat({
        assetRequest: { kind: 'image', prompt: 'a selfie', confidence: 0.9, nsfwIntent: 'none' },
      })],
      turnMode: 'explicit-media',
      interactionProfile: createProfile(),
      snapshot: null,
      policy: createPolicy(),
    });
    assert.equal(beats[0].modality, 'image');
    assert.equal(beats[0].intent, 'media');
  });

  it('sets video modality for explicit-media with video assetRequest', () => {
    const beats = orchestrateBeatModalities({
      beats: [createBeat({
        assetRequest: { kind: 'video', prompt: 'a short clip', confidence: 0.8, nsfwIntent: 'none' },
      })],
      turnMode: 'explicit-media',
      interactionProfile: createProfile(),
      snapshot: null,
      policy: createPolicy(),
    });
    assert.equal(beats[0].modality, 'video');
  });
});

// ─── voiceAutonomy gating ─────────────────────────────────────────────────

describe('orchestrateBeatModalities — voice autonomy gating', () => {
  it('voice off → text output', () => {
    const beats = orchestrateBeatModalities({
      beats: [createBeat({ intent: 'comfort', text: 'ok' })],
      turnMode: 'emotional',
      interactionProfile: createProfile(),
      snapshot: null,
      policy: createPolicy({ voicePolicy: { enabled: true, autonomy: 'off', conversationMode: 'off', autoPlayReplies: false, selectedVoiceId: 'alloy', selectionMode: 'auto' } }),
    });
    assert.equal(beats[0].modality, 'text');
  });

  it('voice disabled → text output', () => {
    const beats = orchestrateBeatModalities({
      beats: [createBeat({ intent: 'comfort', text: 'ok' })],
      turnMode: 'emotional',
      interactionProfile: createProfile(),
      snapshot: null,
      policy: createPolicy({ voicePolicy: { enabled: false, autonomy: 'off', conversationMode: 'off', autoPlayReplies: false, selectedVoiceId: null, selectionMode: 'auto' } }),
    });
    assert.equal(beats[0].modality, 'text');
  });
});

// ─── long text blocks auto voice ──────────────────────────────────────────

describe('orchestrateBeatModalities — long text blocks voice', () => {
  it('text longer than 48 chars stays text even with high voiceAffinity', () => {
    const longText = 'A'.repeat(49);
    const beats = orchestrateBeatModalities({
      beats: [createBeat({ intent: 'comfort', text: longText })],
      turnMode: 'emotional',
      interactionProfile: createProfile(),
      snapshot: null,
      policy: createPolicy(),
    });
    assert.equal(beats[0].modality, 'text');
  });
});

// ─── visualSlotUsed: one visual slot per turn ─────────────────────────────

describe('orchestrateBeatModalities — visual slot', () => {
  it('only first beat gets visual modality', () => {
    const beats = orchestrateBeatModalities({
      beats: [
        createBeat({
          beatId: 'b1', beatIndex: 0,
          assetRequest: { kind: 'image', prompt: 'photo 1', confidence: 0.9, nsfwIntent: 'none' },
        }),
        createBeat({
          beatId: 'b2', beatIndex: 1,
          assetRequest: { kind: 'image', prompt: 'photo 2', confidence: 0.9, nsfwIntent: 'none' },
        }),
      ],
      turnMode: 'explicit-media',
      interactionProfile: createProfile(),
      snapshot: null,
      policy: createPolicy(),
    });
    assert.equal(beats[0].modality, 'image');
    // Second beat should NOT get image modality (visual slot used)
    assert.notEqual(beats[1].modality, 'image');
  });
});
