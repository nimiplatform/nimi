// Unit tests for interaction state compiler — adapted from local-chat-interaction-state-compiler.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileInteractionState } from '../src/main/chat-pipeline/interaction-state-compiler.js';

// ─── Snapshot + beat compilation ────────────────────────────────────────

describe('compileInteractionState — snapshot, relation memory, and recall docs', () => {
  it('writes snapshot, relation memory slots, and recall docs from delivered beats', () => {
    const compiled = compileInteractionState({
      conversationId: 'session-1',
      targetId: 'agent-1',
      viewerId: 'viewer-1',
      session: {
        id: 'session-1',
        targetId: 'agent-1',
        viewerId: 'viewer-1',
        worldId: 'world-1',
        title: 'Session',
        turnCount: 2,
        messageCount: 4,
        createdAt: '2026-03-08T00:00:00.000Z',
        updatedAt: '2026-03-08T00:00:00.000Z',
        turns: [
          {
            id: 'user-turn-1',
            turnId: 'user-turn-1',
            turnSeq: 1,
            beatIndex: 0,
            beatCount: 1,
            role: 'user',
            kind: 'text',
            content: '我喜欢雨夜和霓虹灯，之后提醒我一起去散步。',
            contextText: '我喜欢雨夜和霓虹灯，之后提醒我一起去散步。',
            semanticSummary: null,
            timestamp: '2026-03-08T00:00:00.000Z',
          },
        ],
      },
      deliveredBeats: [
        {
          beatId: 'beat-1',
          turnId: 'turn-1',
          beatIndex: 0,
          beatCount: 2,
          intent: 'comfort',
          relationMove: 'comfort-warm',
          sceneMove: 'rainy-night',
          modality: 'text',
          text: '我在，先陪你把这一刻接住。',
          pauseMs: 0,
          cancellationScope: 'turn',
        },
        {
          beatId: 'beat-2',
          turnId: 'turn-1',
          beatIndex: 1,
          beatCount: 2,
          intent: 'invite',
          relationMove: 'invite-closer',
          sceneMove: 'future-walk',
          modality: 'voice',
          text: '等我一下，之后我会提醒你一起去散步。',
          pauseMs: 650,
          cancellationScope: 'tail',
        },
      ],
    });

    assert.equal(compiled.snapshot.conversationId, 'session-1');
    assert.ok(compiled.snapshot.activeScene.includes('rainy-night'));
    assert.ok(compiled.snapshot.openLoops.some((item) => item.includes('之后')));
    assert.ok(compiled.snapshot.userPrefs.some((item) => item.includes('喜欢雨夜和霓虹灯')));
    assert.equal(compiled.snapshot.lastResolvedTurnId, 'turn-1');

    assert.ok(compiled.relationMemorySlots.some((slot) => slot.slotType === 'preference'));
    assert.ok(compiled.relationMemorySlots.some((slot) => slot.slotType === 'promise'));
    assert.ok(compiled.relationMemorySlots.some((slot) => slot.slotType === 'rapport'));

    assert.ok(compiled.recallDocs.some((doc) => doc.text.includes('喜欢雨夜和霓虹灯')));
    assert.ok(compiled.recallDocs.some((doc) => doc.text.includes('我会提醒你一起去散步')));
  });
});

// ─── Snapshot merge / continuity ────────────────────────────────────────

