// Unit tests for prompt compilation

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileLocalChatPrompt } from '../src/main/prompt/compiler.js';
import type { LocalChatPromptCompileInput } from '../src/main/prompt/types.js';
import type { LocalChatContextPacket, DerivedInteractionProfile } from '../src/main/chat-pipeline/types.js';

function createInteractionProfile(): DerivedInteractionProfile {
  return {
    expression: {
      responseLength: 'medium',
      formality: 'casual',
      sentiment: 'positive',
      pacingBias: 'balanced',
      firstBeatStyle: 'gentle',
      infoAnswerStyle: 'balanced',
      emojiUsage: 'occasional',
    },
    relationship: {
      defaultDistance: 'friendly',
      warmth: 'warm',
      flirtAffinity: 'light',
      proactiveStyle: 'gentle',
      intimacyGuard: 'balanced',
    },
    voice: {
      voiceId: 'alloy',
      language: 'zh-CN',
      genderGuard: 'female',
      speedRange: 'balanced',
      pitchRange: 'mid',
      emotionEnabled: true,
      voiceAffinity: 'high',
    },
    visual: {
      artStyle: 'anime',
      fashionStyle: 'casual',
      personaCue: 'gentle',
      nsfwLevel: 'suggestive',
      imageAffinity: 'medium',
      videoAffinity: 'low',
    },
    modalityTraits: {
      textBias: 'medium',
      voiceBias: 'high',
      imageBias: 'medium',
      videoBias: 'low',
      latencyTolerance: 'medium',
    },
    signals: [],
  };
}

function createContextPacket(overrides: Partial<LocalChatContextPacket> = {}): LocalChatContextPacket {
  return {
    conversationId: 'conv-test',
    viewer: { id: 'viewer-1', displayName: 'User' },
    target: {
      id: 'agent-1',
      handle: 'test-agent',
      displayName: 'Test Agent',
      bio: 'A test agent for unit testing.',
      identityLines: ['You are a friendly assistant.', 'You speak casually.'],
      rulesLines: ['Always stay in character.'],
      replyStyleLines: ['Use short sentences.'],
      interactionProfile: createInteractionProfile(),
    },
    world: {
      worldId: 'world-1',
      lines: ['This is a modern city setting.'],
    },
    platformWarmStart: null,
    sessionRecall: [],
    recentTurns: [
      { id: 'turn-1', seq: 1, role: 'user', lines: ['Hello, how are you?'] },
      { id: 'turn-2', seq: 2, role: 'assistant', lines: ['I am doing well, thanks for asking!'] },
    ],
    interactionSnapshot: {
      conversationId: 'conv-test',
      relationshipState: 'warm',
      activeScene: ['daily-chat'],
      emotionalTemperature: 'warm',
      assistantCommitments: [],
      userPrefs: ['prefers short replies'],
      openLoops: [],
      topicThreads: ['daily life'],
      lastResolvedTurnId: 'turn-2',
      conversationDirective: null,
      conversationMomentum: 'steady',
      updatedAt: '2026-03-08T00:00:00.000Z',
    },
    relationMemorySlots: [
      {
        id: 'slot-1',
        targetId: 'agent-1',
        viewerId: 'viewer-1',
        slotType: 'preference',
        key: 'reply-style',
        value: 'prefers short replies',
        confidence: 0.8,
        portability: 'portable',
        sensitivity: 'safe',
        userOverride: 'inherit',
        updatedAt: '2026-03-08T00:00:00.000Z',
      },
    ],
    turnMode: 'emotional',
    voiceConversationMode: 'off',
    pacingPlan: {
      mode: 'single',
      maxSegments: 1,
      energy: 'medium',
      reason: 'default',
    },
    promptLocale: 'zh',
    userInput: '我今天有点累',
    diagnostics: {
      selectedTurnSeqs: [1, 2],
      sessionRecallCount: 0,
    },
    ...overrides,
  };
}

function createCompileInput(overrides: Partial<LocalChatPromptCompileInput> = {}): LocalChatPromptCompileInput {
  return {
    contextPacket: createContextPacket(),
    ...overrides,
  };
}

// ─── Basic compilation ──────────────────────────────────────────────────

