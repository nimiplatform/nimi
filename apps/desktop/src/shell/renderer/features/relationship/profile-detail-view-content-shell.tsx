import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { InlineFeedback } from '../../ui/feedback/inline-feedback';

import {
  ActionMenu,
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Tooltip,
  type NimiMenuItem,
} from '@nimiplatform/kit/ui';
import {
  AlertIcon,
  CheckIcon,
  DotsIcon,
  MessageIcon,
  StatDivider,
  StatTile,
  TOPBAR_TOOLTIP_CLASS,
  TrashIcon,
  UserPlusIcon,
} from './profile-detail-view-parts.js';

export function ProfileDetailLoadingState({ label: _label }: { label: string }) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-[var(--nimi-surface-canvas)]">
      <ScrollArea
        className="flex-1"
        contentClassName="mx-auto flex min-h-full w-full max-w-[1440px] flex-col px-6 py-6"
      >
        <section className="relative overflow-hidden rounded-[34px] bg-[var(--nimi-surface-card)] shadow-[0_30px_90px_rgba(15,23,42,0.10)]">
          <div className="relative h-[220px] animate-pulse bg-[color-mix(in_srgb,var(--nimi-surface-active)_64%,transparent)] px-8 py-7">
            <div className="absolute right-8 top-7 h-11 w-11 rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_60%,transparent)]" />
            <div className="absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(0deg,var(--nimi-surface-card)_0%,color-mix(in_srgb,var(--nimi-surface-card)_82%,transparent)_55%,transparent_100%)]" />
          </div>

          <div className="relative z-10 -mt-12 px-8 pb-8">
            <div className="rounded-[30px] nimi-material-glass-regular border-[var(--nimi-material-glass-regular-border)] bg-[var(--nimi-material-glass-regular-bg)] px-6 py-7 shadow-[0_22px_56px_rgba(15,23,42,0.08)] backdrop-blur-[var(--nimi-backdrop-blur-regular)] xl:px-7">
              <div className="grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-8">
                <div className="flex shrink-0 flex-col items-center gap-3 lg:pt-[6px]">
                  <div className="h-32 w-32 animate-pulse rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-active)_80%,transparent)]" />
                </div>

                <div className="min-w-0">
                  <div className="h-9 w-52 animate-pulse rounded-lg bg-[color-mix(in_srgb,var(--nimi-surface-active)_80%,transparent)]" />
                  <div className="mt-3 h-5 w-28 animate-pulse rounded-md bg-[color-mix(in_srgb,var(--nimi-surface-active)_70%,transparent)]" />
                  <div className="mt-5 h-4 w-full max-w-[420px] animate-pulse rounded-md bg-[color-mix(in_srgb,var(--nimi-surface-active)_70%,transparent)]" />
                  <div className="mt-2 h-4 w-4/5 max-w-[380px] animate-pulse rounded-md bg-[color-mix(in_srgb,var(--nimi-surface-active)_70%,transparent)]" />

                  <div className="mt-7 grid max-w-[460px] grid-cols-2 gap-x-12 gap-y-3.5">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <div key={`profile-meta-skeleton-${index}`} className="flex items-center gap-2.5">
                        <div className="h-4 w-4 animate-pulse rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-active)_80%,transparent)]" />
                        <div className="h-4 w-28 animate-pulse rounded-md bg-[color-mix(in_srgb,var(--nimi-surface-active)_70%,transparent)]" />
                      </div>
                    ))}
                  </div>

                  <div className="mt-7 flex flex-wrap gap-2.5">
                    <div className="h-8 w-20 animate-pulse rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-active)_75%,transparent)]" />
                    <div className="h-8 w-24 animate-pulse rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-active)_75%,transparent)]" />
                    <div className="h-8 w-16 animate-pulse rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-active)_75%,transparent)]" />
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <div className="px-5">
                  <div className="rounded-[24px] border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_70%,transparent)] p-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)]">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="grid max-w-[320px] grid-cols-3 gap-2 lg:flex-1">
                        {Array.from({ length: 3 }).map((_, index) => (
                          <div key={`profile-stat-skeleton-${index}`} className="text-center">
                            <div className="mx-auto h-3 w-12 animate-pulse rounded-md bg-[color-mix(in_srgb,var(--nimi-surface-active)_70%,transparent)]" />
                            <div className="mx-auto mt-3 h-9 w-14 animate-pulse rounded-md bg-[color-mix(in_srgb,var(--nimi-surface-active)_80%,transparent)]" />
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 lg:justify-end">
                        <div className="h-10 w-10 animate-pulse rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-active)_80%,transparent)]" />
                        <div className="h-10 w-10 animate-pulse rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-active)_80%,transparent)]" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-6 px-4">
                  <div className="relative flex flex-wrap gap-6 border-b border-[var(--nimi-border-subtle)] pb-3">
                    <div className="h-5 w-12 animate-pulse rounded-md bg-[color-mix(in_srgb,var(--nimi-surface-active)_75%,transparent)]" />
                    <div className="h-5 w-24 animate-pulse rounded-md bg-[color-mix(in_srgb,var(--nimi-surface-active)_75%,transparent)]" />
                    <div className="h-5 w-12 animate-pulse rounded-md bg-[color-mix(in_srgb,var(--nimi-surface-active)_75%,transparent)]" />
                    <div className="h-5 w-12 animate-pulse rounded-md bg-[color-mix(in_srgb,var(--nimi-surface-active)_75%,transparent)]" />
                  </div>
                </div>

                <div className="px-5 py-5">
                  <div className="space-y-6">
                    <div className="h-5 w-28 animate-pulse rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-active)_80%,transparent)]" />
                    <div className="grid gap-6 md:grid-cols-2">
                      <div className="h-56 animate-pulse rounded-[26px] border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_70%,transparent)] shadow-[0_6px_24px_rgba(15,23,42,0.05)]" />
                      <div className="h-56 animate-pulse rounded-[26px] border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_70%,transparent)] shadow-[0_6px_24px_rgba(15,23,42,0.05)]" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </ScrollArea>
    </div>
  );
}

export function ProfileDetailErrorState(input: {
  backLabel: string;
  label: string;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center bg-[var(--nimi-surface-canvas)]">
      <div className="rounded-[28px] border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[var(--nimi-surface-card)] px-8 py-10 text-center shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-danger)]">
          <AlertIcon className="h-5 w-5" />
        </div>
        <p className="mt-4 text-sm font-medium text-[var(--nimi-status-danger)]">{input.label}</p>
        <button
          type="button"
          onClick={input.onClose}
          className="mt-5 rounded-full border border-[var(--nimi-border-subtle)] px-4 py-2 text-sm font-medium text-[var(--nimi-text-secondary)] transition hover:bg-[var(--nimi-action-ghost-hover)]"
        >
          {input.backLabel}
        </button>
      </div>
    </div>
  );
}

export function ProfileDetailTabFallback() {
  return (
    <div className="space-y-6">
      <div className="h-5 w-28 animate-pulse rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-active)_80%,transparent)]" />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="h-56 animate-pulse rounded-[26px] border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_70%,transparent)] shadow-[0_6px_24px_rgba(15,23,42,0.05)]" />
        <div className="h-56 animate-pulse rounded-[26px] border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_70%,transparent)] shadow-[0_6px_24px_rgba(15,23,42,0.05)]" />
      </div>
    </div>
  );
}

export function ProfileDetailActionButtons(input: {
  onMessage: () => void;
  onAddFriend?: () => void;
  showAddFriendButton?: boolean;
  addFriendLabel?: string;
  canAddFriend?: boolean;
  addFriendHint?: string | null;
  showMessageButton: boolean;
  showMoreButton?: boolean;
  showMenu?: boolean;
  onShowMenuChange?: (open: boolean) => void;
  onBlock?: () => void;
  onRemove?: () => void;
}) {
  const i18n = useDesktopI18nResource().instance;
  const addFriendLabel = input.addFriendLabel || i18n.t('ProfileView.addFriend', { defaultValue: 'Add Friend' });
  const moreLabel = i18n.t('Common.moreOptions', { defaultValue: 'More options' });
  const menuItems: NimiMenuItem[] = [
    ...(input.onBlock ? [{
      id: 'block',
      label: i18n.t('Common.block', { defaultValue: 'Block' }),
      icon: <AlertIcon className="h-4 w-4" />,
      onSelect: input.onBlock,
    }] : []),
    ...(input.onRemove ? [{
      id: 'remove',
      label: i18n.t('Profile.removeFriend', { defaultValue: 'Remove Friend' }),
      icon: <TrashIcon className="h-4 w-4" />,
      tone: 'danger' as const,
      onSelect: input.onRemove,
    }] : []),
  ];
  return (
    <>
      {input.showMessageButton ? (
        <Tooltip content={i18n.t('Relationship.chat', { defaultValue: 'Chat' })} placement="bottom" contentClassName={TOPBAR_TOOLTIP_CLASS}>
          <IconButton
            icon={<MessageIcon className="h-4 w-4" />}
            tone="secondary"
            aria-label={i18n.t('Relationship.chat', { defaultValue: 'Chat' })}
            onClick={input.onMessage}
            className="h-10 w-10 rounded-full"
          />
        </Tooltip>
      ) : null}
      {input.showAddFriendButton && input.onAddFriend ? (
        <Tooltip
          content={input.canAddFriend === false && input.addFriendHint
            ? input.addFriendHint
            : addFriendLabel}
          placement="bottom"
          contentClassName={`${TOPBAR_TOOLTIP_CLASS}${input.canAddFriend === false && input.addFriendHint ? ' whitespace-pre-wrap max-w-xs' : ''}`}
        >
          <IconButton
            icon={<UserPlusIcon className="h-4 w-4" />}
            tone="secondary"
            aria-label={addFriendLabel}
            onClick={input.onAddFriend}
            disabled={input.canAddFriend === false}
            className="h-10 w-10 rounded-full"
          />
        </Tooltip>
      ) : null}
      {input.showMoreButton ? (
        <Popover
          open={input.showMenu}
          onOpenChange={(open) => input.onShowMenuChange?.(open)}
        >
          <Tooltip content={moreLabel} placement="bottom" contentClassName={TOPBAR_TOOLTIP_CLASS}>
            <PopoverTrigger asChild>
              <IconButton
                icon={<DotsIcon className="h-4 w-4" />}
                tone="secondary"
                aria-label={moreLabel}
                className="h-10 w-10 rounded-full"
              />
            </PopoverTrigger>
          </Tooltip>
          <PopoverContent align="end" sideOffset={6} className="p-1">
            <ActionMenu items={menuItems} ariaLabel={moreLabel} />
          </PopoverContent>
        </Popover>
      ) : null}
    </>
  );
}

export function ProfileDetailSaveActions(input: {
  draftDisplayName: string;
  isSaving: boolean;
  isUploadingAvatar: boolean;
  onCancel: () => void;
  onSave: () => void;
  saveError: string | null;
  stacked: boolean;
}) {
  const i18n = useDesktopI18nResource().instance;
  const containerClassName = input.stacked ? 'flex flex-col gap-3' : 'flex w-full flex-col gap-3';

  return (
    <div className={containerClassName}>
      {input.saveError ? (
        <InlineFeedback feedback={{ kind: 'error', message: input.saveError }} />
      ) : null}
      <Button
        tone="primary"
        fullWidth
        onClick={input.onSave}
        loading={input.isSaving}
        disabled={input.isSaving || input.isUploadingAvatar || !input.draftDisplayName.trim()}
        leadingIcon={input.isSaving ? undefined : <CheckIcon className="h-4 w-4" />}
        className="rounded-full py-3"
      >
        {input.isSaving
          ? i18n.t('Common.saving', { defaultValue: 'Saving...' })
          : i18n.t('Profile.saveProfile', { defaultValue: 'Save profile' })}
      </Button>
      <Button
        tone="secondary"
        fullWidth
        onClick={input.onCancel}
        disabled={input.isSaving}
        className="rounded-full py-3"
      >
        {i18n.t('Common.cancel', { defaultValue: 'Cancel' })}
      </Button>
    </div>
  );
}

export function ProfileDetailStatsActionsBlock(input: {
  friendCount: number;
  postCount: number;
  likesCount: number;
  isEditing: boolean;
  isOwnProfile: boolean | undefined;
  draftDisplayName: string;
  isSaving: boolean;
  isUploadingAvatar: boolean;
  onCancel: () => void;
  onSave: () => void;
  saveError: string | null;
  onMessage: () => void;
  onAddFriend?: () => void;
  showAddFriendButton?: boolean;
  addFriendLabel?: string;
  canAddFriend?: boolean;
  addFriendHint?: string | null;
  showMessageButton: boolean;
  showMoreButton?: boolean;
  showMenu?: boolean;
  onShowMenuChange?: (open: boolean) => void;
  onBlock?: () => void;
  onRemove?: () => void;
}) {
  const i18n = useDesktopI18nResource().instance;
  if (input.isEditing) {
    return input.isOwnProfile ? (
      <div className="rounded-[24px] border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_70%,transparent)] p-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)]">
        <ProfileDetailSaveActions
          draftDisplayName={input.draftDisplayName}
          isSaving={input.isSaving}
          isUploadingAvatar={input.isUploadingAvatar}
          onCancel={input.onCancel}
          onSave={input.onSave}
          saveError={input.saveError}
          stacked
        />
      </div>
    ) : null;
  }

  return (
    <div className="rounded-[24px] border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_70%,transparent)] p-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid max-w-[320px] grid-cols-3 gap-2 lg:flex-1">
          <StatTile label={i18n.t('Profile.friends', { defaultValue: 'Friends' })} value={input.friendCount} />
          <StatTile label={i18n.t('Profile.posts', { defaultValue: 'Posts' })} value={input.postCount} />
          <StatTile label={i18n.t('Profile.likes', { defaultValue: 'Likes' })} value={input.likesCount} />
        </div>
        <div className="lg:min-w-[11rem]">
          <div className="flex items-center gap-2 lg:justify-end">
            <ProfileDetailActionButtons {...input} />
          </div>
          {input.showAddFriendButton && input.canAddFriend === false && input.addFriendHint ? (
            <p className="mt-2 text-xs text-[var(--nimi-status-warning)] lg:text-right">{input.addFriendHint}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ProfileDetailDesktopStatsActions(input: {
  friendCount: number;
  postCount: number;
  likesCount: number;
  onMessage: () => void;
  onAddFriend?: () => void;
  showAddFriendButton?: boolean;
  addFriendLabel?: string;
  canAddFriend?: boolean;
  addFriendHint?: string | null;
  showMessageButton: boolean;
  showMoreButton?: boolean;
  showMenu?: boolean;
  onShowMenuChange?: (open: boolean) => void;
  onBlock?: () => void;
  onRemove?: () => void;
}) {
  const i18n = useDesktopI18nResource().instance;
  return (
    <div className="flex w-[220px] shrink-0 flex-col items-end">
      <div className="flex items-center justify-end gap-3">
        <ProfileDetailActionButtons {...input} />
      </div>
      {input.showAddFriendButton && input.canAddFriend === false && input.addFriendHint ? (
        <p className="mt-2 text-right text-xs text-[var(--nimi-status-warning)]">{input.addFriendHint}</p>
      ) : null}
      <div className="mt-5 grid w-full grid-cols-[1fr_18px_1fr_18px_1fr] items-start gap-x-0">
        <StatTile label={i18n.t('Profile.friends', { defaultValue: 'Friends' })} value={input.friendCount} />
        <StatDivider />
        <StatTile label={i18n.t('Profile.posts', { defaultValue: 'Posts' })} value={input.postCount} />
        <StatDivider />
        <StatTile label={i18n.t('Profile.likes', { defaultValue: 'Likes' })} value={input.likesCount} />
      </div>
    </div>
  );
}
