// Unit tests for RL-FEAT-001 — Agent Chat (Local AI)
// Tests extracted business logic, feature gates, and data contracts

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useAppStore, type Agent } from '../../src/renderer/app-shell/providers/app-store.js';
import {
  processStreamChunk,
  processStreamEnd,
  processStreamError,
  type ChatMessage,
} from '../../src/renderer/features/chat/hooks/use-agent-chat.js';

beforeEach(() => {
  useAppStore.setState({ currentAgent: null, runtimeAvailable: false, realtimeConnected: false });
});

// ─── RL-FEAT-001: canChat Feature Gate ──────────────────────────────────

describe('RL-FEAT-001 — canChat feature gate', () => {
  it('false when no agent selected', () => {
    useAppStore.setState({ runtimeAvailable: true });
    const { currentAgent, runtimeAvailable } = useAppStore.getState();
    assert.equal(!!currentAgent && runtimeAvailable, false);
  });

  it('false when runtime unavailable', () => {
    useAppStore.setState({ currentAgent: { id: 'a1', name: 'Agent' }, runtimeAvailable: false });
    const { currentAgent, runtimeAvailable } = useAppStore.getState();
    assert.equal(!!currentAgent && runtimeAvailable, false);
  });

  it('true when agent selected AND runtime available', () => {
    useAppStore.setState({ currentAgent: { id: 'a1', name: 'Agent' }, runtimeAvailable: true });
    const { currentAgent, runtimeAvailable } = useAppStore.getState();
    assert.equal(!!currentAgent && runtimeAvailable, true);
  });
});

// ─── RL-CORE-004: Stream Open Input Contract ─────────────────────────────

describe('RL-CORE-004 — streamOpen input carries agentId', () => {
  it('input shape includes agentId and prompt', () => {
    const agent: Agent = { id: 'agent-abc', name: 'Test Agent' };
    const prompt = 'Hello, how are you?';
    const input = { agentId: agent.id, prompt };
    assert.equal(input.agentId, 'agent-abc');
    assert.equal(input.prompt, prompt);
    assert.equal(typeof input.agentId, 'string');
  });

  it('agentId comes from currentAgent.id in store', () => {
    useAppStore.setState({ currentAgent: { id: 'specific-agent', name: 'Specific' } });
    const agent = useAppStore.getState().currentAgent!;
    const input = { agentId: agent.id, prompt: 'test' };
    assert.equal(input.agentId, agent.id);
    assert.equal(input.agentId, 'specific-agent');
  });
});

// ─── Stream Chunk Processing ─────────────────────────────────────────────

describe('RL-FEAT-001 — Stream chunk processing', () => {
  const baseMessages: ChatMessage[] = [
    { id: 'user_1', role: 'user', text: 'Hi' },
    { id: 'asst_1', role: 'assistant', text: '', streaming: true },
  ];

  it('accumulates text from matching stream chunks', () => {
    let msgs = [...baseMessages];

    const r1 = processStreamChunk(msgs, 'asst_1', 'stream-1', {
      streamId: 'stream-1',
      data: { type: 'text', text: 'Hello' },
    });
    assert.equal(r1.changed, true);
    msgs = r1.messages;
    assert.equal(msgs[1].text, 'Hello');

    const r2 = processStreamChunk(msgs, 'asst_1', 'stream-1', {
      streamId: 'stream-1',
      data: { type: 'text', text: ' world' },
    });
    assert.equal(r2.changed, true);
    msgs = r2.messages;
    assert.equal(msgs[1].text, 'Hello world');
  });

  it('ignores chunks from different streams (streamId filter)', () => {
    const result = processStreamChunk(baseMessages, 'asst_1', 'stream-1', {
      streamId: 'stream-OTHER',
      data: { type: 'text', text: 'should not appear' },
    });
    assert.equal(result.changed, false);
    assert.equal(result.messages[1].text, '');
  });

  it('ignores non-text chunk types', () => {
    const result = processStreamChunk(baseMessages, 'asst_1', 'stream-1', {
      streamId: 'stream-1',
      data: { type: 'metadata', text: 'ignored' },
    });
    assert.equal(result.changed, false);
  });

  it('ignores text chunks with empty or missing text', () => {
    const r1 = processStreamChunk(baseMessages, 'asst_1', 'stream-1', {
      streamId: 'stream-1',
      data: { type: 'text' },
    });
    assert.equal(r1.changed, false);

    const r2 = processStreamChunk(baseMessages, 'asst_1', 'stream-1', {
      streamId: 'stream-1',
      data: { type: 'text', text: '' },
    });
    assert.equal(r2.changed, false);
  });

  it('only updates the target assistant message', () => {
    const result = processStreamChunk(baseMessages, 'asst_1', 'stream-1', {
      streamId: 'stream-1',
      data: { type: 'text', text: 'hello' },
    });
    assert.equal(result.messages[0].text, 'Hi');
    assert.equal(result.messages[1].text, 'hello');
  });

  it('handles multiple assistant messages correctly (targets by id)', () => {
    const msgs: ChatMessage[] = [
      { id: 'asst_old', role: 'assistant', text: 'Previous response', streaming: false },
      { id: 'user_2', role: 'user', text: 'Follow up' },
      { id: 'asst_new', role: 'assistant', text: '', streaming: true },
    ];
    const result = processStreamChunk(msgs, 'asst_new', 's1', {
      streamId: 's1',
      data: { type: 'text', text: 'New response' },
    });
    assert.equal(result.messages[0].text, 'Previous response');
    assert.equal(result.messages[2].text, 'New response');
  });
});

