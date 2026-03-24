import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorldAgent, WorldDetailWithAgents } from '../world-browser/world-browser-data.js';
import type { ChatMessage } from '@renderer/app-shell/app-store.js';

const mockStreamPlatformChatResponse = vi.fn();

vi.mock('@nimiplatform/nimi-kit/features/chat/runtime', () => ({
  streamPlatformChatResponse: (...args: unknown[]) => mockStreamPlatformChatResponse(...args),
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
    mockStreamPlatformChatResponse.mockReset();
  });

  it('builds conversation input from messages history and current userMessage', async () => {
    mockStreamPlatformChatResponse.mockImplementation(async (_request, handlers) => {
      handlers?.onDelta?.('Hello', { type: 'delta', text: 'Hello' });
      return { text: 'Hello', finish: { type: 'finish', finishReason: 'stop', usage: {}, trace: {} } };
    });

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

    expect(mockStreamPlatformChatResponse).toHaveBeenCalledTimes(1);
    const callArgs = mockStreamPlatformChatResponse.mock.calls[0]![0];
    expect(callArgs.input).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Greetings traveler' },
      { role: 'user', content: 'Tell me about the tower' },
    ]);
  });

  it('calls runtime.ai.text.stream with correct params', async () => {
    mockStreamPlatformChatResponse.mockResolvedValue({
      text: '',
      finish: { type: 'finish', finishReason: 'stop', usage: {}, trace: {} },
    });

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

    const callArgs = mockStreamPlatformChatResponse.mock.calls[0]![0];
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
    mockStreamPlatformChatResponse.mockImplementation(async (_request, handlers) => {
      handlers?.onDelta?.('Hello ', { type: 'delta', text: 'Hello ' });
      handlers?.onDelta?.('traveler', { type: 'delta', text: 'traveler' });
      return { text: 'Hello traveler', finish: { type: 'finish', finishReason: 'stop', usage: {}, trace: {} } };
    });

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
    mockStreamPlatformChatResponse.mockImplementation(async (_request, handlers) => {
      handlers?.onDelta?.('The tower ', { type: 'delta', text: 'The tower ' });
      handlers?.onDelta?.('stands tall', { type: 'delta', text: 'stands tall' });
      return { text: 'The tower stands tall', finish: { type: 'finish', finishReason: 'stop', usage: {}, trace: {} } };
    });

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
    mockStreamPlatformChatResponse.mockImplementation(async (_request, handlers) => {
      handlers?.onDelta?.('partial', { type: 'delta', text: 'partial' });
      handlers?.onError?.(new Error('model overloaded'), { type: 'error', error: new Error('model overloaded') });
      throw new Error('model overloaded');
    });

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
    mockStreamPlatformChatResponse.mockRejectedValue(new Error('network failure'));

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

    mockStreamPlatformChatResponse.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

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

    mockStreamPlatformChatResponse.mockImplementation(async (_request, handlers) => {
      handlers?.onDelta?.('First ', { type: 'delta', text: 'First ' });
      ac.abort();
      handlers?.onDelta?.('Second', { type: 'delta', text: 'Second' });
      return { text: 'First Second', finish: { type: 'finish', finishReason: 'stop', usage: {}, trace: {} } };
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
