import { type RefObject } from 'react';
import { i18n } from '@renderer/i18n';
import { Tooltip } from '@renderer/components/tooltip.js';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import {
  AlertIcon,
  CheckIcon,
  DotsIcon,
  GiftIcon,
  IconButton,
  MessageIcon,
  SpinnerIcon,
  StatDivider,
  StatTile,
  TrashIcon,
  UserPlusIcon,
} from './contact-detail-view-parts.js';

const TOPBAR_TOOLTIP_CLASS = 'rounded-full bg-[#0f172a] px-3 py-1.5 text-xs font-semibold text-white shadow-[0_4px_20px_rgba(0,0,0,0.25)]';

export function ContactDetailLoadingState({ label: _label }: { label: string }) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-[linear-gradient(180deg,#eef3f4_0%,#f7fafb_48%,#fcfefd_100%)]">
      <ScrollShell
        className="flex-1"
        contentClassName="mx-auto flex min-h-full w-full max-w-[1440px] flex-col px-6 py-6"
      >
        <section className="relative overflow-hidden rounded-[34px] bg-white shadow-[0_30px_90px_rgba(15,23,42,0.10)]">
          <div className="relative h-[220px] animate-pulse bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 px-8 py-7">
            <div className="absolute right-8 top-7 h-11 w-11 rounded-full bg-white/60" />
            <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-white via-white/82 to-transparent" />
          </div>

          <div className="relative z-10 -mt-12 px-8 pb-8">
            <div className="rounded-[30px] border border-white/38 bg-white/40 px-6 py-7 shadow-[0_22px_56px_rgba(15,23,42,0.08)] backdrop-blur-[18px] supports-[backdrop-filter]:bg-white/30 xl:px-7">
              <div className="grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-8">
                <div className="flex shrink-0 flex-col items-center gap-3 lg:pt-[6px]">
                  <div className="h-32 w-32 animate-pulse rounded-full bg-slate-200/80" />
                </div>

                <div className="min-w-0">
                  <div className="h-9 w-52 animate-pulse rounded-lg bg-slate-200/80" />
                  <div className="mt-3 h-5 w-28 animate-pulse rounded-md bg-slate-200/70" />
                  <div className="mt-5 h-4 w-full max-w-[420px] animate-pulse rounded-md bg-slate-200/70" />
                  <div className="mt-2 h-4 w-4/5 max-w-[380px] animate-pulse rounded-md bg-slate-200/70" />

                  <div className="mt-7 grid max-w-[460px] grid-cols-2 gap-x-12 gap-y-3.5">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <div key={`contact-meta-skeleton-${index}`} className="flex items-center gap-2.5">
                        <div className="h-4 w-4 animate-pulse rounded-full bg-slate-200/80" />
                        <div className="h-4 w-28 animate-pulse rounded-md bg-slate-200/70" />
                      </div>
                    ))}
                  </div>

                  <div className="mt-7 flex flex-wrap gap-2.5">
                    <div className="h-8 w-20 animate-pulse rounded-full bg-slate-200/75" />
                    <div className="h-8 w-24 animate-pulse rounded-full bg-slate-200/75" />
                    <div className="h-8 w-16 animate-pulse rounded-full bg-slate-200/75" />
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <div className="px-5">
                  <div className="rounded-[24px] border border-white/60 bg-white/70 p-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)]">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="grid max-w-[320px] grid-cols-3 gap-2 lg:flex-1">
                        {Array.from({ length: 3 }).map((_, index) => (
                          <div key={`contact-stat-skeleton-${index}`} className="text-center">
                            <div className="mx-auto h-3 w-12 animate-pulse rounded-md bg-slate-200/70" />
                            <div className="mx-auto mt-3 h-9 w-14 animate-pulse rounded-md bg-slate-200/80" />
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 lg:justify-end">
                        <div className="h-10 w-10 animate-pulse rounded-full bg-slate-200/80" />
                        <div className="h-10 w-10 animate-pulse rounded-full bg-slate-200/80" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-6 px-4">
                  <div className="relative flex flex-wrap gap-6 border-b border-slate-200/70 pb-3">
                    <div className="h-5 w-12 animate-pulse rounded-md bg-slate-200/75" />
                    <div className="h-5 w-24 animate-pulse rounded-md bg-slate-200/75" />
                    <div className="h-5 w-12 animate-pulse rounded-md bg-slate-200/75" />
                    <div className="h-5 w-12 animate-pulse rounded-md bg-slate-200/75" />
                  </div>
                </div>

                <div className="px-5 py-5">
                  <div className="space-y-6">
                    <div className="h-5 w-28 animate-pulse rounded-full bg-slate-200/80" />
                    <div className="grid gap-6 md:grid-cols-2">
                      <div className="h-56 animate-pulse rounded-[26px] border border-white/70 bg-white/70 shadow-[0_6px_24px_rgba(15,23,42,0.05)]" />
                      <div className="h-56 animate-pulse rounded-[26px] border border-white/70 bg-white/70 shadow-[0_6px_24px_rgba(15,23,42,0.05)]" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </ScrollShell>
    </div>
  );
}

export function ContactDetailErrorState(input: {
  backLabel: string;
  label: string;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center bg-[#f3f6f8]">
      <div className="rounded-[28px] border border-red-100 bg-white px-8 py-10 text-center shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500">
          <AlertIcon className="h-5 w-5" />
        </div>
        <p className="mt-4 text-sm font-medium text-red-600">{input.label}</p>
        <button
          type="button"
          onClick={input.onClose}
          className="mt-5 rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          {input.backLabel}
        </button>
      </div>
    </div>
  );
}

export function ContactDetailTabFallback() {
  return (
    <div className="space-y-6">
      <div className="h-5 w-28 animate-pulse rounded-full bg-slate-200/80" />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="h-56 animate-pulse rounded-[26px] border border-white/70 bg-white/70 shadow-[0_6px_24px_rgba(15,23,42,0.05)]" />
        <div className="h-56 animate-pulse rounded-[26px] border border-white/70 bg-white/70 shadow-[0_6px_24px_rgba(15,23,42,0.05)]" />
      </div>
    </div>
  );
}

export function ContactDetailActionButtons(input: {
  onMessage: () => void;
  onAddFriend?: () => void;
  showAddFriendButton?: boolean;
  canAddFriend?: boolean;
  addFriendHint?: string | null;
  onSendGift: () => void;
  showGiftButton: boolean;
  showMessageButton: boolean;
  showMoreButton?: boolean;
  showMenu?: boolean;
  menuButtonRef?: RefObject<HTMLButtonElement | null>;
  menuRef?: RefObject<HTMLDivElement | null>;
  onToggleMenu?: () => void;
  onBlock?: () => void;
  onRemove?: () => void;
}) {
  return (
    <>
      {input.showMessageButton ? (
        <Tooltip content={i18n.t('Contacts.chat', { defaultValue: 'Chat' })} placement="bottom" contentClassName={TOPBAR_TOOLTIP_CLASS}>
          <IconButton icon={<MessageIcon className="h-4 w-4" />} label={i18n.t('Contacts.chat', { defaultValue: 'Chat' })} onClick={input.onMessage} />
        </Tooltip>
      ) : null}
      {input.showAddFriendButton && input.onAddFriend ? (
        <Tooltip
          content={input.canAddFriend === false && input.addFriendHint
            ? input.addFriendHint
            : i18n.t('ProfileView.addFriend', { defaultValue: 'Add Friend' })}
          placement="bottom"
          contentClassName={TOPBAR_TOOLTIP_CLASS}
          multiline={Boolean(input.canAddFriend === false && input.addFriendHint)}
        >
          <IconButton
            icon={<UserPlusIcon className="h-4 w-4" />}
            label={i18n.t('ProfileView.addFriend', { defaultValue: 'Add Friend' })}
            onClick={input.onAddFriend}
            disabled={input.canAddFriend === false}
          />
        </Tooltip>
      ) : null}
      {input.showGiftButton ? (
        <Tooltip content={i18n.t('Contacts.gift', { defaultValue: 'Gift' })} placement="bottom" contentClassName={TOPBAR_TOOLTIP_CLASS}>
          <IconButton icon={<GiftIcon className="h-4 w-4" />} label={i18n.t('Contacts.gift', { defaultValue: 'Gift' })} onClick={input.onSendGift} />
        </Tooltip>
      ) : null}
      {input.showMoreButton ? (
        <div className="relative">
          <Tooltip content={i18n.t('Common.moreOptions', { defaultValue: 'More options' })} placement="bottom" contentClassName={TOPBAR_TOOLTIP_CLASS}>
            <button
              ref={input.menuButtonRef}
              type="button"
              onClick={input.onToggleMenu}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200/80 bg-white/80 text-slate-700 shadow-[0_8px_20px_rgba(15,23,42,0.05)] backdrop-blur-sm transition hover:border-[#4ECCA3]/45 hover:bg-[#4ECCA3]/12 hover:text-[#1f8f69]"
              aria-label={i18n.t('Common.moreOptions', { defaultValue: 'More options' })}
            >
              <DotsIcon className="h-4 w-4" />
            </button>
          </Tooltip>
          {input.showMenu ? (
            <div
              ref={input.menuRef}
              className="absolute right-0 top-full z-20 mt-2 w-44 rounded-2xl border border-slate-100 bg-white py-1.5 shadow-[0_22px_64px_rgba(15,23,42,0.18)]"
            >
              {input.onBlock ? (
                <button type="button" onClick={input.onBlock} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50">
                  <AlertIcon className="h-4 w-4 text-slate-400" />
                  {i18n.t('Common.block', { defaultValue: 'Block' })}
                </button>
              ) : null}
              {input.onRemove ? (
                <button type="button" onClick={input.onRemove} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 transition hover:bg-red-50">
                  <TrashIcon className="h-4 w-4 text-red-500" />
                  {i18n.t('Profile.removeFriend', { defaultValue: 'Remove Friend' })}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function ContactDetailSaveActions(input: {
  draftDisplayName: string;
  isSaving: boolean;
  isUploadingAvatar: boolean;
  onCancel: () => void;
  onSave: () => void;
  saveError: string | null;
  stacked: boolean;
}) {
  const containerClassName = input.stacked ? 'flex flex-col gap-3' : 'flex w-full flex-col gap-3';
  const buttonClassName = input.stacked ? 'w-full' : 'w-full';

  return (
    <div className={containerClassName}>
      {input.saveError ? (
        <p className="text-sm text-red-500">{input.saveError}</p>
      ) : null}
      <button
        type="button"
        onClick={input.onSave}
        disabled={input.isSaving || input.isUploadingAvatar || !input.draftDisplayName.trim()}
        className={`inline-flex ${buttonClassName} items-center justify-center gap-2 rounded-full bg-[#4ECCA3] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#41b992] disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {input.isSaving ? <SpinnerIcon className="h-4 w-4" /> : <CheckIcon className="h-4 w-4" />}
        {input.isSaving ? 'Saving...' : 'Save profile'}
      </button>
      <button
        type="button"
        onClick={input.onCancel}
        disabled={input.isSaving}
        className={`inline-flex ${buttonClassName} items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50`}
      >
        Cancel
      </button>
    </div>
  );
}

export function ContactDetailStatsActionsBlock(input: {
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
  canAddFriend?: boolean;
  addFriendHint?: string | null;
  onSendGift: () => void;
  showGiftButton: boolean;
  showMessageButton: boolean;
  showMoreButton?: boolean;
  showMenu?: boolean;
  menuButtonRef?: RefObject<HTMLButtonElement | null>;
  menuRef?: RefObject<HTMLDivElement | null>;
  onToggleMenu?: () => void;
  onBlock?: () => void;
  onRemove?: () => void;
}) {
  if (input.isEditing) {
    return input.isOwnProfile ? (
      <div className="rounded-[24px] border border-white/60 bg-white/70 p-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)]">
        <ContactDetailSaveActions
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
    <div className="rounded-[24px] border border-white/60 bg-white/70 p-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid max-w-[320px] grid-cols-3 gap-2 lg:flex-1">
          <StatTile label={i18n.t('Profile.friends', { defaultValue: 'Friends' })} value={input.friendCount} />
          <StatTile label={i18n.t('Profile.posts', { defaultValue: 'Posts' })} value={input.postCount} />
          <StatTile label={i18n.t('Profile.likes', { defaultValue: 'Likes' })} value={input.likesCount} />
        </div>
        <div className="lg:min-w-[11rem]">
          <div className="flex items-center gap-2 lg:justify-end">
            <ContactDetailActionButtons {...input} />
          </div>
          {input.showAddFriendButton && input.canAddFriend === false && input.addFriendHint ? (
            <p className="mt-2 text-xs text-amber-600 lg:text-right">{input.addFriendHint}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ContactDetailDesktopStatsActions(input: {
  friendCount: number;
  postCount: number;
  likesCount: number;
  onMessage: () => void;
  onAddFriend?: () => void;
  showAddFriendButton?: boolean;
  canAddFriend?: boolean;
  addFriendHint?: string | null;
  onSendGift: () => void;
  showGiftButton: boolean;
  showMessageButton: boolean;
  showMoreButton?: boolean;
  showMenu?: boolean;
  menuButtonRef?: RefObject<HTMLButtonElement | null>;
  menuRef?: RefObject<HTMLDivElement | null>;
  onToggleMenu?: () => void;
  onBlock?: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex w-[240px] shrink-0 flex-col items-end">
      <div className="flex items-center justify-end gap-3">
        <ContactDetailActionButtons {...input} />
      </div>
      {input.showAddFriendButton && input.canAddFriend === false && input.addFriendHint ? (
        <p className="mt-2 text-right text-xs text-amber-600">{input.addFriendHint}</p>
      ) : null}
      <div className="mt-[40px] grid w-full grid-cols-[1fr_18px_1fr_18px_1fr] items-start gap-x-0">
        <StatTile label={i18n.t('Profile.friends', { defaultValue: 'Friends' })} value={input.friendCount} />
        <StatDivider />
        <StatTile label={i18n.t('Profile.posts', { defaultValue: 'Posts' })} value={input.postCount} />
        <StatDivider />
        <StatTile label={i18n.t('Profile.likes', { defaultValue: 'Likes' })} value={input.likesCount} />
      </div>
    </div>
  );
}
