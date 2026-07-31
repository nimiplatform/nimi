import { useRealmSocialData } from '../social/data/realm-social-data-context.js';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Avatar, Popover, PopoverContent, PopoverTrigger } from '@nimiplatform/kit/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store';
import { EntityAvatar } from '../../components/entity-avatar';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import {
  toHumanProfileData,
  type HumanProfileSource,
} from '../profile/profile-model';
import {
  ProfileDetailModal,
  type HumanProfileDetailSeed,
} from '../relationship/profile-detail-modal.js';
import {
  characterSourceRefKey,
  type CharacterSourceRefV3,
} from '../realm-source/realm-source-identity.js';

export type ChatComposerLeadingAvatarPreviewTarget =
  | {
      kind: 'human';
      profileId: string;
      handle?: string | null;
      worldName?: string | null;
    }
  | {
      kind: 'character';
      sourceRef: CharacterSourceRefV3;
      handle?: string | null;
      worldName?: string | null;
    };

type ComposerAvatarPreview = {
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  city: string | null;
  countryCode: string | null;
  worldName: string | null;
};

type ChatComposerLeadingAvatarBaseProps = {
  name: string;
  imageUrl?: string | null;
  fallbackLabel?: string | null;
  triggerTestId?: string;
  openProfileTestId?: string;
};

export type ChatComposerLeadingAvatarProps =
  | (ChatComposerLeadingAvatarBaseProps & {
      kind: 'human';
      preview?: Extract<ChatComposerLeadingAvatarPreviewTarget, { kind: 'human' }> | null;
      onOpenHumanProfilePage?: (profileId: string) => void;
    })
  | (ChatComposerLeadingAvatarBaseProps & {
      kind: 'agent';
      preview?: Extract<ChatComposerLeadingAvatarPreviewTarget, { kind: 'character' }> | null;
      onOpenHumanProfilePage?: never;
    });

const HOVER_OPEN_DELAY_MS = 180;
const HOVER_CLOSE_DELAY_MS = 140;

