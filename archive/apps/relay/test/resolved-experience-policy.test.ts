// Unit tests for resolved experience policy — adapted from local-chat-resolved-experience-policy.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileResolvedExperiencePolicy } from '../src/main/chat-pipeline/resolved-experience-policy.js';
import { DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS } from '../src/main/settings/types.js';
import type { DerivedInteractionProfile, InteractionSnapshot } from '../src/main/chat-pipeline/types.js';

function createInteractionProfile(overrides: Partial<DerivedInteractionProfile> = {}): DerivedInteractionProfile {
  return {
    expression: {
      responseLength: 'medium',
      formality: 'casual',
      sentiment: 'positive',
      pacingBias: 'balanced',
      firstBeatStyle: 'gentle',
      infoAnswerStyle: 'balanced',
      emojiUsage: 'occasional',
      ...(overrides.expression || {}),
    },
    relationship: {
      defaultDistance: 'friendly',
      warmth: 'warm',
      flirtAffinity: 'light',
      proactiveStyle: 'gentle',
      intimacyGuard: 'balanced',
      ...(overrides.relationship || {}),
    },
    voice: {
      voiceId: 'alloy',
      language: 'zh-CN',
      genderGuard: 'female',
      speedRange: 'balanced',
      pitchRange: 'mid',
      emotionEnabled: true,
      voiceAffinity: 'high',
      ...(overrides.voice || {}),
    },
    visual: {
      artStyle: 'anime',
      fashionStyle: 'casual',
      personaCue: 'gentle',
      nsfwLevel: 'suggestive',
      imageAffinity: 'medium',
      videoAffinity: 'low',
      ...(overrides.visual || {}),
    },
    modalityTraits: {
      textBias: 'medium',
      voiceBias: 'high',
      imageBias: 'medium',
      videoBias: 'low',
      latencyTolerance: 'medium',
      ...(overrides.modalityTraits || {}),
    },
    signals: [...(overrides.signals || [])],
  };
}

function createSnapshot(overrides: Partial<InteractionSnapshot> = {}): InteractionSnapshot {
  return {
    conversationId: 'conv-1',
    relationshipState: 'warm',
    activeScene: ['night-chat'],
    emotionalTemperature: 'warm',
    assistantCommitments: [],
    userPrefs: [],
    openLoops: [],
    topicThreads: [],
    lastResolvedTurnId: 'turn-1',
    conversationDirective: null,
    conversationMomentum: 'steady',
    updatedAt: '2026-03-08T00:00:00.000Z',
    ...overrides,
  };
}

// ─── Cloud NSFW policy ──────────────────────────────────────────────────

describe('compileResolvedExperiencePolicy — cloud visuals', () => {
  it('keeps cloud visuals on safe boundary', () => {
    const policy = compileResolvedExperiencePolicy({
      interactionProfile: createInteractionProfile(),
      interactionSnapshot: createSnapshot(),
      settings: {
        ...DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS,
        mediaAutonomy: 'natural',
        relationshipBoundaryPreset: 'close',
        visualComfortLevel: 'natural-visuals',
      },
      routeSource: 'cloud',
    });

    assert.equal(policy.mediaPolicy.routeSource, 'cloud');
    assert.equal(policy.mediaPolicy.nsfwPolicy, 'local-only');
    assert.equal(policy.mediaPolicy.allowVisualAuto, true);
  });
});

// ─── Default settings ───────────────────────────────────────────────────

describe('compileResolvedExperiencePolicy — default settings', () => {
  it('default settings prefer natural visuals', () => {
    assert.equal(DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS.visualComfortLevel, 'natural-visuals');
  });
});

// ─── Local visual freedom ───────────────────────────────────────────────

describe('compileResolvedExperiencePolicy — local route', () => {
  it('enables local visual freedom for local natural visuals', () => {
    const policy = compileResolvedExperiencePolicy({
      interactionProfile: createInteractionProfile(),
      interactionSnapshot: createSnapshot({ relationshipState: 'intimate' }),
      settings: {
        ...DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS,
        voiceAutonomy: 'natural',
        voiceConversationMode: 'off',
        autoPlayVoiceReplies: true,
        voiceName: 'voice-custom',
        relationshipBoundaryPreset: 'balanced',
        visualComfortLevel: 'natural-visuals',
        mediaAutonomy: 'natural',
      },
      requestedVoiceConversationMode: 'on',
      routeSource: 'local',
    });

    assert.equal(policy.mediaPolicy.nsfwPolicy, 'allowed');
    assert.equal(policy.voicePolicy.autonomy, 'natural');
    assert.equal(policy.voicePolicy.conversationMode, 'on');
    assert.equal(policy.voicePolicy.selectionMode, 'manual');
  });
});

