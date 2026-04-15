import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';

type FriendEntry = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
};

export function ChatGroupCreateModal(props: {
  open: boolean;
  onClose: () => void;
  onCreateGroup: (title: string, participantIds: string[]) => Promise<void>;
}) {
  const { open, onClose, onCreateGroup } = props;
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isCreating, setIsCreating] = useState(false);

  const friendsQuery = useQuery({
    queryKey: ['group-create-friends'],
    queryFn: async () => {
      const snapshot = await dataSync.loadSocialSnapshot();
      const friends: FriendEntry[] = [];
      const items = Array.isArray((snapshot as { friends?: unknown[] })?.friends)
        ? ((snapshot as { friends: unknown[] }).friends)
        : [];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const f = item as Record<string, unknown>;
        if (f.isAgent === true) continue;
        friends.push({
          id: String(f.id || f.accountId || ''),
          displayName: String(f.displayName || '').trim(),
          handle: String(f.handle || '').trim(),
          avatarUrl: f.avatarUrl ? String(f.avatarUrl) : null,
        });
      }
      return friends;
    },
    enabled: open,
    staleTime: 30_000,
  });

  const friends = friendsQuery.data || [];
  const normalizedTitle = title.trim();
  const titleMissing = normalizedTitle.length === 0;
  const createDisabled = titleMissing || selectedIds.size < 1 || isCreating;

  useEffect(() => {
    if (open) {
      setTitle('');
      setSelectedIds(new Set());
      setIsCreating(false);
    }
  }, [open]);

  const toggleFriend = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleCreate = useCallback(async () => {
    if (titleMissing || selectedIds.size < 1 || isCreating) return;
    setIsCreating(true);
    try {
      await onCreateGroup(normalizedTitle, [...selectedIds]);
    } finally {
      setIsCreating(false);
    }
  }, [titleMissing, normalizedTitle, selectedIds, isCreating, onCreateGroup]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-200/60 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-800">
            {t('Chat.createGroup', { defaultValue: 'Create Group' })}
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {t('Chat.createGroupDescription', {
              defaultValue: 'Add a title and select members to start a group conversation.',
            })}
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              {t('Chat.groupTitle', { defaultValue: 'Group Title' })}
            </label>
            <input
              type="text"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200"
              placeholder={t('Chat.groupTitlePlaceholder', { defaultValue: 'e.g. Project Discussion' })}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            {titleMissing ? (
              <p className="mt-1 text-xs text-rose-500">
                {t('Chat.groupTitleRequired', { defaultValue: 'Group title is required' })}
              </p>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              {t('Chat.groupSelectMembers', { defaultValue: 'Select Members' })}
              <span className="ml-1 text-slate-400">({selectedIds.size})</span>
            </label>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50">
              {friends.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-slate-400">
                  {friendsQuery.isLoading
                    ? t('Common.loading', { defaultValue: 'Loading...' })
                    : t('Chat.noFriends', { defaultValue: 'No friends found' })}
                </div>
              )}
              {friends.map((friend) => (
                <label
                  key={friend.id}
                  className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-slate-100/80"
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-500 focus:ring-indigo-200"
                    checked={selectedIds.has(friend.id)}
                    onChange={() => toggleFriend(friend.id)}
                  />
                  {friend.avatarUrl ? (
                    <img src={friend.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[10px] font-medium text-slate-500">
                      {(friend.displayName || friend.handle || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="truncate text-sm text-slate-700">
                    {friend.displayName || friend.handle || friend.id}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200/60 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-slate-500 transition hover:bg-slate-100"
          >
            {t('Common.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            disabled={createDisabled}
            onClick={() => void handleCreate()}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCreating
              ? t('Common.creating', { defaultValue: 'Creating...' })
              : t('Chat.createGroup', { defaultValue: 'Create Group' })}
          </button>
        </div>
      </div>
    </div>
  );
}
