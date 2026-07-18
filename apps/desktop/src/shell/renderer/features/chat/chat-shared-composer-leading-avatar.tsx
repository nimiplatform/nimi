import { realmSocialData } from '@renderer/features/social/data/realm-social-data';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@nimiplatform/kit/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { EntityAvatar } from '@renderer/components/entity-avatar';
import { toProfileData, type ProfileData, type ProfileSource } from '@renderer/features/profile/profile-model';
import {
  ProfileDetailModal,
  type ProfileDetailSeed,
} from '@renderer/features/relationship/profile-detail-modal.js';

export type ChatComposerLeadingAvatarPreviewTarget = {
  targetId: string;
  handle?: string | null;
  worldName?: string | null;
};

export type ChatComposerLeadingAvatarProps = {
  name: string;
  imageUrl?: string | null;
  fallbackLabel?: string | null;
  kind: 'agent' | 'human';
  preview?: ChatComposerLeadingAvatarPreviewTarget | null;
  triggerTestId?: string;
  openProfileTestId?: string;
  onOpenProfilePage?: (targetId: string) => void;
};

const HOVER_OPEN_DELAY_MS = 180;
const HOVER_CLOSE_DELAY_MS = 140;

export function ChatComposerLeadingAvatar(props: ChatComposerLeadingAvatarProps) {
  const resolvedName = props.name.trim() || props.fallbackLabel?.trim() || '?';
  const previewTargetId = props.preview?.targetId?.trim() || '';
  const preview = previewTargetId ? props.preview! : null;

  const visual = (
    <EntityAvatar
      imageUrl={props.imageUrl || null}
      name={resolvedName}
      kind={props.kind}
      sizeClassName="h-9 w-9"
      className="shadow-[0_8px_18px_rgba(15,23,42,0.12)]"
      textClassName="text-[11px] font-semibold"
    />
  );

  if (!preview) {
    return (
      <div
        data-chat-shared-composer-leading-avatar="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        {visual}
      </div>
    );
  }

  return (
    <ChatComposerAvatarHoverPreview
      kind={props.kind}
      name={resolvedName}
      imageUrl={props.imageUrl || null}
      handleHint={preview.handle || null}
      worldNameHint={preview.worldName || null}
      targetId={preview.targetId}
      triggerTestId={props.triggerTestId}
      openProfileTestId={props.openProfileTestId}
      onOpenProfilePage={props.onOpenProfilePage}
    >
      {visual}
    </ChatComposerAvatarHoverPreview>
  );
}

function ChatComposerAvatarHoverPreview(props: {
  kind: 'agent' | 'human';
  name: string;
  imageUrl: string | null;
  handleHint: string | null;
  worldNameHint: string | null;
  targetId: string;
  triggerTestId?: string;
  openProfileTestId?: string;
  onOpenProfilePage?: (targetId: string) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const [open, setOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const cancelTimers = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => cancelTimers(), [cancelTimers]);

  const scheduleOpen = useCallback(() => {
    cancelTimers();
    openTimerRef.current = window.setTimeout(() => setOpen(true), HOVER_OPEN_DELAY_MS);
  }, [cancelTimers]);

  const scheduleClose = useCallback(() => {
    cancelTimers();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS);
  }, [cancelTimers]);

  const profileQuery = useQuery({
    queryKey: ['chat-composer-avatar-preview', props.kind, props.targetId],
    queryFn: async () => {
      const result = await realmSocialData.loadUserProfile(props.targetId);
      return result as Record<string, unknown>;
    },
    enabled: open && authStatus === 'authenticated' && props.kind === 'human' && Boolean(props.targetId),
    staleTime: 60_000,
  });

  const seed: ProfileSource = {
    id: props.targetId,
    displayName: props.name,
    handle: (props.handleHint || '').replace(/^@/, ''),
    avatarUrl: props.imageUrl,
    isSource: props.kind === 'agent',
    worldName: props.worldNameHint,
  };
  const profileSource: ProfileSource = profileQuery.data
    ? { ...seed, ...(profileQuery.data as ProfileSource) }
    : seed;
  const profile = toProfileData(profileSource);
  const isLoading = profileQuery.isFetching && !profileQuery.data;

  const handleOpenProfile = useCallback(() => {
    cancelTimers();
    setOpen(false);
    if (!props.targetId) {
      return;
    }
    if (props.onOpenProfilePage) {
      props.onOpenProfilePage(props.targetId);
      return;
    }
    setProfileModalOpen(true);
  }, [cancelTimers, props.onOpenProfilePage, props.targetId]);

  const handleTriggerClick = useCallback(() => {
    cancelTimers();
    setOpen(true);
  }, [cancelTimers]);

  const ariaLabel = props.kind === 'agent'
    ? t('Chat.composerAvatarOpenSource', { defaultValue: 'Open persona profile' })
    : t('Chat.composerAvatarOpenContact', { defaultValue: 'Open profile' });

  const profileSeed: ProfileDetailSeed | null = profileModalOpen
    ? {
        id: props.targetId,
        displayName: props.name,
        handle: (props.handleHint || '').replace(/^@/, ''),
        avatarUrl: props.imageUrl,
        isSource: props.kind === 'agent',
        worldName: props.worldNameHint,
      }
    : null;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-chat-shared-composer-leading-avatar="true"
            data-testid={props.triggerTestId}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-transparent p-0 transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4ECCA3]/60"
            onMouseEnter={scheduleOpen}
            onMouseLeave={scheduleClose}
            onFocus={scheduleOpen}
            onBlur={scheduleClose}
            onClick={handleTriggerClick}
            aria-label={ariaLabel}
          >
            {props.children}
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={10}
          onMouseEnter={() => {
            cancelTimers();
            setOpen(true);
          }}
          onMouseLeave={scheduleClose}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="w-[280px] overflow-hidden rounded-2xl"
        >
          <ChatComposerAvatarPreviewCard
            profile={profile}
            kind={props.kind}
            isLoading={isLoading}
            onOpenProfile={handleOpenProfile}
            openProfileTestId={props.openProfileTestId}
          />
        </PopoverContent>
      </Popover>
      {profileModalOpen ? (
        <ProfileDetailModal
          open
          profileId={props.targetId}
          profileSeed={profileSeed}
          onClose={() => setProfileModalOpen(false)}
        />
      ) : null}
    </>
  );
}

