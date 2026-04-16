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
      <div className="mx-4 w-full max-w-sm rounded-3xl bg-[var(--nimi-surface-card,#fff)] shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pb-0 pt-5">
          <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">
            {t('Chat.createGroup', { defaultValue: 'Create Group' })}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Common.close', { defaultValue: 'Close' })}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--nimi-text-muted)] transition hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-secondary)]"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="space-y-5 px-6 pb-6 pt-4">
          {/* Group Title */}
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
              {t('Chat.groupTitle', { defaultValue: 'Group Title' })}
            </label>
            <input
              type="text"
              className="w-full rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel,#f9fafb)] px-4 py-3 text-sm text-[var(--nimi-text-primary)] outline-none transition placeholder:text-[var(--nimi-text-muted)] focus:border-[var(--nimi-action-primary-bg)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)]"
              placeholder={t('Chat.groupTitlePlaceholder', { defaultValue: 'Name your group' })}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            {titleMissing ? (
              <p className="mt-1.5 text-xs text-[var(--nimi-status-danger,#ef4444)]">
                {t('Chat.groupTitleRequired', { defaultValue: 'Please enter a group name' })}
              </p>
            ) : null}
          </div>

          {/* Members Selection Card */}
          <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card,#fff)] p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                  {t('Chat.groupSelectMembers', { defaultValue: 'Select Members' })}
                </p>
              </div>
              <div className="flex h-6 items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] px-2.5 text-xs font-semibold text-[var(--nimi-action-primary-bg)]">
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <span>{selectedIds.size}</span>
              </div>
            </div>

            <div className="max-h-48 space-y-1 overflow-y-auto">
              {friends.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-[var(--nimi-text-muted)]">
                  {friendsQuery.isLoading
                    ? t('Common.loading', { defaultValue: 'Loading...' })
                    : t('Chat.noFriends', { defaultValue: 'No friends found' })}
                </div>
              )}
              {friends.map((friend) => {
                const selected = selectedIds.has(friend.id);
                return (
                  <button
                    key={friend.id}
                    type="button"
                    onClick={() => toggleFriend(friend.id)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                      selected
                        ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]'
                        : 'hover:bg-[var(--nimi-action-ghost-hover)]'
                    }`}
                  >
                    <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition ${
                      selected
                        ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]'
                        : 'border-[var(--nimi-border-subtle)]'
                    }`}>
                      {selected && (
                        <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                    {friend.avatarUrl ? (
                      <img src={friend.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_15%,transparent)] text-xs font-semibold text-[var(--nimi-action-primary-bg)]">
                        {(friend.displayName || friend.handle || '?').charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">
                      {friend.displayName || friend.handle || friend.id}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Create Button */}
          <button
            type="button"
            disabled={createDisabled}
            onClick={() => void handleCreate()}
            className="w-full rounded-2xl bg-[var(--nimi-action-primary-bg)] py-3.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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
