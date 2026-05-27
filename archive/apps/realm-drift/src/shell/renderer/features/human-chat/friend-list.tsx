import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import type { FriendInfo } from '@renderer/app-shell/app-store.js';

type FriendListProps = {
  onSelectFriend: (friend: FriendInfo) => void;
  activeFriendUserId: string | null;
};

export function FriendList({ onSelectFriend, activeFriendUserId }: FriendListProps) {
  const { t } = useTranslation();
  const friendList = useAppStore((s) => s.friendList);
  const onlineUsers = useAppStore((s) => s.onlineUsers);

  if (friendList.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-neutral-500 text-sm">
        {t('humanChat.noFriends')}
      </div>
    );
  }

  // Sort online-first, then by name per RD-HCHAT-003
  const sorted = [...friendList].sort((a, b) => {
    const aOnline = onlineUsers.has(a.userId) ? 1 : 0;
    const bOnline = onlineUsers.has(b.userId) ? 1 : 0;
    if (bOnline !== aOnline) return bOnline - aOnline;
    return a.displayName.localeCompare(b.displayName);
  });

  return (
    <div className="flex flex-col gap-1 overflow-auto">
      {sorted.map((friend) => {
        const isOnline = onlineUsers.has(friend.userId);
        return (
          <button
            key={friend.userId}
            onClick={() => onSelectFriend(friend)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
              activeFriendUserId === friend.userId
                ? 'bg-neutral-700'
                : 'hover:bg-neutral-800'
            }`}
          >
            {/* Avatar with online indicator */}
            <div className="relative flex-shrink-0">
              <div className="w-8 h-8 rounded-full bg-neutral-700 overflow-hidden">
                {friend.avatarUrl ? (
                  <img src={friend.avatarUrl} alt={friend.displayName} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-neutral-400">
                    {friend.displayName.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-neutral-900 ${
                  isOnline ? 'bg-emerald-400' : 'bg-neutral-600'
                }`}
              />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white truncate">{friend.displayName}</div>
              {friend.handle && (
                <div className="text-xs text-neutral-500 truncate">@{friend.handle}</div>
              )}
              <div className="text-xs text-neutral-500">
                {isOnline
                  ? `${t('humanChat.online')}${friend.appContext ? ` · ${friend.appContext}` : ''}`
                  : t('humanChat.offline')}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