// ─── Voice conversation mode ────────────────────────────────────────────

describe('compileResolvedExperiencePolicy — voice conversation mode', () => {
  it('keeps voice conversation off unless explicitly requested', () => {
    const policy = compileResolvedExperiencePolicy({
      interactionProfile: createInteractionProfile(),
      interactionSnapshot: createSnapshot(),
      settings: {
        ...DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS,
        voiceAutonomy: 'natural',
        voiceConversationMode: 'off',
      },
      routeSource: 'local',
    });

    assert.equal(policy.voicePolicy.conversationMode, 'off');
  });
});

// ─── Delivery style derivation ──────────────────────────────────────────

describe('compileResolvedExperiencePolicy — delivery style', () => {
  it('derives natural delivery when unresolved continuity exists', () => {
    const policy = compileResolvedExperiencePolicy({
      interactionProfile: createInteractionProfile({
        expression: {
          responseLength: 'medium',
          formality: 'casual',
          sentiment: 'positive',
          pacingBias: 'reserved',
          firstBeatStyle: 'gentle',
          infoAnswerStyle: 'balanced',
          emojiUsage: 'occasional',
        },
      }),
      interactionSnapshot: createSnapshot({
        relationshipState: 'friendly',
        openLoops: ['说好了今晚去散步'],
        assistantCommitments: [],
        conversationMomentum: 'cooling',
      }),
      settings: {
        ...DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS,
      },
      routeSource: 'local',
    });

    assert.equal(policy.deliveryPolicy.style, 'natural');
    assert.equal(policy.deliveryPolicy.allowMultiReply, true);
  });

  it('derives compact delivery for cooling low-intimacy chats without unresolved continuity', () => {
    const policy = compileResolvedExperiencePolicy({
      interactionProfile: createInteractionProfile({
        expression: {
          responseLength: 'medium',
          formality: 'casual',
          sentiment: 'positive',
          pacingBias: 'balanced',
          firstBeatStyle: 'gentle',
          infoAnswerStyle: 'balanced',
          emojiUsage: 'occasional',
        },
      }),
      interactionSnapshot: createSnapshot({
        relationshipState: 'friendly',
        openLoops: [],
        assistantCommitments: [],
        conversationMomentum: 'cooling',
      }),
      settings: {
        ...DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS,
      },
      routeSource: 'local',
    });

    assert.equal(policy.deliveryPolicy.style, 'compact');
    assert.equal(policy.deliveryPolicy.allowMultiReply, false);
  });
});

// ─── Content boundary derivation ────────────────────────────────────────

describe('compileResolvedExperiencePolicy — content boundary', () => {
  it('derives close boundary only for open high-flirt intimate relations', () => {
    const policy = compileResolvedExperiencePolicy({
      interactionProfile: createInteractionProfile({
        relationship: {
          defaultDistance: 'friendly',
          warmth: 'intimate',
          flirtAffinity: 'high',
          proactiveStyle: 'playful',
          intimacyGuard: 'open',
        },
      }),
      interactionSnapshot: createSnapshot({
        relationshipState: 'intimate',
      }),
      settings: {
        ...DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS,
        visualComfortLevel: 'natural-visuals',
        mediaAutonomy: 'natural',
      },
      routeSource: 'local',
    });

    assert.equal(policy.contentBoundary.relationshipBoundaryPreset, 'close');
    assert.equal(policy.mediaPolicy.allowAutoVisualHighRisk, true);
  });

  it('derives reserved boundary for strict intimacy guard', () => {
    const policy = compileResolvedExperiencePolicy({
      interactionProfile: createInteractionProfile({
        relationship: {
          defaultDistance: 'friendly',
          warmth: 'warm',
          flirtAffinity: 'light',
          proactiveStyle: 'gentle',
          intimacyGuard: 'strict',
        },
      }),
      interactionSnapshot: createSnapshot({
        relationshipState: 'warm',
      }),
      settings: {
        ...DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS,
      },
      routeSource: 'local',
    });

    assert.equal(policy.contentBoundary.relationshipBoundaryPreset, 'reserved');
  });

  it('derives reserved boundary for new relationship state', () => {
    const policy = compileResolvedExperiencePolicy({
      interactionProfile: createInteractionProfile(),
      interactionSnapshot: createSnapshot({
        relationshipState: 'new',
      }),
      settings: {
        ...DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS,
      },
      routeSource: 'local',
    });

    assert.equal(policy.contentBoundary.relationshipBoundaryPreset, 'reserved');
  });
});