describe('compileLocalChatPrompt — basic output', () => {
  it('produces non-empty prompt string', () => {
    const compiled = compileLocalChatPrompt(createCompileInput());
    assert.ok(compiled.prompt.length > 0);
  });

  it('includes identity layer', () => {
    const compiled = compileLocalChatPrompt(createCompileInput());
    assert.ok(compiled.prompt.includes('Identity') || compiled.prompt.includes('角色身份'));
  });

  it('includes user input in prompt', () => {
    const compiled = compileLocalChatPrompt(createCompileInput());
    assert.ok(compiled.prompt.includes('我今天有点累'));
  });

  it('returns v7 compiler version', () => {
    const compiled = compileLocalChatPrompt(createCompileInput());
    assert.equal(compiled.compilerVersion, 'v7');
  });

  it('reports applied layers', () => {
    const compiled = compileLocalChatPrompt(createCompileInput());
    const appliedLayers = compiled.layers.filter((layer) => layer.applied);
    assert.ok(appliedLayers.length > 0);
    assert.ok(appliedLayers.some((layer) => layer.layer === 'identity'));
    assert.ok(appliedLayers.some((layer) => layer.layer === 'userInput'));
  });
});

// ─── Lane budgets ───────────────────────────────────────────────────────

describe('compileLocalChatPrompt — lane budgets', () => {
  it('respects max prompt chars budget', () => {
    const compiled = compileLocalChatPrompt(createCompileInput());
    assert.ok(compiled.prompt.length <= compiled.budget.maxChars);
  });

  it('reports lane budgets for identity lane', () => {
    const compiled = compileLocalChatPrompt(createCompileInput());
    const identityBudget = compiled.budget.laneBudgets.identity;
    assert.ok(identityBudget);
    assert.ok(identityBudget!.maxChars > 0);
  });

  it('reports used chars in budget', () => {
    const compiled = compileLocalChatPrompt(createCompileInput());
    assert.equal(compiled.budget.usedChars, compiled.prompt.length);
  });

  it('tracks retrieval counts', () => {
    const compiled = compileLocalChatPrompt(createCompileInput());
    assert.equal(compiled.retrieval.durableMemoryCount, 1);
    assert.equal(compiled.retrieval.recentTurnCount, 2);
  });
});

// ─── Profile: first-beat vs full-turn ───────────────────────────────────

describe('compileLocalChatPrompt — first-beat profile', () => {
  it('first-beat profile produces shorter prompt than full-turn', () => {
    const fullTurn = compileLocalChatPrompt(createCompileInput({ profile: 'full-turn' }));
    const firstBeat = compileLocalChatPrompt(createCompileInput({ profile: 'first-beat' }));
    assert.ok(firstBeat.prompt.length < fullTurn.prompt.length);
  });

  it('first-beat profile omits world and platformWarmStart layers', () => {
    const compiled = compileLocalChatPrompt(createCompileInput({ profile: 'first-beat' }));
    const worldLayer = compiled.layers.find((layer) => layer.layer === 'world');
    const warmStartLayer = compiled.layers.find((layer) => layer.layer === 'platformWarmStart');
    // first-beat layer order excludes these layers entirely
    assert.ok(!worldLayer || !worldLayer.applied);
    assert.ok(!warmStartLayer || !warmStartLayer.applied);
  });

  it('first-beat profile reports correct profile', () => {
    const compiled = compileLocalChatPrompt(createCompileInput({ profile: 'first-beat' }));
    assert.equal(compiled.profile, 'first-beat');
  });

  it('full-turn profile reports correct profile', () => {
    const compiled = compileLocalChatPrompt(createCompileInput({ profile: 'full-turn' }));
    assert.equal(compiled.profile, 'full-turn');
  });

  it('first-beat limits recent turns to 4', () => {
    const manyTurns = Array.from({ length: 10 }, (_, i) => ({
      id: `turn-${i}`,
      seq: i + 1,
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      lines: [`Message ${i}`],
    }));
    const compiled = compileLocalChatPrompt(createCompileInput({
      profile: 'first-beat',
      contextPacket: createContextPacket({ recentTurns: manyTurns }),
    }));
    assert.equal(compiled.retrieval.recentTurnCount, 4);
  });
});

// ─── Empty context handling ─────────────────────────────────────────────

describe('compileLocalChatPrompt — sparse context', () => {
  it('handles empty identity lines gracefully', () => {
    const packet = createContextPacket();
    packet.target.identityLines = [];
    packet.target.rulesLines = [];
    packet.target.replyStyleLines = [];
    const compiled = compileLocalChatPrompt({ contextPacket: packet });
    assert.ok(compiled.prompt.length > 0);
  });

  it('handles no interaction snapshot gracefully', () => {
    const packet = createContextPacket();
    packet.interactionSnapshot = null;
    const compiled = compileLocalChatPrompt({ contextPacket: packet });
    assert.ok(compiled.prompt.length > 0);
  });

  it('handles no relation memory slots gracefully', () => {
    const packet = createContextPacket();
    packet.relationMemorySlots = [];
    const compiled = compileLocalChatPrompt({ contextPacket: packet });
    assert.equal(compiled.retrieval.durableMemoryCount, 0);
  });
});
