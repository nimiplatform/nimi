import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorldAgent, WorldDetailWithAgents } from '../world-browser/world-browser-data.js';
import type { ChatMessage } from '@renderer/app-shell/app-store.js';

const mockStream = vi.fn();

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    runtime: {
      ai: {
        text: {
          stream: (...args: unknown[]) => mockStream(...args),
        },
      },
    },
  }),
}));

import { buildSystemPrompt, streamAgentChat } from './chat-stream.js';

describe('buildSystemPrompt', () => {
  const agent: WorldAgent = {
    id: 'a1',
    name: 'Gandara',
    bio: 'Wise wizard of the northern tower',
  };

  const world: WorldDetailWithAgents = {
    id: 'w1',
    name: 'Eldoria',
    description: 'A mystical fantasy realm',
    genre: 'Fantasy',
    era: 'Medieval',
    agents: [agent],
  };

  it('includes agent name and world name', () => {
    const prompt = buildSystemPrompt(agent, world);
    expect(prompt).toContain('Gandara');
    expect(prompt).toContain('Eldoria');
  });

  it('includes agent bio', () => {
    const prompt = buildSystemPrompt(agent, world);
    expect(prompt).toContain('Wise wizard of the northern tower');
  });

  it('includes world context', () => {
    const prompt = buildSystemPrompt(agent, world);
    expect(prompt).toContain('A mystical fantasy realm');
    expect(prompt).toContain('Genre: Fantasy');
    expect(prompt).toContain('Era: Medieval');
  });

  it('includes in-character instruction', () => {
    const prompt = buildSystemPrompt(agent, world);
    expect(prompt).toContain('Stay in character');
  });

  it('includes in-character instruction matching spec', () => {
    const prompt = buildSystemPrompt(agent, world);
    expect(prompt).toContain('Stay in character. Respond as this character would within the context of this world.');
  });

  it('includes world description with correct format', () => {
    const prompt = buildSystemPrompt(agent, world);
    expect(prompt).toContain('World description: A mystical fantasy realm');
  });

  it('handles agent without bio', () => {
    const noBioAgent: WorldAgent = { id: 'a2', name: 'Silent One' };
    const prompt = buildSystemPrompt(noBioAgent, world);
    expect(prompt).toContain('Silent One');
    // Bio should not appear in any form
    expect(prompt).not.toContain('Wise wizard');
  });
});

