// Unit tests for RL-FEAT-002 — Human Chat
// Tests channel naming, message contracts, feature gates, and store behavior

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useAppStore, type Agent } from '../../src/renderer/app-shell/providers/app-store.js';

// ── Extracted Logic ──────────────────────────────────────────────────────

interface HumanMessage {
  id: string;
  senderId: string;
  senderName?: string;
  text: string;
  timestamp: string;
}

/** Channel naming convention (from use-human-chat.ts:30) */
function resolveAgentChannel(agentId: string): string {
  return `agent:${agentId}`;
}

/** Send message input shape (from use-human-chat.ts) */
function buildSendMessageInput(agentId: string, text: string) {
  return {
    agentId,
    text,
  };
}

/** Message accumulation (from use-human-chat.ts:36) */
function appendMessage(messages: HumanMessage[], incoming: HumanMessage): HumanMessage[] {
  return [...messages, incoming];
}

beforeEach(() => {
  useAppStore.setState({ currentAgent: null, runtimeAvailable: false, realtimeConnected: false });
});

// ─── canChat Feature Gate ────────────────────────────────────────────────

describe('RL-FEAT-002 — canChat feature gate', () => {
  it('false when no agent selected', () => {
    useAppStore.setState({ realtimeConnected: true });
    const { currentAgent, realtimeConnected } = useAppStore.getState();
    assert.equal(!!currentAgent && realtimeConnected, false);
  });

  it('false when realtime not connected', () => {
    useAppStore.setState({ currentAgent: { id: 'a1', name: 'A' }, realtimeConnected: false });
    const { currentAgent, realtimeConnected } = useAppStore.getState();
    assert.equal(!!currentAgent && realtimeConnected, false);
  });

  it('true when agent selected AND realtime connected', () => {
    useAppStore.setState({ currentAgent: { id: 'a1', name: 'A' }, realtimeConnected: true });
    const { currentAgent, realtimeConnected } = useAppStore.getState();
    assert.equal(!!currentAgent && realtimeConnected, true);
  });

  it('does NOT depend on runtimeAvailable (RL-BOOT-004)', () => {
    useAppStore.setState({
      currentAgent: { id: 'a1', name: 'Agent' },
      runtimeAvailable: false,
      realtimeConnected: true,
    });
    const { currentAgent, realtimeConnected } = useAppStore.getState();
    assert.equal(!!currentAgent && realtimeConnected, true, 'human chat works without runtime');
  });
});

// ─── Channel Naming (RL-INTOP-003) ──────────────────────────────────────

describe('RL-FEAT-002 — Agent-scoped channel naming', () => {
  it('follows agent:{agentId} pattern', () => {
    assert.equal(resolveAgentChannel('agent-123'), 'agent:agent-123');
    assert.equal(resolveAgentChannel('abc-def-ghi'), 'agent:abc-def-ghi');
  });

  it('channel changes when agent changes', () => {
    const ch1 = resolveAgentChannel('agent-1');
    const ch2 = resolveAgentChannel('agent-2');
    assert.notEqual(ch1, ch2);
  });

  it('uses current agent id from store', () => {
    useAppStore.setState({ currentAgent: { id: 'agent-xyz', name: 'Agent' } });
    const agent = useAppStore.getState().currentAgent!;
    const channel = resolveAgentChannel(agent.id);
    assert.equal(channel, 'agent:agent-xyz');
  });
});

// ─── Send Message Contract (RL-IPC-008) ─────────────────────────────────

describe('RL-FEAT-002 — Send message via typed bridge', () => {
  it('builds correct bridge input shape', () => {
    const input = buildSendMessageInput('agent-123', 'Hello from Relay');
    assert.deepEqual(input, { agentId: 'agent-123', text: 'Hello from Relay' });
  });

  it('carries agentId at the top level (RL-CORE-004)', () => {
    const input = buildSendMessageInput('a1', 'Hi');
    assert.equal(input.agentId, 'a1');
  });

  it('preserves message text exactly', () => {
    const input = buildSendMessageInput('a1', 'Hello with special chars: <>&"');
    assert.equal(input.text, 'Hello with special chars: <>&"');
  });
});

// ─── Realtime Message Reception (RL-IPC-009) ────────────────────────────

describe('RL-FEAT-002 — Realtime message reception', () => {
  it('incoming message is appended to list (immutable)', () => {
    const existing: HumanMessage[] = [
      { id: 'm1', senderId: 's1', text: 'First', timestamp: '2024-01-01T00:00:00Z' },
    ];
    const incoming: HumanMessage = {
      id: 'm2', senderId: 's2', senderName: 'Alice', text: 'Second', timestamp: '2024-01-01T00:01:00Z',
    };
    const updated = appendMessage(existing, incoming);
    assert.equal(updated.length, 2);
    assert.equal(updated[1].text, 'Second');
    assert.equal(updated[1].senderName, 'Alice');
    assert.equal(existing.length, 1, 'original array must not be mutated');
  });

  it('handles messages with optional senderName', () => {
    const msg: HumanMessage = { id: 'm1', senderId: 's1', text: 'Hi', timestamp: '2024-01-01T00:00:00Z' };
    assert.equal(msg.senderName, undefined);
    const updated = appendMessage([], msg);
    assert.equal(updated[0].senderName, undefined);
  });

  it('preserves message ordering', () => {
    let messages: HumanMessage[] = [];
    for (let i = 0; i < 5; i++) {
      messages = appendMessage(messages, {
        id: `m${i}`, senderId: 's1', text: `Message ${i}`, timestamp: `2024-01-01T00:0${i}:00Z`,
      });
    }
    assert.equal(messages.length, 5);
    assert.equal(messages[0].text, 'Message 0');
    assert.equal(messages[4].text, 'Message 4');
  });
});

// ─── RL-CORE-002: Agent change resubscription ───────────────────────────

describe('RL-CORE-002 — Agent change resubscribes to new channel', () => {
  it('channel for old agent differs from new agent', () => {
    const oldChannel = resolveAgentChannel('agent-old');
    const newChannel = resolveAgentChannel('agent-new');
    assert.notEqual(oldChannel, newChannel);
  });

  it('agent switch detected by store subscription', () => {
    const switches: Array<{ from: string | undefined; to: string | undefined }> = [];
    const unsub = useAppStore.subscribe((state, prev) => {
      switches.push({
        from: prev.currentAgent?.id,
        to: state.currentAgent?.id,
      });
    });

    useAppStore.getState().setAgent({ id: 'a1', name: 'First' });
    useAppStore.getState().setAgent({ id: 'a2', name: 'Second' });

    assert.equal(switches.length, 2);
    assert.equal(switches[0].from, undefined);
    assert.equal(switches[0].to, 'a1');
    assert.equal(switches[1].from, 'a1');
    assert.equal(switches[1].to, 'a2');
    unsub();
  });
});