export function ChatComposerLeadingAvatar(props: ChatComposerLeadingAvatarProps) {
  const resolvedName = props.name.trim() || props.fallbackLabel?.trim() || '?';
  const preview = props.preview?.kind === 'human'
    ? (props.preview.profileId.trim() ? props.preview : null)
    : props.preview?.kind === 'character'
      ? props.preview
      : null;

  const visual = (
    <Avatar
      src={props.imageUrl || null}
      alt={resolvedName}
      shape="circle"
      tone="neutral"
      className="h-8 w-8"
      fallbackClassName="text-[11px] font-semibold"
    />
  );

  if (!preview) {
    return (
      <div
        data-chat-shared-composer-leading-avatar="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center"
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
      target={preview}
      triggerTestId={props.triggerTestId}
      openProfileTestId={props.openProfileTestId}
      onOpenHumanProfilePage={props.onOpenHumanProfilePage}
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
  target: ChatComposerLeadingAvatarPreviewTarget;
  triggerTestId?: string;
  openProfileTestId?: string;
  onOpenHumanProfilePage?: (profileId: string) => void;
  children: ReactNode;
}) {
  const realmSocialData = useRealmSocialData();
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const navigateToSourceDetail = useAppStore((state) => state.navigateToSourceDetail);
  const bindings = useDesktopRendererBindings();
  const [open, setOpen] = useState(false);
  const [humanProfileModalOpen, setHumanProfileModalOpen] = useState(false);
  const openTimerRef = useRef<(() => void) | null>(null);
  const closeTimerRef = useRef<(() => void) | null>(null);
  const humanProfileId = props.target.kind === 'human' ? props.target.profileId : '';
  const previewTargetKey = props.target.kind === 'human'
    ? props.target.profileId
    : characterSourceRefKey(props.target.sourceRef);

  const cancelTimers = useCallback(() => {
    openTimerRef.current?.();
    openTimerRef.current = null;
    closeTimerRef.current?.();
    closeTimerRef.current = null;
  }, []);

  useEffect(() => () => cancelTimers(), [cancelTimers]);

  const scheduleOpen = useCallback(() => {
    cancelTimers();
    openTimerRef.current = bindings.clock.schedule(HOVER_OPEN_DELAY_MS, (result) => {
      openTimerRef.current = null;
      if (result.ok) setOpen(true);
    });
  }, [bindings.clock, cancelTimers]);

  const scheduleClose = useCallback(() => {
    cancelTimers();
    closeTimerRef.current = bindings.clock.schedule(HOVER_CLOSE_DELAY_MS, (result) => {
      closeTimerRef.current = null;
      if (result.ok) setOpen(false);
    });
  }, [bindings.clock, cancelTimers]);

  const profileQuery = useQuery({
    queryKey: ['chat-composer-avatar-preview', props.target.kind, previewTargetKey],
    queryFn: async () => {
      if (props.target.kind !== 'human') {
        return null;
      }
      const result = await realmSocialData.loadUserProfile(props.target.profileId);
      return result as Record<string, unknown>;
    },
    enabled: open
      && authStatus === 'authenticated'
      && props.target.kind === 'human'
      && Boolean(humanProfileId),
    staleTime: 60_000,
  });

  const humanSeed: HumanProfileSource | null = props.target.kind === 'human'
    ? {
        id: props.target.profileId,
        displayName: props.name,
        handle: (props.handleHint || '').replace(/^@/, ''),
        avatarUrl: props.imageUrl,
      }
    : null;
  const humanProfile = humanSeed
    ? toHumanProfileData(profileQuery.data
        ? { ...humanSeed, ...(profileQuery.data as HumanProfileSource) }
        : humanSeed)
    : null;
  const previewProfile: ComposerAvatarPreview = humanProfile
    ? {
        displayName: humanProfile.displayName,
        handle: humanProfile.handle,
        avatarUrl: humanProfile.avatarUrl,
        city: humanProfile.city,
        countryCode: humanProfile.countryCode,
        worldName: props.worldNameHint,
      }
    : {
        avatarUrl: props.imageUrl,
        city: null,
        countryCode: null,
        displayName: props.name,
        handle: (props.handleHint || '').replace(/^@/, ''),
        worldName: props.worldNameHint,
      };
  const isLoading = props.target.kind === 'human'
    && profileQuery.isFetching
    && !profileQuery.data;

  const handleOpenProfile = useCallback(() => {
    cancelTimers();
    setOpen(false);
    if (props.target.kind === 'character') {
      navigateToSourceDetail(props.target.sourceRef);
      return;
    }
    if (!props.target.profileId) {
      return;
    }
    if (props.onOpenHumanProfilePage) {
      props.onOpenHumanProfilePage(props.target.profileId);
      return;
    }
    setHumanProfileModalOpen(true);
  }, [cancelTimers, navigateToSourceDetail, props.onOpenHumanProfilePage, props.target]);

  const handleTriggerClick = useCallback(() => {
    cancelTimers();
    setOpen(true);
  }, [cancelTimers]);

  const ariaLabel = props.target.kind === 'character'
    ? t('Chat.composerAvatarOpenCharacter', { defaultValue: 'Open character profile' })
    : t('Chat.composerAvatarOpenContact', { defaultValue: 'Open profile' });

  const humanProfileSeed: HumanProfileDetailSeed | null = humanProfileModalOpen
    && props.target.kind === 'human'
    ? {
        id: props.target.profileId,
        displayName: props.name,
        handle: (props.handleHint || '').replace(/^@/, ''),
        avatarUrl: props.imageUrl,
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
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-transparent p-0 transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
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
            profile={previewProfile}
            kind={props.target.kind}
            isLoading={isLoading}
            onOpenProfile={handleOpenProfile}
            openProfileTestId={props.openProfileTestId}
          />
        </PopoverContent>
      </Popover>
      {humanProfileModalOpen && props.target.kind === 'human' ? (
        <ProfileDetailModal
          open
          profileId={props.target.profileId}
          profileSeed={humanProfileSeed}
          onClose={() => setHumanProfileModalOpen(false)}
        />
      ) : null}
    </>
  );
}

function ChatComposerAvatarPreviewCard(props: {
  profile: ComposerAvatarPreview;
  kind: 'character' | 'human';
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
  const openLabel = props.kind === 'character'
    ? t('Chat.composerAvatarOpenCharacter', { defaultValue: 'Open character profile' })
    : t('Chat.composerAvatarOpenContact', { defaultValue: 'Open profile' });

  return (
    <button
      type="button"
      onClick={props.onOpenProfile}
      data-testid={props.openProfileTestId}
      className="flex w-full flex-col gap-3 p-4 text-left transition hover:bg-[color-mix(in_srgb,var(--nimi-surface-overlay)_92%,var(--nimi-action-primary-bg)_8%)] focus:outline-none"
    >
      <div className="flex items-start gap-3">
        <EntityAvatar
          imageUrl={profile.avatarUrl}
          name={profile.displayName}
          kind={props.kind === 'character' ? 'agent' : 'human'}
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
          <span className="mt-1 inline-flex items-center rounded-full bg-[var(--nimi-action-primary-bg)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--nimi-action-primary-bg)]">
            {props.kind === 'character'
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
      <span className="mt-1 inline-flex h-7 w-full items-center justify-center rounded-full bg-[var(--nimi-action-primary-bg)] px-3 text-[11px] font-semibold text-[var(--nimi-action-primary-text)]">
        {openLabel}
      </span>
    </button>
  );
}

function PreviewMetaRow(props: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--nimi-action-primary-bg)]/10 text-[var(--nimi-action-primary-bg)]">
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
