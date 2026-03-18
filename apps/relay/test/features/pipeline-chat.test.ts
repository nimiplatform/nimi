// Unit tests for pipeline chat store (RL-PIPE-001)

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useChatStore, type ChatMessage, type TurnSendPhase } from '../../src/renderer/app-shell/providers/chat-store.js';

// Reset store between tests
beforeEach(() => {
  useChatStore.setState({
    messages: [],
    sendPhase: 'idle',
    statusBanner: null,
    promptTrace: null,
    turnAudit: null,
  });
});

// ─── Initial state ──────────────────────────────────────────────────────

describe('RL-PIPE-001 — ChatStore initial state', () => {
  it('starts with idle sendPhase', () => {
    const state = useChatStore.getState();
    assert.equal(state.sendPhase, 'idle');
  });

  it('starts with empty messages', () => {
    const state = useChatStore.getState();
    assert.deepEqual(state.messages, []);
  });

  it('starts with null statusBanner', () => {
    const state = useChatStore.getState();
    assert.equal(state.statusBanner, null);
  });

  it('starts with null promptTrace', () => {
    const state = useChatStore.getState();
    assert.equal(state.promptTrace, null);
  });

  it('starts with null turnAudit', () => {
    const state = useChatStore.getState();
    assert.equal(state.turnAudit, null);
  });
});

// ─── setMessages ────────────────────────────────────────────────────────

describe('RL-PIPE-001 — ChatStore setMessages', () => {
  it('updates messages', () => {
    const msgs: ChatMessage[] = [
      { id: 'msg-1', role: 'user', kind: 'text', content: 'Hello', timestamp: new Date() },
      { id: 'msg-2', role: 'assistant', kind: 'text', content: 'Hi there', timestamp: new Date() },
    ];
    useChatStore.getState().setMessages(msgs);
    assert.equal(useChatStore.getState().messages.length, 2);
    assert.equal(useChatStore.getState().messages[0]?.content, 'Hello');
    assert.equal(useChatStore.getState().messages[1]?.content, 'Hi there');
  });

  it('replaces existing messages', () => {
    useChatStore.getState().setMessages([
      { id: 'msg-1', role: 'user', kind: 'text', content: 'First', timestamp: new Date() },
    ]);
    useChatStore.getState().setMessages([
      { id: 'msg-2', role: 'user', kind: 'text', content: 'Second', timestamp: new Date() },
    ]);
    assert.equal(useChatStore.getState().messages.length, 1);
    assert.equal(useChatStore.getState().messages[0]?.content, 'Second');
  });

  it('can set empty messages array', () => {
    useChatStore.getState().setMessages([
      { id: 'msg-1', role: 'user', kind: 'text', content: 'Hello', timestamp: new Date() },
    ]);
    useChatStore.getState().setMessages([]);
    assert.equal(useChatStore.getState().messages.length, 0);
  });
});

// ─── setSendPhase ───────────────────────────────────────────────────────

describe('RL-PIPE-001 — ChatStore setSendPhase', () => {
  it('transitions to awaiting-first-beat', () => {
    useChatStore.getState().setSendPhase('awaiting-first-beat');
    assert.equal(useChatStore.getState().sendPhase, 'awaiting-first-beat');
  });

  it('transitions to streaming-first-beat', () => {
    useChatStore.getState().setSendPhase('streaming-first-beat');
    assert.equal(useChatStore.getState().sendPhase, 'streaming-first-beat');
  });

  it('transitions to planning-tail', () => {
    useChatStore.getState().setSendPhase('planning-tail');
    assert.equal(useChatStore.getState().sendPhase, 'planning-tail');
  });

  it('transitions to delivering-tail', () => {
    useChatStore.getState().setSendPhase('delivering-tail');
    assert.equal(useChatStore.getState().sendPhase, 'delivering-tail');
  });

  it('transitions back to idle', () => {
    useChatStore.getState().setSendPhase('streaming-first-beat');
    useChatStore.getState().setSendPhase('idle');
    assert.equal(useChatStore.getState().sendPhase, 'idle');
  });

  it('walks through full beat-first turn lifecycle', () => {
    const phases: TurnSendPhase[] = [
      'awaiting-first-beat',
      'streaming-first-beat',
      'planning-tail',
      'delivering-tail',
      'idle',
    ];
    for (const phase of phases) {
      useChatStore.getState().setSendPhase(phase);
      assert.equal(useChatStore.getState().sendPhase, phase);
    }
  });
});

