// Unit tests for proactive/policy.ts — wake strategy and policy gates (RL-PIPE-007)
// Uses mock.module to avoid Electron dependency from policy-store → relay-chat-storage

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  resolveLocalChatWakeStrategy,
  evaluateLocalChatProactivePolicy,
  PROACTIVE_IDLE_MIN_MS,
  PROACTIVE_IDLE_MAX_MS,
} = await import('../src/main/proactive/policy.js');

type LocalChatTarget = import('../src/main/chat-pipeline/types.js').LocalChatTarget;

function createTarget(metadata: Record<string, unknown> = {}): LocalChatTarget {
  return {
    id: 'target-1',
    handle: 'test-agent',
    displayName: 'Test Agent',
    avatarUrl: null,
    bio: null,
    dna: { identityLines: [], rulesLines: [], replyStyleLines: [] },
    metadata,
    worldId: null,
    worldName: null,
  };
}

// ─── resolveLocalChatWakeStrategy ─────────────────────────────────────────

describe('resolveLocalChatWakeStrategy', () => {
  it('reads from agentMetadata first', () => {
    const target = createTarget({
      agentMetadata: { wakeStrategy: 'PROACTIVE' },
      agentProfile: { wakeStrategy: 'PASSIVE' },
    });
    assert.equal(resolveLocalChatWakeStrategy(target), 'PROACTIVE');
  });

  it('falls back to agentProfile', () => {
    const target = createTarget({
      agentProfile: { wakeStrategy: 'PASSIVE' },
    });
    assert.equal(resolveLocalChatWakeStrategy(target), 'PASSIVE');
  });

  it('falls back to top-level metadata', () => {
    const target = createTarget({
      wakeStrategy: 'PROACTIVE',
    });
    assert.equal(resolveLocalChatWakeStrategy(target), 'PROACTIVE');
  });

  it('returns null when no wake strategy found', () => {
    const target = createTarget({});
    assert.equal(resolveLocalChatWakeStrategy(target), null);
  });

  it('returns null for unrecognized values', () => {
    const target = createTarget({ agentMetadata: { wakeStrategy: 'UNKNOWN' } });
    assert.equal(resolveLocalChatWakeStrategy(target), null);
  });

  it('handles snake_case key', () => {
    const target = createTarget({ agentMetadata: { wake_strategy: 'PROACTIVE' } });
    assert.equal(resolveLocalChatWakeStrategy(target), 'PROACTIVE');
  });

  it('is case-insensitive (lowercased input)', () => {
    const target = createTarget({ agentMetadata: { wakeStrategy: 'proactive' } });
    assert.equal(resolveLocalChatWakeStrategy(target), 'PROACTIVE');
  });
});

// ─── evaluateLocalChatProactivePolicy ─────────────────────────────────────

describe('evaluateLocalChatProactivePolicy', () => {
  it('returns disabled when allowProactiveContact is false', async () => {
    const result = await evaluateLocalChatProactivePolicy({
      allowProactiveContact: false,
      wakeStrategy: 'PROACTIVE',
      targetId: 'target-1',
      sessionId: 'session-1',
      idleMs: PROACTIVE_IDLE_MIN_MS + 1000,
      nowMs: Date.now(),
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reasonCode, 'LOCAL_CHAT_PROACTIVE_DISABLED_BY_USER_SETTING');
  });

  it('returns disabled when wake strategy is not PROACTIVE', async () => {
    const result = await evaluateLocalChatProactivePolicy({
      allowProactiveContact: true,
      wakeStrategy: 'PASSIVE',
      targetId: 'target-1',
      sessionId: 'session-1',
      idleMs: PROACTIVE_IDLE_MIN_MS + 1000,
      nowMs: Date.now(),
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reasonCode, 'LOCAL_CHAT_PROACTIVE_DISABLED_BY_WAKE_STRATEGY');
  });

  it('returns disabled when wake strategy is null', async () => {
    const result = await evaluateLocalChatProactivePolicy({
      allowProactiveContact: true,
      wakeStrategy: null,
      targetId: 'target-1',
      sessionId: 'session-1',
      idleMs: PROACTIVE_IDLE_MIN_MS + 1000,
      nowMs: Date.now(),
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reasonCode, 'LOCAL_CHAT_PROACTIVE_DISABLED_BY_WAKE_STRATEGY');
  });

  it('returns failed precondition when idle too short', async () => {
    const result = await evaluateLocalChatProactivePolicy({
      allowProactiveContact: true,
      wakeStrategy: 'PROACTIVE',
      targetId: 'target-1',
      sessionId: 'session-1',
      idleMs: 1000,
      nowMs: Date.now(),
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reasonCode, 'LOCAL_CHAT_PROACTIVE_SOCIAL_PRECONDITION_FAILED');
  });

  it('returns failed precondition when idle too long', async () => {
    const result = await evaluateLocalChatProactivePolicy({
      allowProactiveContact: true,
      wakeStrategy: 'PROACTIVE',
      targetId: 'target-1',
      sessionId: 'session-1',
      idleMs: PROACTIVE_IDLE_MAX_MS + 1,
      nowMs: Date.now(),
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reasonCode, 'LOCAL_CHAT_PROACTIVE_SOCIAL_PRECONDITION_FAILED');
  });

  it('returns allowed when all gates pass (mocked store returns fresh state)', async () => {
    const result = await evaluateLocalChatProactivePolicy({
      allowProactiveContact: true,
      wakeStrategy: 'PROACTIVE',
      targetId: 'target-1',
      sessionId: 'session-1',
      idleMs: PROACTIVE_IDLE_MIN_MS + 1000,
      nowMs: Date.now(),
    }, {
      readTargetState: async () => ({ lastSentAtMs: 0, dailyCount: 0 }),
    });
    assert.equal(result.allowed, true);
    assert.equal(result.reasonCode, 'LOCAL_CHAT_PROACTIVE_ALLOWED');
  });
});
