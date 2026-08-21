import { useRealmSocialData } from '../social/data/realm-social-data-context.js';
import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, IconButton, OverlayShell, ScrollArea } from '@nimiplatform/kit/ui';
import { toFriendContact } from '../relationship/relationship-model.js';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { InlineFeedback } from '../../ui/feedback/inline-feedback';

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
  const realmSocialData = useRealmSocialData();
  const { open, onClose, onCreateGroup } = props;
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isCreating, setIsCreating] = useState(false);
  const [titleTouched, setTitleTouched] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const friendsQuery = useQuery({
    queryKey: ['group-create-friends'],
    queryFn: async () => {
      const snapshot = await realmSocialData.loadSocialSnapshot();
      const items = Array.isArray(snapshot.friends)
        ? snapshot.friends
        : [];
      return items.map((item): FriendEntry => {
        const friend = toFriendContact(item);
        return {
          id: friend.id,
          displayName: friend.displayName,
          handle: friend.handle,
          avatarUrl: friend.avatarUrl,
        };
      });
    },
    enabled: open,
    staleTime: 30_000,
  });

  const friends = friendsQuery.data || [];
  const normalizedTitle = title.trim();
  const titleMissing = normalizedTitle.length === 0;
  const showTitleError = titleTouched && titleMissing;
  const createDisabled = titleMissing || selectedIds.size < 1 || isCreating;

  useEffect(() => {
    if (open) {
      setTitle('');
      setSelectedIds(new Set());
      setIsCreating(false);
      setTitleTouched(false);
      setCreateError(null);
    }
  }, [open]);

  const toggleFriend = useCallback((id: string) => {
    setCreateError(null);
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
    if (titleMissing) {
      setTitleTouched(true);
      return;
    }
    if (selectedIds.size < 1 || isCreating) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      await onCreateGroup(normalizedTitle, [...selectedIds]);
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : t('Chat.createGroupError', { defaultValue: 'Failed to create group' });
      setCreateError(message);
    } finally {
      setIsCreating(false);
    }
  }, [titleMissing, normalizedTitle, selectedIds, isCreating, onCreateGroup, t]);

  if (!open) return null;

  return (
    <OverlayShell
      open={open}
      kind="dialog"
      onClose={isCreating ? undefined : onClose}
      className="bg-[var(--nimi-scrim-modal)]"
      title={(
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-[var(--nimi-text-primary)]">
            {t('Chat.createGroup', { defaultValue: 'Create Group' })}
          </h2>
          <IconButton
            icon={(
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
            size="sm"
            disabled={isCreating}
            onClick={onClose}
            aria-label={t('Common.close', { defaultValue: 'Close' })}
          />
        </div>
      )}
      footer={(
        <Button
          tone="primary"
          fullWidth
          disabled={createDisabled}
          onClick={() => void handleCreate()}
        >
          {isCreating
            ? t('Common.creating', { defaultValue: 'Creating...' })
            : t('Chat.createGroup', { defaultValue: 'Create Group' })}
        </Button>
      )}
    >
      <div className="space-y-5 pt-2">
        {/* Group Title */}
        <div>
          <label htmlFor="chat-group-title" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
            {t('Chat.groupTitle', { defaultValue: 'Group Title' })}
          </label>
          <input
            id="chat-group-title"
            type="text"
            className="w-full rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-4 py-3 text-sm text-[var(--nimi-text-primary)] outline-none transition placeholder:text-[var(--nimi-text-muted)] focus:border-[var(--nimi-action-primary-bg)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)]"
            value={title}
            disabled={isCreating}
            aria-invalid={showTitleError || undefined}
            aria-describedby={showTitleError ? 'chat-group-title-error' : undefined}
            onBlur={() => setTitleTouched(true)}
            onChange={(e) => {
              setTitle(e.target.value);
              setCreateError(null);
            }}
          />
          {showTitleError ? (
            <p id="chat-group-title-error" className="mt-1.5 text-xs text-[var(--nimi-status-danger)]">
              {t('Chat.groupTitleRequired', { defaultValue: 'Please enter a group name' })}
            </p>
          ) : null}
        </div>

        {/* Members Selection Card */}
        <fieldset disabled={isCreating} className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-5">
          <legend className="sr-only">
            {t('Chat.groupSelectMembers', { defaultValue: 'Select Members' })}
          </legend>
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

          <ScrollArea className="max-h-48" contentClassName="space-y-1 pr-2">
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
                <label
                  key={friend.id}
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition focus-within:ring-2 focus-within:ring-[var(--nimi-focus-ring-color)] ${
                    selected
                      ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]'
                      : 'hover:bg-[var(--nimi-action-ghost-hover)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleFriend(friend.id)}
                    className="sr-only"
                  />
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition ${
                    selected
                      ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]'
                      : 'border-[var(--nimi-border-subtle)]'
                  }`} aria-hidden="true">
                    {selected && (
                      <svg className="h-3 w-3 text-[var(--nimi-action-primary-text)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </span>
                  <EntityAvatar
                    imageUrl={friend.avatarUrl}
                    name={friend.displayName || friend.handle || friend.id}
                    kind="human"
                    sizeClassName="h-8 w-8"
                    textClassName="text-xs font-semibold"
                    fallbackClassName="bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_15%,transparent)] text-[var(--nimi-action-primary-bg)]"
                  />
                  <span className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">
                    {friend.displayName || friend.handle || friend.id}
                  </span>
                </label>
              );
            })}
          </ScrollArea>
        </fieldset>

        {createError ? (
          <InlineFeedback feedback={{ kind: 'error', message: createError }} />
        ) : null}
      </div>
    </OverlayShell>
  );
}