describe('streamAgentChat', () => {
  const agent: WorldAgent = {
    id: 'a1',
    name: 'Gandara',
    bio: 'Wise wizard of the northern tower',
  };

  const world: WorldDetailWithAgents = {
    id: 'w1',
    name: 'Eldoria',
    description: 'A mystical fantasy realm',
    genre: 'Fantasy',
    era: 'Medieval',
    agents: [agent],
  };

  const existingMessages: ChatMessage[] = [
    { id: 'm1', role: 'user', content: 'Hello', timestamp: 1000 },
    { id: 'm2', role: 'assistant', content: 'Greetings traveler', timestamp: 1001 },
  ];

  beforeEach(() => {
    mockStream.mockReset();
  });

  function makeAsyncIterable(parts: Array<{ type: string; text?: string; error?: string }>) {
    return {
      stream: (async function* () {
        for (const part of parts) {
          yield part;
        }
      })(),
    };
  }

  it('builds conversation input from messages history and current userMessage', async () => {
    mockStream.mockResolvedValue(makeAsyncIterable([
      { type: 'delta', text: 'Hello' },
      { type: 'finish' },
    ]));

    const ac = new AbortController();
    await streamAgentChat({
      agent,
      world,
      messages: existingMessages,
      userMessage: 'Tell me about the tower',
      signal: ac.signal,
      onDelta: vi.fn(),
      onFinish: vi.fn(),
      onError: vi.fn(),
    });

    expect(mockStream).toHaveBeenCalledTimes(1);
    const callArgs = mockStream.mock.calls[0]![0];
    expect(callArgs.input).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Greetings traveler' },
      { role: 'user', content: 'Tell me about the tower' },
    ]);
  });

  it('calls runtime.ai.text.stream with correct params', async () => {
    mockStream.mockResolvedValue(makeAsyncIterable([
      { type: 'finish' },
    ]));

    const ac = new AbortController();
    await streamAgentChat({
      agent,
      world,
      messages: [],
      userMessage: 'Hi',
      signal: ac.signal,
      onDelta: vi.fn(),
      onFinish: vi.fn(),
      onError: vi.fn(),
    });

    const callArgs = mockStream.mock.calls[0]![0];
    expect(callArgs.model).toBe('auto');
    expect(callArgs.route).toBe('cloud');
    expect(callArgs.metadata).toEqual({
      surfaceId: 'realm-drift',
      extra: JSON.stringify({ worldId: 'w1', agentId: 'a1' }),
    });
    expect(callArgs.system).toBeTruthy();
    expect(callArgs.signal).toBe(ac.signal);
  });

  it('calls onDelta with incremental delta text on delta parts', async () => {
    mockStream.mockResolvedValue(makeAsyncIterable([
      { type: 'delta', text: 'Hello ' },
      { type: 'delta', text: 'traveler' },
      { type: 'finish' },
    ]));

    const onDelta = vi.fn();
    const ac = new AbortController();

    await streamAgentChat({
      agent,
      world,
      messages: [],
      userMessage: 'Hi',
      signal: ac.signal,
      onDelta,
      onFinish: vi.fn(),
      onError: vi.fn(),
    });

    expect(onDelta).toHaveBeenCalledTimes(2);
    expect(onDelta).toHaveBeenNthCalledWith(1, 'Hello ');
    expect(onDelta).toHaveBeenNthCalledWith(2, 'traveler');
  });

  it('calls onFinish with full text on stream end', async () => {
    mockStream.mockResolvedValue(makeAsyncIterable([
      { type: 'delta', text: 'The tower ' },
      { type: 'delta', text: 'stands tall' },
      { type: 'finish' },
    ]));

    const onFinish = vi.fn();
    const ac = new AbortController();

    await streamAgentChat({
      agent,
      world,
      messages: [],
      userMessage: 'Tell me',
      signal: ac.signal,
      onDelta: vi.fn(),
      onFinish,
      onError: vi.fn(),
    });

    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith('The tower stands tall');
  });

  it('calls onError on stream error part', async () => {
    mockStream.mockResolvedValue(makeAsyncIterable([
      { type: 'delta', text: 'partial' },
      { type: 'error', error: 'model overloaded' },
    ]));

    const onError = vi.fn();
    const ac = new AbortController();

    await streamAgentChat({
      agent,
      world,
      messages: [],
      userMessage: 'Hi',
      signal: ac.signal,
      onDelta: vi.fn(),
      onFinish: vi.fn(),
      onError,
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0]![0].message).toBe('model overloaded');
  });

  it('calls onError when stream call throws', async () => {
    mockStream.mockRejectedValue(new Error('network failure'));

    const onError = vi.fn();
    const ac = new AbortController();

    await streamAgentChat({
      agent,
      world,
      messages: [],
      userMessage: 'Hi',
      signal: ac.signal,
      onDelta: vi.fn(),
      onFinish: vi.fn(),
      onError,
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0].message).toBe('network failure');
  });

  it('does not call callbacks when signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();

    mockStream.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    const onDelta = vi.fn();
    const onFinish = vi.fn();
    const onError = vi.fn();

    await streamAgentChat({
      agent,
      world,
      messages: [],
      userMessage: 'Hi',
      signal: ac.signal,
      onDelta,
      onFinish,
      onError,
    });

    expect(onDelta).not.toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('stops calling onDelta when signal is aborted mid-stream', async () => {
    const ac = new AbortController();
    const onDelta = vi.fn();
    const onFinish = vi.fn();

    mockStream.mockResolvedValue({
      stream: (async function* () {
        yield { type: 'delta', text: 'First ' };
        ac.abort();
        yield { type: 'delta', text: 'Second' };
        yield { type: 'finish' };
      })(),
    });

    await streamAgentChat({
      agent,
      world,
      messages: [],
      userMessage: 'Hi',
      signal: ac.signal,
      onDelta,
      onFinish,
      onError: vi.fn(),
    });

    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(onDelta).toHaveBeenCalledWith('First ');
    expect(onFinish).not.toHaveBeenCalled();
  });
});
