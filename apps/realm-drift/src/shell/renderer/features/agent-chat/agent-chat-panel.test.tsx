import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'chat.placeholder': 'Type a message...',
        'chat.send': 'Send',
        'chat.emptyState': 'Select an agent to start chatting',
        'chat.streaming': 'Thinking...',
        'chat.agentEmpty': 'No agents available',
        'viewer.tabAgents': 'Agents',
      };
      return map[key] ?? key;
    },
  }),
}));

import type { AgentChatState } from '@renderer/app-shell/app-store.js';
import type { WorldAgent, WorldDetailWithAgents } from '../world-browser/world-browser-data.js';

const mockStore = {
  activeChat: null as AgentChatState | null,
  setActiveChat: vi.fn(),
  appendChatMessage: vi.fn(),
  setStreamingState: vi.fn(),
};

vi.mock('@renderer/app-shell/app-store.js', () => ({
  useAppStore: (selector: (s: typeof mockStore) => unknown) => selector(mockStore),
}));

const mockStreamAgentChat = vi.fn();
vi.mock('./chat-stream.js', () => ({
  streamAgentChat: (...args: unknown[]) => mockStreamAgentChat(...args),
}));

vi.mock('@renderer/infra/ulid.js', () => ({
  generateId: () => 'test-ulid-1',
}));

import { AgentChatPanel } from './agent-chat-panel.js';

function makeAgent(overrides: Partial<WorldAgent> & { id: string; name: string }): WorldAgent {
  return { ...overrides };
}

function makeWorld(agents: WorldAgent[]): WorldDetailWithAgents {
  return {
    id: 'world-1',
    name: 'Test World',
    description: 'A world for testing',
    agents,
  };
}

// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

describe('AgentChatPanel', () => {
  const agents = [
    makeAgent({ id: 'a1', name: 'Sage', bio: 'A wise scholar' }),
    makeAgent({ id: 'a2', name: 'Warrior', bio: 'A fierce fighter' }),
  ];
  const world = makeWorld(agents);

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.activeChat = null;
  });

  it('renders agent list when no active chat', () => {
    render(<AgentChatPanel agents={agents} world={world} />);

    expect(screen.getByText('Sage')).toBeDefined();
    expect(screen.getByText('Warrior')).toBeDefined();
    expect(screen.getByText('Agents')).toBeDefined();
  });

  it('shows chat interface when agent is selected', () => {
    mockStore.activeChat = {
      worldId: 'world-1',
      agentId: 'a1',
      agentName: 'Sage',
      messages: [],
      streaming: false,
      partialText: '',
    };

    render(<AgentChatPanel agents={agents} world={world} />);

    // Agent name displayed in chat header
    expect(screen.getByText('Sage')).toBeDefined();
    // Chat input should be present
    expect(screen.getByPlaceholderText('Type a message...')).toBeDefined();
    // Send button should be present
    expect(screen.getByText('Send')).toBeDefined();
  });

  it('calls setActiveChat when agent is selected from list', () => {
    render(<AgentChatPanel agents={agents} world={world} />);

    const buttons = screen.getAllByRole('button');
    // Click the first agent button (Sage)
    fireEvent.click(buttons[0]!);

    expect(mockStore.setActiveChat).toHaveBeenCalledOnce();
    expect(mockStore.setActiveChat).toHaveBeenCalledWith({
      worldId: 'world-1',
      agentId: 'a1',
      agentName: 'Sage',
      messages: [],
      streaming: false,
      partialText: '',
    });
  });

  it('renders existing messages', () => {
    mockStore.activeChat = {
      worldId: 'world-1',
      agentId: 'a1',
      agentName: 'Sage',
      messages: [
        { id: 'msg-1', role: 'user', content: 'Hello there!', timestamp: 1000 },
        { id: 'msg-2', role: 'assistant', content: 'Greetings, traveler.', timestamp: 2000 },
      ],
      streaming: false,
      partialText: '',
    };

    render(<AgentChatPanel agents={agents} world={world} />);

    expect(screen.getByText('Hello there!')).toBeDefined();
    expect(screen.getByText('Greetings, traveler.')).toBeDefined();
  });

  it('send button is disabled when input is empty', () => {
    mockStore.activeChat = {
      worldId: 'world-1',
      agentId: 'a1',
      agentName: 'Sage',
      messages: [],
      streaming: false,
      partialText: '',
    };

    render(<AgentChatPanel agents={agents} world={world} />);

    const sendButton = screen.getByText('Send');
    expect(sendButton).toBeDefined();
    expect((sendButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends message on Enter key', () => {
    mockStore.activeChat = {
      worldId: 'world-1',
      agentId: 'a1',
      agentName: 'Sage',
      messages: [],
      streaming: false,
      partialText: '',
    };

    render(<AgentChatPanel agents={agents} world={world} />);

    const textarea = screen.getByPlaceholderText('Type a message...');
    fireEvent.change(textarea, { target: { value: 'Hello Sage' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(mockStore.appendChatMessage).toHaveBeenCalledOnce();
    expect(mockStore.appendChatMessage).toHaveBeenCalledWith({
      id: 'test-ulid-1',
      role: 'user',
      content: 'Hello Sage',
      timestamp: expect.any(Number),
    });

    expect(mockStore.setStreamingState).toHaveBeenCalledWith(true, '');
    expect(mockStreamAgentChat).toHaveBeenCalledOnce();
    expect(mockStreamAgentChat).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: agents[0],
        world,
        userMessage: 'Hello Sage',
      }),
    );
  });

  it('disables send during streaming', () => {
    mockStore.activeChat = {
      worldId: 'world-1',
      agentId: 'a1',
      agentName: 'Sage',
      messages: [
        { id: 'msg-1', role: 'user', content: 'Hello', timestamp: 1000 },
      ],
      streaming: true,
      partialText: '',
    };

    render(<AgentChatPanel agents={agents} world={world} />);

    const sendButton = screen.getByText('Send');
    expect((sendButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows streaming indicator', () => {
    mockStore.activeChat = {
      worldId: 'world-1',
      agentId: 'a1',
      agentName: 'Sage',
      messages: [
        { id: 'msg-1', role: 'user', content: 'Tell me about the world', timestamp: 1000 },
      ],
      streaming: true,
      partialText: 'The world is vast and',
    };

    render(<AgentChatPanel agents={agents} world={world} />);

    // Partial text should be rendered
    expect(screen.getByText('The world is vast and', { exact: false })).toBeDefined();
  });

  it('clears chat when switching agents', () => {
    mockStore.activeChat = {
      worldId: 'world-1',
      agentId: 'a1',
      agentName: 'Sage',
      messages: [
        { id: 'msg-1', role: 'user', content: 'Hello', timestamp: 1000 },
      ],
      streaming: false,
      partialText: '',
    };

    render(<AgentChatPanel agents={agents} world={world} />);

    // Click the back button to go back to agent list
    const backButton = screen.getByText('←');
    fireEvent.click(backButton);

    expect(mockStore.setActiveChat).toHaveBeenCalledWith(null);
  });
});