// ─── setStatusBanner ────────────────────────────────────────────────────

describe('RL-PIPE-001 — ChatStore setStatusBanner', () => {
  it('sets a warning banner', () => {
    useChatStore.getState().setStatusBanner({ kind: 'warning', message: 'Runtime slow' });
    const banner = useChatStore.getState().statusBanner;
    assert.equal(banner?.kind, 'warning');
    assert.equal(banner?.message, 'Runtime slow');
  });

  it('sets an error banner', () => {
    useChatStore.getState().setStatusBanner({ kind: 'error', message: 'Connection lost' });
    assert.equal(useChatStore.getState().statusBanner?.kind, 'error');
  });

  it('clears banner with null', () => {
    useChatStore.getState().setStatusBanner({ kind: 'info', message: 'test' });
    useChatStore.getState().setStatusBanner(null);
    assert.equal(useChatStore.getState().statusBanner, null);
  });
});

// ─── setPromptTrace / setTurnAudit ──────────────────────────────────────

describe('RL-PIPE-001 — ChatStore diagnostic state', () => {
  it('sets and clears promptTrace', () => {
    const trace = { layers: [], budget: { maxChars: 24000 } };
    useChatStore.getState().setPromptTrace(trace);
    assert.deepEqual(useChatStore.getState().promptTrace, trace);

    useChatStore.getState().setPromptTrace(null);
    assert.equal(useChatStore.getState().promptTrace, null);
  });

  it('sets and clears turnAudit', () => {
    const audit = { id: 'audit-1', targetId: 'agent-1', latencyMs: 120 };
    useChatStore.getState().setTurnAudit(audit);
    assert.deepEqual(useChatStore.getState().turnAudit, audit);

    useChatStore.getState().setTurnAudit(null);
    assert.equal(useChatStore.getState().turnAudit, null);
  });
});

// ─── clearChat ──────────────────────────────────────────────────────────

describe('RL-PIPE-001 — ChatStore clearChat', () => {
  it('resets all state to initial values', () => {
    // Set non-default values
    useChatStore.getState().setMessages([
      { id: 'msg-1', role: 'user', kind: 'text', content: 'Hello', timestamp: new Date() },
    ]);
    useChatStore.getState().setSendPhase('delivering-tail');
    useChatStore.getState().setStatusBanner({ kind: 'error', message: 'test' });
    useChatStore.getState().setPromptTrace({ test: true });
    useChatStore.getState().setTurnAudit({ id: 'audit-1' });

    // Clear
    useChatStore.getState().clearChat();

    const state = useChatStore.getState();
    assert.deepEqual(state.messages, []);
    assert.equal(state.sendPhase, 'idle');
    assert.equal(state.statusBanner, null);
    assert.equal(state.promptTrace, null);
    assert.equal(state.turnAudit, null);
  });
});

// ─── Subscriber notifications ───────────────────────────────────────────

describe('RL-PIPE-001 — ChatStore subscriber notifications', () => {
  it('notifies subscribers on phase change', () => {
    const phases: TurnSendPhase[] = [];
    const unsub = useChatStore.subscribe((state) => {
      phases.push(state.sendPhase);
    });

    useChatStore.getState().setSendPhase('awaiting-first-beat');
    useChatStore.getState().setSendPhase('streaming-first-beat');
    useChatStore.getState().setSendPhase('idle');

    assert.deepEqual(phases, ['awaiting-first-beat', 'streaming-first-beat', 'idle']);
    unsub();
  });

  it('notifies subscribers on message update', () => {
    let messageCount = 0;
    const unsub = useChatStore.subscribe((state) => {
      messageCount = state.messages.length;
    });

    useChatStore.getState().setMessages([
      { id: 'msg-1', role: 'user', kind: 'text', content: 'Hi', timestamp: new Date() },
      { id: 'msg-2', role: 'assistant', kind: 'text', content: 'Hello', timestamp: new Date() },
    ]);

    assert.equal(messageCount, 2);
    unsub();
  });
});
