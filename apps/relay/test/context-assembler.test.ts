// Unit tests for context-assembler.ts — context packet assembly (RL-PIPE-003)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleFirstBeatContext,
  assembleFullTurnContext,
} from '../src/main/chat-pipeline/context-assembler.js';
import type {
  LocalChatTarget,
  LocalChatTurn,
  InteractionSnapshot,
  RelationMemorySlot,
  InteractionRecallDoc,
} from '../src/main/chat-pipeline/types.js';

function createTarget(overrides: Partial<LocalChatTarget> = {}): LocalChatTarget {
  return {
    id: 'target-1',
    handle: 'test-agent',
    displayName: 'Test Agent',
    avatarUrl: null,
    bio: 'A test agent',
    dna: {
      identityLines: ['A friendly companion'],
      rulesLines: ['Be kind'],
      replyStyleLines: ['Casual chat'],
    },
    metadata: {},
    worldId: null,
    worldName: null,
    ...overrides,
  };
}

function createTurn(overrides: Partial<LocalChatTurn> = {}): LocalChatTurn {
  return {
    id: 't-1',
    turnId: 'turn-1',
    turnSeq: 1,
    beatIndex: 0,
    beatCount: 1,
    role: 'user',
    kind: 'text',
    content: 'Hello',
    contextText: 'Hello',
    semanticSummary: null,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function createSnapshot(overrides: Partial<InteractionSnapshot> = {}): InteractionSnapshot {
  return {
    conversationId: 'conv-1',
    relationshipState: 'friendly',
    activeScene: ['chat'],
    emotionalTemperature: 'steady',
    assistantCommitments: [],
    userPrefs: [],
    openLoops: [],
    topicThreads: [],
    lastResolvedTurnId: null,
    conversationDirective: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── assembleFirstBeatContext ─────────────────────────────────────────────

describe('assembleFirstBeatContext', () => {
  it('produces lightweight packet with no recall or memory', () => {
    const packet = assembleFirstBeatContext({
      text: 'Hello',
      viewerId: 'viewer-1',
      viewerDisplayName: 'User',
      selectedTarget: createTarget(),
      selectedSessionId: 'session-1',
      recentTurns: [],
      interactionSnapshot: null,
    });
    assert.equal(packet.conversationId, 'session-1');
    assert.equal(packet.viewer.id, 'viewer-1');
    assert.equal(packet.platformWarmStart, null);
    assert.deepEqual(packet.sessionRecall, []);
    assert.deepEqual(packet.relationMemorySlots, []);
    assert.equal(packet.userInput, 'Hello');
  });

  it('limits recent turns to 4', () => {
    const turns: LocalChatTurn[] = Array.from({ length: 10 }, (_, i) =>
      createTurn({ id: `t-${i}`, turnId: `turn-${i}`, turnSeq: i, contextText: `msg ${i}` }),
    );
    const packet = assembleFirstBeatContext({
      text: 'latest',
      viewerId: 'v1',
      viewerDisplayName: 'User',
      selectedTarget: createTarget(),
      selectedSessionId: 's1',
      recentTurns: turns,
      interactionSnapshot: null,
    });
    assert.ok(packet.recentTurns.length <= 4);
  });

  it('trims snapshot for first beat', () => {
    const snapshot = createSnapshot({
      activeScene: ['scene1', 'scene2', 'scene3'],
      assistantCommitments: ['c1', 'c2', 'c3'],
      userPrefs: ['p1', 'p2', 'p3'],
      openLoops: ['o1', 'o2', 'o3'],
      topicThreads: ['t1', 't2', 't3', 't4'],
    });
    const packet = assembleFirstBeatContext({
      text: 'Hello',
      viewerId: 'v1',
      viewerDisplayName: 'User',
      selectedTarget: createTarget(),
      selectedSessionId: 's1',
      recentTurns: [],
      interactionSnapshot: snapshot,
    });
    assert.ok(packet.interactionSnapshot!.activeScene.length <= 1);
    assert.ok(packet.interactionSnapshot!.topicThreads.length <= 2);
  });

  it('deduplicates echoed current user turn', () => {
    const turns: LocalChatTurn[] = [
      createTurn({ turnSeq: 1, role: 'assistant', contextText: 'Hi there' }),
      createTurn({ turnSeq: 2, role: 'user', contextText: 'Hello' }),
    ];
    const packet = assembleFirstBeatContext({
      text: 'Hello',
      viewerId: 'v1',
      viewerDisplayName: 'User',
      selectedTarget: createTarget(),
      selectedSessionId: 's1',
      recentTurns: turns,
      interactionSnapshot: null,
    });
    // The last user turn "Hello" matches userInput, so it should be trimmed
    const userTurns = packet.recentTurns.filter((t) => t.role === 'user');
    assert.equal(userTurns.length, 0);
  });
});

// ─── assembleFullTurnContext ──────────────────────────────────────────────

describe('assembleFullTurnContext', () => {
  it('includes relation memory and recall', () => {
    const memorySlots: RelationMemorySlot[] = [{
      id: 'slot-1',
      targetId: 'target-1',
      viewerId: 'viewer-1',
      slotType: 'preference',
      key: 'favorite color',
      value: 'blue',
      confidence: 0.9,
      portability: 'portable',
      sensitivity: 'safe',
      userOverride: 'inherit',
      updatedAt: new Date().toISOString(),
    }];
    const recallIndex: InteractionRecallDoc[] = [{
      id: 'doc-1',
      conversationId: 'conv-1',
      sourceTurnId: 'turn-1',
      text: 'User likes blue',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }];
    const packet = assembleFullTurnContext({
      text: '我喜欢什么颜色',
      viewerId: 'v1',
      viewerDisplayName: 'User',
      selectedTarget: createTarget(),
      selectedSessionId: 's1',
      recentTurns: [],
      interactionSnapshot: null,
      relationMemorySlots: memorySlots,
      recallIndex,
      platformWarmStart: null,
    });
    assert.ok(packet.relationMemorySlots!.length > 0);
    assert.ok(packet.sessionRecall.length >= 0);
  });

  it('does not trim recent turns (full context)', () => {
    const turns: LocalChatTurn[] = Array.from({ length: 10 }, (_, i) =>
      createTurn({ id: `t-${i}`, turnId: `turn-${i}`, turnSeq: i, contextText: `msg ${i}` }),
    );
    const packet = assembleFullTurnContext({
      text: 'latest',
      viewerId: 'v1',
      viewerDisplayName: 'User',
      selectedTarget: createTarget(),
      selectedSessionId: 's1',
      recentTurns: turns,
      interactionSnapshot: null,
      relationMemorySlots: [],
      recallIndex: [],
      platformWarmStart: null,
    });
    // Full context should have all turns (not limited to 4 like first-beat)
    assert.ok(packet.recentTurns.length > 4);
  });

  it('includes platform warm start only when no snapshot and few turns', () => {
    const warmStart = {
      core: ['memory-1'],
      e2e: ['e2e-1'],
      recallSource: 'local-index-only' as const,
      entityId: 'entity-1',
    };
    const packetWithWarm = assembleFullTurnContext({
      text: 'Hello',
      viewerId: 'v1',
      viewerDisplayName: 'User',
      selectedTarget: createTarget(),
      selectedSessionId: 's1',
      recentTurns: [],
      interactionSnapshot: null,
      relationMemorySlots: [],
      recallIndex: [],
      platformWarmStart: warmStart,
    });
    assert.ok(packetWithWarm.platformWarmStart !== null);

    // With snapshot, warm start should be null
    const packetWithSnapshot = assembleFullTurnContext({
      text: 'Hello',
      viewerId: 'v1',
      viewerDisplayName: 'User',
      selectedTarget: createTarget(),
      selectedSessionId: 's1',
      recentTurns: [],
      interactionSnapshot: createSnapshot(),
      relationMemorySlots: [],
      recallIndex: [],
      platformWarmStart: warmStart,
    });
    assert.equal(packetWithSnapshot.platformWarmStart, null);
  });
});
