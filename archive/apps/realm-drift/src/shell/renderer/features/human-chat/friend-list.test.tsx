import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'humanChat.noFriends': 'No friends yet',
        'humanChat.online': 'Online',
        'humanChat.offline': 'Offline',
      };
      return map[key] ?? key;
    },
  }),
}));

const mockStore: {
  friendList: Array<{
    userId: string;
    displayName: string;
    handle?: string;
    avatarUrl?: string;
    appContext?: string;
  }>;
  onlineUsers: Set<string>;
} = {
  friendList: [],
  onlineUsers: new Set(),
};

vi.mock('@renderer/app-shell/app-store.js', () => ({
  useAppStore: (selector: (s: typeof mockStore) => unknown) => selector(mockStore),
}));

import { FriendList } from './friend-list.js';

function makeFriend(overrides: Partial<typeof mockStore.friendList[number]> & { userId: string; displayName: string }) {
  return { ...overrides };
}

describe('FriendList', () => {
  beforeEach(() => {
    mockStore.friendList = [];
    mockStore.onlineUsers = new Set();
  });

  it('renders friend names', () => {
    mockStore.friendList = [
      makeFriend({ userId: 'u1', displayName: 'Alice' }),
      makeFriend({ userId: 'u2', displayName: 'Bob' }),
    ];

    render(<FriendList onSelectFriend={vi.fn()} activeFriendUserId={null} />);

    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.getByText('Bob')).toBeDefined();
  });

  it('shows online indicator (green dot) for online friends', () => {
    mockStore.friendList = [
      makeFriend({ userId: 'u1', displayName: 'Alice' }),
    ];
    mockStore.onlineUsers = new Set(['u1']);

    const { container } = render(
      <FriendList onSelectFriend={vi.fn()} activeFriendUserId={null} />,
    );

    // The online indicator is a div with bg-emerald-400 class
    const indicators = container.querySelectorAll('.bg-emerald-400');
    expect(indicators.length).toBe(1);
  });

  it('shows offline indicator (gray dot) for offline friends', () => {
    mockStore.friendList = [
      makeFriend({ userId: 'u1', displayName: 'Alice' }),
    ];
    mockStore.onlineUsers = new Set();

    const { container } = render(
      <FriendList onSelectFriend={vi.fn()} activeFriendUserId={null} />,
    );

    const indicators = container.querySelectorAll('.bg-neutral-600');
    expect(indicators.length).toBe(1);
  });

  it('sorts online friends before offline', () => {
    mockStore.friendList = [
      makeFriend({ userId: 'u1', displayName: 'Alice' }),
      makeFriend({ userId: 'u2', displayName: 'Bob' }),
      makeFriend({ userId: 'u3', displayName: 'Charlie' }),
    ];
    mockStore.onlineUsers = new Set(['u2']);

    render(<FriendList onSelectFriend={vi.fn()} activeFriendUserId={null} />);

    const buttons = screen.getAllByRole('button');
    // Bob should be first (online), then Alice and Charlie (offline, alphabetical)
    expect(buttons[0]!.textContent).toContain('Bob');
    expect(buttons[1]!.textContent).toContain('Alice');
    expect(buttons[2]!.textContent).toContain('Charlie');
  });

  it('calls onSelectFriend when a friend is clicked', () => {
    const friend = makeFriend({ userId: 'u1', displayName: 'Alice' });
    mockStore.friendList = [friend];

    const handleSelect = vi.fn();
    render(<FriendList onSelectFriend={handleSelect} activeFriendUserId={null} />);

    fireEvent.click(screen.getByRole('button'));
    expect(handleSelect).toHaveBeenCalledOnce();
    expect(handleSelect).toHaveBeenCalledWith(friend);
  });

  it('shows empty state when no friends', () => {
    mockStore.friendList = [];

    render(<FriendList onSelectFriend={vi.fn()} activeFriendUserId={null} />);

    expect(screen.getByText('No friends yet')).toBeDefined();
  });
});