function ChatComposerAvatarPreviewCard(props: {
  profile: ProfileData;
  kind: 'agent' | 'human';
  isLoading: boolean;
  onOpenProfile: () => void;
  openProfileTestId?: string;
}) {
  const { t } = useTranslation();
  const profile = props.profile;
  const handleLabel = profile.handle
    ? (profile.handle.startsWith('@') ? profile.handle : `@${profile.handle}`)
    : null;
  const locationLabel = profile.city && profile.countryCode
    ? `${profile.city}, ${profile.countryCode.toUpperCase()}`
    : profile.city || profile.countryCode?.toUpperCase() || null;
  const hasMeta = Boolean(profile.worldName || locationLabel);
  const openLabel = props.kind === 'agent'
    ? t('Chat.composerAvatarOpenSource', { defaultValue: 'Open persona profile' })
    : t('Chat.composerAvatarOpenContact', { defaultValue: 'Open profile' });

  return (
    <button
      type="button"
      onClick={props.onOpenProfile}
      data-testid={props.openProfileTestId}
      className="flex w-full flex-col gap-3 p-4 text-left transition hover:bg-[color-mix(in_srgb,var(--nimi-surface-overlay)_92%,#4ECCA3_8%)] focus:outline-none"
    >
      <div className="flex items-start gap-3">
        <EntityAvatar
          imageUrl={profile.avatarUrl}
          name={profile.displayName}
          kind={props.kind}
          sizeClassName="h-12 w-12"
          textClassName="text-base font-semibold"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">
            {profile.displayName}
          </div>
          {handleLabel ? (
            <div className="truncate text-xs text-[var(--nimi-text-secondary)]">
              {handleLabel}
            </div>
          ) : null}
          <span className="mt-1 inline-flex items-center rounded-full bg-[#4ECCA3]/10 px-2 py-0.5 text-[10px] font-medium text-[#2A9D8F]">
            {props.kind === 'agent'
              ? t('ChatTimeline.agent', { defaultValue: 'Agent' })
              : t('ChatTimeline.human', { defaultValue: 'Human' })}
          </span>
        </div>
      </div>
      {hasMeta ? (
        <div className="space-y-1.5 text-xs text-[var(--nimi-text-secondary)]">
          {profile.worldName ? (
            <PreviewMetaRow icon={<GlobeIcon className="h-3.5 w-3.5" />} label={profile.worldName} />
          ) : null}
          {locationLabel ? (
            <PreviewMetaRow icon={<PinIcon className="h-3.5 w-3.5" />} label={locationLabel} />
          ) : null}
        </div>
      ) : props.isLoading ? (
        <div className="text-xs text-[var(--nimi-text-secondary)]">
          {t('Common.loading', { defaultValue: 'Loading…' })}
        </div>
      ) : null}
      <span className="mt-1 inline-flex h-7 w-full items-center justify-center rounded-full bg-[#4ECCA3] px-3 text-[11px] font-semibold text-white">
        {openLabel}
      </span>
    </button>
  );
}

function PreviewMetaRow(props: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[#4ECCA3]/10 text-[#4ECCA3]">
        {props.icon}
      </span>
      <span className="truncate">{props.label}</span>
    </div>
  );
}

function GlobeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function PinIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
