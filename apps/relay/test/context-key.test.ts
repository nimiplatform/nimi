// Unit tests for turn context key — adapted from local-chat-turn-context-key.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLocalChatTurnContextKey,
  buildLocalChatTurnContextSnapshot,
  shouldCancelForTurnContextChange,
} from '../src/main/chat-pipeline/context-key.js';

// ─── buildLocalChatTurnContextKey ───────────────────────────────────────

describe('buildLocalChatTurnContextKey — deterministic key generation', () => {
  it('changes when the same target switches to a different session', () => {
    const first = buildLocalChatTurnContextKey({
      targetId: 'agent-1',
      sessionId: 'session-1',
      routeBinding: {
        source: 'token-api',
        connectorId: 'openai',
        model: 'gpt-5-mini',
      },
    });
    const second = buildLocalChatTurnContextKey({
      targetId: 'agent-1',
      sessionId: 'session-2',
      routeBinding: {
        source: 'local-runtime',
        connectorId: '',
        model: 'qwen2.5-7b',
      },
    });

    assert.notEqual(first, second);
  });

  it('keeps the active schedule session during same-target bootstrap alignment', () => {
    const activeSchedule = buildLocalChatTurnContextSnapshot({
      targetId: 'agent-1',
      sessionId: 'session-1',
      routeBinding: null,
    });

    const bootstrapping = buildLocalChatTurnContextKey({
      targetId: 'agent-1',
      sessionId: '',
      routeBinding: null,
      activeSchedule,
    });
    const scheduled = buildLocalChatTurnContextKey({
      targetId: 'agent-1',
      sessionId: 'session-1',
      routeBinding: null,
    });

    assert.equal(bootstrapping, scheduled);
  });

  it('produces identical keys for same target and session regardless of route binding', () => {
    const a = buildLocalChatTurnContextKey({
      targetId: 'agent-1',
      sessionId: 'session-1',
      routeBinding: { source: 'local', connectorId: '', model: 'model-a' },
    });
    const b = buildLocalChatTurnContextKey({
      targetId: 'agent-1',
      sessionId: 'session-1',
      routeBinding: { source: 'cloud', connectorId: 'openai', model: 'gpt-4' },
    });

    assert.equal(a, b);
  });

  it('produces different keys for different targets', () => {
    const a = buildLocalChatTurnContextKey({
      targetId: 'agent-1',
      sessionId: 'session-1',
      routeBinding: null,
    });
    const b = buildLocalChatTurnContextKey({
      targetId: 'agent-2',
      sessionId: 'session-1',
      routeBinding: null,
    });

    assert.notEqual(a, b);
  });
});

// ─── shouldCancelForTurnContextChange ───────────────────────────────────

describe('shouldCancelForTurnContextChange — context change detection', () => {
  it('does not cancel when active schedule is aligning its own session bootstrap', () => {
    const activeSchedule = buildLocalChatTurnContextSnapshot({
      targetId: 'agent-1',
      sessionId: 'session-1',
      routeBinding: null,
    });

    const shouldCancel = shouldCancelForTurnContextChange({
      previous: buildLocalChatTurnContextSnapshot({
        targetId: 'agent-1',
        sessionId: '',
        routeBinding: null,
      }),
      next: activeSchedule,
      activeSchedule,
    });

    assert.equal(shouldCancel, false);
  });

  it('cancels when target switches away from active schedule target', () => {
    const activeSchedule = buildLocalChatTurnContextSnapshot({
      targetId: 'agent-1',
      sessionId: 'session-1',
      routeBinding: null,
    });

    const shouldCancel = shouldCancelForTurnContextChange({
      previous: activeSchedule,
      next: buildLocalChatTurnContextSnapshot({
        targetId: 'agent-2',
        sessionId: 'session-2',
        routeBinding: null,
      }),
      activeSchedule,
    });

    assert.equal(shouldCancel, true);
  });

  it('does not cancel when route binding changes on the same target', () => {
    const activeSchedule = buildLocalChatTurnContextSnapshot({
      targetId: 'agent-1',
      sessionId: 'session-1',
      routeBinding: {
        source: 'token-api',
        connectorId: 'openai',
        model: 'gpt-5-mini',
      },
    });

    const shouldCancel = shouldCancelForTurnContextChange({
      previous: activeSchedule,
      next: buildLocalChatTurnContextSnapshot({
        targetId: 'agent-1',
        sessionId: 'session-1',
        routeBinding: {
          source: 'token-api',
          connectorId: 'anthropic',
          model: 'claude-sonnet-4',
        },
      }),
      activeSchedule,
    });

    assert.equal(shouldCancel, false);
  });

  it('cancels when the same target switches to a different session', () => {
    const activeSchedule = buildLocalChatTurnContextSnapshot({
      targetId: 'agent-1',
      sessionId: 'session-1',
      routeBinding: null,
    });

    const shouldCancel = shouldCancelForTurnContextChange({
      previous: activeSchedule,
      next: buildLocalChatTurnContextSnapshot({
        targetId: 'agent-1',
        sessionId: 'session-2',
        routeBinding: null,
      }),
      activeSchedule,
    });

    assert.equal(shouldCancel, true);
  });

  it('does not cancel when previous is null (initial state)', () => {
    const shouldCancel = shouldCancelForTurnContextChange({
      previous: null,
      next: buildLocalChatTurnContextSnapshot({
        targetId: 'agent-1',
        sessionId: 'session-1',
        routeBinding: null,
      }),
      activeSchedule: null,
    });

    assert.equal(shouldCancel, false);
  });
});