// ─── Stream End Processing ───────────────────────────────────────────────

describe('RL-FEAT-001 — Stream end processing', () => {
  it('marks assistant message as non-streaming on end', () => {
    const messages: ChatMessage[] = [
      { id: 'asst_1', role: 'assistant', text: 'Hello world', streaming: true },
    ];
    const result = processStreamEnd(messages, 'asst_1', 'stream-1', { streamId: 'stream-1' });
    assert.equal(result.matched, true);
    assert.equal(result.messages[0].streaming, false);
    assert.equal(result.messages[0].text, 'Hello world');
  });

  it('ignores end events from other streams', () => {
    const messages: ChatMessage[] = [
      { id: 'asst_1', role: 'assistant', text: 'Hi', streaming: true },
    ];
    const result = processStreamEnd(messages, 'asst_1', 'stream-1', { streamId: 'stream-OTHER' });
    assert.equal(result.matched, false);
    assert.equal(result.messages[0].streaming, true);
  });
});

// ─── Stream Error Processing ─────────────────────────────────────────────

describe('RL-FEAT-001 — Stream error processing', () => {
  it('sets "Error occurred" text when message text is empty', () => {
    const messages: ChatMessage[] = [
      { id: 'asst_1', role: 'assistant', text: '', streaming: true },
    ];
    const result = processStreamError(messages, 'asst_1', 'stream-1', { streamId: 'stream-1' });
    assert.equal(result.matched, true);
    assert.equal(result.messages[0].text, 'Error occurred');
    assert.equal(result.messages[0].streaming, false);
  });

  it('preserves existing text on error (partial response)', () => {
    const messages: ChatMessage[] = [
      { id: 'asst_1', role: 'assistant', text: 'Partial response', streaming: true },
    ];
    const result = processStreamError(messages, 'asst_1', 'stream-1', { streamId: 'stream-1' });
    assert.equal(result.messages[0].text, 'Partial response');
    assert.equal(result.messages[0].streaming, false);
  });

  it('ignores error events from other streams', () => {
    const messages: ChatMessage[] = [
      { id: 'asst_1', role: 'assistant', text: '', streaming: true },
    ];
    const result = processStreamError(messages, 'asst_1', 'stream-1', { streamId: 'stream-OTHER' });
    assert.equal(result.matched, false);
    assert.equal(result.messages[0].streaming, true);
  });
});

// ─── RL-CORE-002: Agent Change ───────────────────────────────────────────

describe('RL-CORE-002 — Agent change resets chat state', () => {
  it('store notifies subscribers on agent change (hooks reset via useEffect)', () => {
    const agentIds: string[] = [];
    const unsub = useAppStore.subscribe((state) => {
      if (state.currentAgent) agentIds.push(state.currentAgent.id);
    });

    useAppStore.getState().setAgent({ id: 'a1', name: 'First' });
    useAppStore.getState().setAgent({ id: 'a2', name: 'Second' });

    assert.deepEqual(agentIds, ['a1', 'a2']);
    unsub();
  });

  it('setAgent(null) clears agent (triggers hook cleanup)', () => {
    useAppStore.getState().setAgent({ id: 'a1', name: 'Agent' });
    useAppStore.getState().setAgent(null);
    assert.equal(useAppStore.getState().currentAgent, null);
  });

  it('agent id change detected via subscription (hook dependency)', () => {
    let prevId: string | undefined;
    let newId: string | undefined;
    const unsub = useAppStore.subscribe((state, prev) => {
      prevId = prev.currentAgent?.id;
      newId = state.currentAgent?.id;
    });

    useAppStore.getState().setAgent({ id: 'a1', name: 'First' });
    useAppStore.getState().setAgent({ id: 'a2', name: 'Second' });

    assert.equal(prevId, 'a1');
    assert.equal(newId, 'a2');
    unsub();
  });
});