describe('compileInteractionState — merge continuity from previous snapshot', () => {
  it('merges continuity from previous snapshot on neutral follow-up turns', () => {
    const compiled = compileInteractionState({
      conversationId: 'session-merge',
      targetId: 'agent-1',
      viewerId: 'viewer-1',
      previousSnapshot: {
        conversationId: 'session-merge',
        relationshipState: 'warm',
        activeScene: ['rainy-night'],
        emotionalTemperature: 'heated',
        assistantCommitments: ['我会提醒你一起去散步。'],
        userPrefs: ['喜欢短句聊天'],
        openLoops: ['之后一起去散步'],
        topicThreads: ['雨夜散步'],
        lastResolvedTurnId: 'turn-prev',
        conversationDirective: null,
        conversationMomentum: 'steady',
        updatedAt: '2026-03-08T00:00:00.000Z',
      },
      session: {
        id: 'session-merge',
        targetId: 'agent-1',
        viewerId: 'viewer-1',
        worldId: null,
        title: 'Session',
        turnCount: 4,
        messageCount: 4,
        createdAt: '2026-03-08T00:00:00.000Z',
        updatedAt: '2026-03-08T00:10:00.000Z',
        turns: [
          {
            id: 'turn-user-1',
            turnId: 'turn-user-1',
            turnSeq: 1,
            beatIndex: 0,
            beatCount: 1,
            role: 'user',
            kind: 'text',
            content: '我喜欢短句聊天。',
            contextText: '我喜欢短句聊天。',
            semanticSummary: null,
            timestamp: '2026-03-08T00:00:00.000Z',
          },
          {
            id: 'turn-user-2',
            turnId: 'turn-user-2',
            turnSeq: 2,
            beatIndex: 0,
            beatCount: 1,
            role: 'user',
            kind: 'text',
            content: '我们先随便聊聊今天天气吧。',
            contextText: '我们先随便聊聊今天天气吧。',
            semanticSummary: null,
            timestamp: '2026-03-08T00:10:00.000Z',
          },
        ],
      },
      deliveredBeats: [
        {
          beatId: 'beat-1',
          turnId: 'turn-1',
          beatIndex: 0,
          beatCount: 1,
          intent: 'answer',
          relationMove: 'friendly',
          sceneMove: 'weather-chat',
          modality: 'text',
          text: '今天天气挺安静的，我们慢慢聊。',
          pauseMs: 0,
          cancellationScope: 'turn',
        },
      ],
    });

    // Relationship state should not regress within session
    assert.equal(compiled.snapshot.relationshipState, 'warm');
    assert.ok(compiled.snapshot.userPrefs.includes('喜欢短句聊天'));
    assert.ok(compiled.snapshot.openLoops.includes('之后一起去散步'));
    assert.ok(compiled.snapshot.assistantCommitments.includes('我会提醒你一起去散步。'));
  });
});

// ─── Commitment and open loop resolution ────────────────────────────────

describe('compileInteractionState — resolve completed commitments and open loops', () => {
  it('resolves completed commitments and open loops when completion cues appear', () => {
    const compiled = compileInteractionState({
      conversationId: 'session-resolve',
      targetId: 'agent-1',
      viewerId: 'viewer-1',
      previousSnapshot: {
        conversationId: 'session-resolve',
        relationshipState: 'warm',
        activeScene: ['daily-chat'],
        emotionalTemperature: 'warm',
        assistantCommitments: ['我会提醒你去散步。'],
        userPrefs: ['喜欢夜聊'],
        openLoops: ['之后去散步'],
        topicThreads: ['散步'],
        lastResolvedTurnId: 'turn-prev',
        conversationDirective: null,
        conversationMomentum: 'steady',
        updatedAt: '2026-03-08T00:00:00.000Z',
      },
      session: {
        id: 'session-resolve',
        targetId: 'agent-1',
        viewerId: 'viewer-1',
        worldId: null,
        title: 'Session',
        turnCount: 3,
        messageCount: 3,
        createdAt: '2026-03-08T00:00:00.000Z',
        updatedAt: '2026-03-08T00:30:00.000Z',
        turns: [
          {
            id: 'turn-user-1',
            turnId: 'turn-user-1',
            turnSeq: 1,
            beatIndex: 0,
            beatCount: 1,
            role: 'user',
            kind: 'text',
            content: '你已经提醒我去散步了。',
            contextText: '你已经提醒我去散步了。',
            semanticSummary: null,
            timestamp: '2026-03-08T00:30:00.000Z',
          },
        ],
      },
      deliveredBeats: [
        {
          beatId: 'beat-1',
          turnId: 'turn-2',
          beatIndex: 0,
          beatCount: 1,
          intent: 'answer',
          relationMove: 'warm',
          sceneMove: 'daily-chat',
          modality: 'text',
          text: '好，我已经提醒过你今晚去散步了，接下来就轻松一点。',
          pauseMs: 0,
          cancellationScope: 'turn',
        },
      ],
    });

    assert.equal(compiled.snapshot.assistantCommitments.length, 0);
    assert.equal(compiled.snapshot.openLoops.length, 0);
    assert.ok(compiled.snapshot.userPrefs.includes('喜欢夜聊'));
  });
});

// ─── Empty input handling ───────────────────────────────────────────────

describe('compileInteractionState — edge cases', () => {
  it('handles null session and empty beats gracefully', () => {
    const compiled = compileInteractionState({
      conversationId: 'session-empty',
      targetId: 'agent-1',
      viewerId: 'viewer-1',
      session: null,
      deliveredBeats: [],
    });

    assert.equal(compiled.snapshot.conversationId, 'session-empty');
    assert.equal(compiled.snapshot.relationshipState, 'new');
    assert.equal(compiled.snapshot.lastResolvedTurnId, null);
    assert.equal(compiled.relationMemorySlots.length, 0);
  });
});
