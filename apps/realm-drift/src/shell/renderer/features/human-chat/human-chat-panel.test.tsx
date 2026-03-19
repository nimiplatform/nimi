import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'viewer.tabPeople': 'People',
        'humanChat.placeholder': 'Type a message...',
        'humanChat.send': 'Send',
        'humanChat.emptyState': 'Select a friend',
        'humanChat.openFailed': 'Failed to open chat',
        'humanChat.sendFailed': 'Failed to send',
        'humanChat.noFriends': 'No friends yet',
      };
      return map[key] ?? key;
    },
  }),
}));

const mockStore = {
  humanChats: {} as Record<string, { chatId: string; friendUserId: string; messages: Array<{ id: string; role: string; content: string; timestamp: number }> }>,
  activeHumanChat: null as { chatId: string; friendName: string; messages: Array<{ id: string; role: string; content: string; timestamp: number }>; loading: boolean } | null,
  setHumanChat: vi.fn(),
  setActiveHumanChat: vi.fn(),
  appendHumanChatMessage: vi.fn(),
  appendActiveHumanMessage: vi.fn(),
  updateHumanMessage: vi.fn(),
  removeHumanMessage: vi.fn(),
  auth: { user: { id: 'user-1' } },
};

vi.mock('@renderer/app-shell/app-store.js', () => ({
  useAppStore: Object.assign(
    (selector: (s: typeof mockStore) => unknown) => selector(mockStore),
    { getState: () => mockStore },
  ),
}));

const mockStartChat = vi.fn();
const mockListMessages = vi.fn();
const mockMarkChatRead = vi.fn();
const mockSendMessage = vi.fn();
vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    realm: {
      services: {
        HumanChatService: {
          startChat: (...args: unknown[]) => mockStartChat(...args),
          listMessages: (...args: unknown[]) => mockListMessages(...args),
          markChatRead: (...args: unknown[]) => mockMarkChatRead(...args),
          sendMessage: (...args: unknown[]) => mockSendMessage(...args),
        },
      },
    },
  }),
}));

vi.mock('@renderer/infra/ulid.js', () => ({
  generateId: () => 'test-msg-id',
}));

vi.mock('./friend-list.js', () => ({
  FriendList: ({ onSelectFriend }: { onSelectFriend: (f: { userId: string; displayName: string }) => void }) => (
    <div data-testid="friend-list">
      <button onClick={() => onSelectFriend({ userId: 'friend-1', displayName: 'Alice' })}>
        Alice
      </button>
    </div>
  ),
}));

// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

import { HumanChatPanel } from './human-chat-panel.js';

describe('HumanChatPanel', () => {
  beforeEach(() => {
    mockStore.humanChats = {};
    mockStore.activeHumanChat = null;
    mockStore.setHumanChat.mockClear();
    mockStore.setActiveHumanChat.mockClear();
    mockStore.appendHumanChatMessage.mockClear();
    mockStore.appendActiveHumanMessage.mockClear();
    mockStore.updateHumanMessage.mockClear();
    mockStore.removeHumanMessage.mockClear();
    mockStartChat.mockReset();
    mockListMessages.mockReset();
    mockMarkChatRead.mockReset();
    mockSendMessage.mockReset();
  });

  it('shows friend list when no active chat', () => {
    render(<HumanChatPanel />);

    expect(screen.getByText('People')).toBeDefined();
    expect(screen.getByTestId('friend-list')).toBeDefined();
  });

  it('shows chat messages when active chat exists', () => {
    mockStore.activeHumanChat = {
      chatId: 'chat-1',
      friendName: 'Alice',
      messages: [
        { id: 'm1', role: 'user', content: 'Hello Alice!', timestamp: 1000 },
        { id: 'm2', role: 'assistant', content: 'Hey there!', timestamp: 1001 },
      ],
      loading: false,
    };

    render(<HumanChatPanel />);

    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.getByText('Hello Alice!')).toBeDefined();
    expect(screen.getByText('Hey there!')).toBeDefined();
  });

  it('shows loading state', () => {
    mockStore.activeHumanChat = {
      chatId: '',
      friendName: 'Alice',
      messages: [],
      loading: true,
    };

    const { container } = render(<HumanChatPanel />);

    // The spinner is a div with animate-spin class
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeDefined();
    expect(spinner).not.toBeNull();
  });

  it('send button disabled when input is empty', () => {
    mockStore.activeHumanChat = {
      chatId: 'chat-1',
      friendName: 'Alice',
      messages: [],
      loading: false,
    };

    render(<HumanChatPanel />);

    const sendButton = screen.getByText('Send');
    expect((sendButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('handles Enter key to send message', async () => {
    mockStore.activeHumanChat = {
      chatId: 'chat-1',
      friendName: 'Alice',
      messages: [],
      loading: false,
    };

    mockSendMessage.mockResolvedValue({});

    render(<HumanChatPanel />);

    const textarea = screen.getByPlaceholderText('Type a message...');
    fireEvent.change(textarea, { target: { value: 'Hello!' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(mockStore.appendHumanChatMessage).toHaveBeenCalledWith('chat-1', {
        id: 'test-msg-id',
        role: 'user',
        content: 'Hello!',
        timestamp: expect.any(Number),
      });
      expect(mockStore.appendActiveHumanMessage).not.toHaveBeenCalled();

      expect(mockSendMessage).toHaveBeenCalledWith('chat-1', {
        type: 'TEXT',
        text: 'Hello!',
        clientMessageId: 'test-msg-id',
        payload: { content: 'Hello!' },
      });
    });
  });

  it('shows back button that clears active chat', () => {
    mockStore.activeHumanChat = {
      chatId: 'chat-1',
      friendName: 'Alice',
      messages: [],
      loading: false,
    };

    render(<HumanChatPanel />);

    // The back button contains the left arrow entity
    const buttons = screen.getAllByRole('button');
    const backButton = buttons.find((b) => b.textContent?.includes('\u2190'));
    expect(backButton).toBeDefined();

    fireEvent.click(backButton!);
    expect(mockStore.setActiveHumanChat).toHaveBeenCalledWith(null);
  });

  it('displays error when chat open fails', async () => {
    mockStartChat.mockRejectedValue(new Error('Connection refused'));

    render(<HumanChatPanel />);

    // Click a friend to trigger handleSelectFriend
    const friendButton = screen.getByText('Alice');
    fireEvent.click(friendButton);

    await waitFor(() => {
      expect(mockStore.setActiveHumanChat).toHaveBeenCalledWith(null);
    });

    // The error message should appear
    expect(screen.getByText('Connection refused')).toBeDefined();
  });

  it('messages render with correct alignment', () => {
    mockStore.activeHumanChat = {
      chatId: 'chat-1',
      friendName: 'Alice',
      messages: [
        { id: 'm1', role: 'user', content: 'My message', timestamp: 1000 },
        { id: 'm2', role: 'assistant', content: 'Their message', timestamp: 1001 },
      ],
      loading: false,
    };

    const { container } = render(<HumanChatPanel />);

    const userMsg = screen.getByText('My message');
    const assistantMsg = screen.getByText('Their message');

    // User message wrapper has justify-end (right-aligned)
    const userWrapper = userMsg.closest('.flex');
    expect(userWrapper?.className).toContain('justify-end');

    // User message bubble has bg-blue-600
    expect(userMsg.className).toContain('bg-blue-600');

    // Assistant message wrapper has justify-start (left-aligned)
    const assistantWrapper = assistantMsg.closest('.flex');
    expect(assistantWrapper?.className).toContain('justify-start');

    // Assistant message bubble has bg-neutral-800
    expect(assistantMsg.className).toContain('bg-neutral-800');
  });
});
