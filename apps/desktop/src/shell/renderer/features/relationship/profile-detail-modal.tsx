import { realmSocialData } from '../social/data/realm-social-data';
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DialogDescription, DialogTitle, OverlayShell } from '@nimiplatform/kit/ui';
import { realmSourceDetailData } from '../source-detail/data/realm-source-detail-data';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store';
import { SendGiftModal } from '../economy/send-gift-modal.js';
import { toProfileData, type ProfileData, type ProfileSource } from '../profile/profile-model';
import { E2E_IDS } from '../../testability/e2e-ids';
import { ProfileDetailView } from './profile-detail-view.js';
import {
  ProfileDetailErrorState,
  ProfileDetailLoadingState,
} from './profile-detail-view-content-shell.js';
import { InlineFeedback, type InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import { RemoveFriendConfirmDialog } from './profile-detail-dialogs.js';
import {
  isPrivateProfileAccessError,
  toRestrictedContactProfileData,
} from './profile-private-state.js';
import { launchAgentConversationFromDisplay } from '../chat/agent-conversation-launcher.js';
import { ensureRuntimeAgentExists } from '../chat/chat-agent-shell-host-actions-helpers';
import { materializeSourceContactLaunchTarget } from './source-contact-launch-target.js';
import { startChatWithTarget } from '../chat/data/realm-human-chat-data';
import type { CharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';
import {
  characterSourceMaterializationFailureMessage,
  characterSourceMaterializationMessage,
  characterSourceRefKey,
  describeCharacterPrimaryAction,
  discoverCharacterSourceLocalAgents,
  resolveCharacterSourceState,
} from '../explore/character-source-materialization';

export type ProfileDetailSeed = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl?: string | null;
  bio?: string | null;
  isSource: boolean;
  isOnline?: boolean;
  createdAt?: string;
  tags?: string[];
  city?: string | null;
  countryCode?: string | null;
  gender?: string | null;
  worldName?: string | null;
  worldBannerUrl?: string | null;
  friendsCount?: number;
  postsCount?: number;
  likesCount?: number;
  giftStats?: Record<string, number>;
  sourceState?: string | null;
  sourceArchetype?: string | null;
  sourceOrigin?: string | null;
  sourceTier?: string | null;
  sourcePacing?: string | null;
  sourceOwnershipType?: string | null;
  sourceWorldId?: string | null;
  sourceKind?: CharacterSourceRefV3['kind'];
  sourceId?: string;
  sourceHash?: string;
  runtimeSourceRef?: string;
  sourceRef?: CharacterSourceRefV3;
};

type ProfileDetailModalProps = {
  open: boolean;
  profileId: string;
  profileSeed: ProfileDetailSeed | null;
  onClose: () => void;
};

const INTERNAL_OPEN_CHAT_ERROR_CODE = 'PROFILE_OPEN_CHAT_FAILED';

export function ProfileDetailModal(props: ProfileDetailModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setChatMode = useAppStore((state) => state.setChatMode);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const setAgentConversationSelection = useAppStore((state) => state.setAgentConversationSelection);
  const setAgentConversationTargetSnapshot = useAppStore((state) => state.setAgentConversationTargetSnapshot);
  const setProfileDetailOverlayOpen = useAppStore((state) => state.setProfileDetailOverlayOpen);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const ownerUserId = String(useAppStore((state) => state.auth.user?.id || '')).trim();
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [removeMutationPending, setRemoveMutationPending] = useState(false);
  const sourceRef = props.profileSeed?.isSource ? props.profileSeed.sourceRef ?? null : null;
  const sourceRefKey = sourceRef ? characterSourceRefKey(sourceRef) : 'missing-source-ref';

  useEffect(() => {
    if (!props.open) {
      return undefined;
    }
    setProfileDetailOverlayOpen(true);
    return () => {
      setProfileDetailOverlayOpen(false);
    };
  }, [props.open, setProfileDetailOverlayOpen]);

  const toChatErrorMessage = useCallback((error: unknown): string => {
    if (error instanceof Error) {
      const next = error.message.trim();
      if (next && next !== INTERNAL_OPEN_CHAT_ERROR_CODE) {
        return next;
      }
    }
    return t('Relationship.openChatFailed', { defaultValue: 'Failed to open chat' });
  }, [t]);

  const profileQuery = useQuery({
    queryKey: [
      'profile-detail-modal',
      props.profileSeed?.isSource ? sourceRefKey : props.profileId,
      props.profileSeed?.handle,
      props.profileSeed?.isSource,
      'restricted-state-v1',
    ],
    queryFn: async () => {
      if (!props.profileSeed?.isSource && !props.profileId) {
        return null;
      }
      try {
        let result: unknown;
        if (props.profileSeed?.isSource) {
          if (!sourceRef) {
            throw new Error(characterSourceMaterializationMessage());
          }
          result = await realmSourceDetailData.loadRealmSourceDetailsBySourceRef(sourceRef, {
            runtimeSourceRef: props.profileSeed.runtimeSourceRef,
          });
        } else {
          result = await realmSocialData.loadUserProfile(props.profileId);
        }
        return toProfileData(result as ProfileSource);
      } catch (error) {
        if (props.profileSeed && !props.profileSeed.isSource && isPrivateProfileAccessError(error)) {
          return toRestrictedContactProfileData(props.profileSeed);
        }
        throw error;
      }
    },
    enabled: props.open && (props.profileSeed?.isSource === true || Boolean(props.profileId)),
    retry: (failureCount, error) => !isPrivateProfileAccessError(error) && failureCount < 1,
  });

  const profile: ProfileData | null = profileQuery.data ?? null;
  const profileDialogName = profile?.displayName || props.profileSeed?.displayName || t('Relationship.profileDetailDialogTitleFallback', {
    defaultValue: 'Profile details',
  });
  const profileDialogTitle = t('Relationship.profileDetailDialogTitle', {
    defaultValue: '{{name}} profile',
    name: profileDialogName,
  });
  const profileDialogDescription = t('Relationship.profileDetailDialogDescription', {
    defaultValue: 'Profile details and relationship actions.',
  });
  const isBlockedProfile = Boolean(profile && realmSocialData.isBlockedUser(profile.id));
  const profileSourceLocalAgentsQuery = useQuery({
    queryKey: [
      'profile-source-local-agents',
      ownerUserId,
      profile?.sourceRef ? characterSourceRefKey(profile.sourceRef) : sourceRefKey,
      profile?.runtimeSourceRef ?? '',
    ],
    queryFn: async () => (profile ? discoverCharacterSourceLocalAgents(profile, ownerUserId) : []),
    enabled: props.open && Boolean(profile?.isSource) && Boolean(ownerUserId),
    staleTime: 10_000,
  });
  const sourceAction = profile?.isSource
    ? describeCharacterPrimaryAction(resolveCharacterSourceState(
        profile,
        profileSourceLocalAgentsQuery.data ?? [],
        {
          runtimeInventoryPending: Boolean(ownerUserId && profileSourceLocalAgentsQuery.isPending),
          runtimeInventoryUnavailable: !ownerUserId || profileSourceLocalAgentsQuery.isError,
        },
      ))
    : null;
  const sourceMaterializationUnavailable = sourceAction?.disabled === true;
  const sourceMaterializationHint = sourceMaterializationUnavailable
    ? sourceAction?.hint ?? characterSourceMaterializationMessage()
    : null;

  const handleConnectSource = useCallback(async () => {
    if (!profile?.isSource) {
      return;
    }
    try {
      if (sourceMaterializationUnavailable) {
        throw new Error(sourceMaterializationHint || characterSourceMaterializationMessage());
      }
      const target = await materializeSourceContactLaunchTarget(profile, ownerUserId);
      await ensureRuntimeAgentExists(target);
      await queryClient.invalidateQueries({ queryKey: ['profile-source-local-agents'], exact: false });
      await launchAgentConversationFromDisplay({
        target,
        setActiveTab,
        setChatMode,
        setSelectedTargetForSource,
        setAgentConversationSelection,
        setAgentConversationTargetSnapshot,
      });
      setFeedback({
        kind: 'success',
        message: t('Explore.characterSourceMaterializedFeedback', {
          defaultValue: 'Your partner is ready. Opening chat.',
        }),
      });
      props.onClose();
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: characterSourceMaterializationFailureMessage(error),
      });
    }
  }, [
    ownerUserId,
    profile,
    props,
    queryClient,
    setActiveTab,
    setAgentConversationSelection,
    setAgentConversationTargetSnapshot,
    setChatMode,
    setSelectedTargetForSource,
    sourceMaterializationHint,
    sourceMaterializationUnavailable,
    t,
  ]);

  const handleMessage = useCallback(async () => {
    if (!profile) {
      return;
    }
    if (isBlockedProfile) {
      return;
    }

    try {
      if (profile.isSource) {
        if (sourceMaterializationUnavailable) {
          throw new Error(characterSourceMaterializationMessage());
        }
        const target = await materializeSourceContactLaunchTarget(profile, ownerUserId);
        await ensureRuntimeAgentExists(target);
        await launchAgentConversationFromDisplay({
          target,
          setActiveTab,
          setChatMode,
          setSelectedTargetForSource,
          setAgentConversationSelection,
          setAgentConversationTargetSnapshot,
        });
        props.onClose();
        return;
      }

      const result = await startChatWithTarget(profile.id);
      if (!result?.chatId) {
        throw new Error(INTERNAL_OPEN_CHAT_ERROR_CODE);
      }
      setRuntimeFields({
        targetType: 'FRIEND',
        targetAccountId: profile.id,
        agentId: '',
        worldId: '',
      });
      await queryClient.invalidateQueries({ queryKey: ['chats'] });
      setActiveTab('chat');
      props.onClose();
      setTimeout(() => {
        setSelectedChatId(String(result.chatId));
      }, 100);
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: profile.isSource ? characterSourceMaterializationFailureMessage(error) : toChatErrorMessage(error),
      });
    }
  }, [
    isBlockedProfile,
    ownerUserId,
    profile,
    props,
    queryClient,
    setActiveTab,
    setAgentConversationSelection,
    setAgentConversationTargetSnapshot,
    setChatMode,
    setRuntimeFields,
    setSelectedChatId,
    setSelectedTargetForSource,
    sourceMaterializationUnavailable,
    toChatErrorMessage,
  ]);

  const handleBlock = useCallback(async () => {
    if (!profile) {
      return;
    }
    try {
      await realmSocialData.blockUser({
        id: profile.id,
        displayName: profile.displayName,
        handle: profile.handle,
        avatarUrl: profile.avatarUrl,
        isSource: profile.isSource,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contacts'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['profile-detail-modal'], exact: false }),
      ]);
      setFeedback(null);
      props.onClose();
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error && error.message.trim()
          ? error.message
          : t('Relationship.blockUserFailed', { defaultValue: 'Failed to block user' }),
      });
    }
  }, [profile, props, queryClient, t]);

  const handleRemove = useCallback(async () => {
    if (!profile) {
      return;
    }
    if (removeMutationPending) {
      return;
    }
    try {
      setRemoveMutationPending(true);
      await realmSocialData.removeFriend(profile.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contacts'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['chats'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['profile-detail-modal'], exact: false }),
      ]);
      setFeedback(null);
      setRemoveConfirmOpen(false);
      props.onClose();
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error && error.message.trim()
          ? error.message
          : t('Relationship.removeFriendFailed', { defaultValue: 'Failed to remove friend' }),
      });
    } finally {
      setRemoveMutationPending(false);
    }
  }, [profile, props, queryClient, removeMutationPending, t]);

  if (!props.open) {
    return null;
  }

  return (
    <>
      <OverlayShell
        open={props.open}
        kind="dialog"
        onClose={props.onClose}
        dataTestId={E2E_IDS.profileDetailModal}
        className="nimi-material-glass-thin bg-slate-950/45 backdrop-blur-[var(--nimi-backdrop-blur-thin)]"
        panelClassName="h-[calc(100vh-88px)] max-w-none overflow-hidden rounded-[28px] border border-white/70 bg-[#f6fafb] shadow-[0_32px_100px_rgba(15,23,42,0.28)]"
        panelStyle={{ width: 'min(1180px, calc(100vw - 88px))', maxHeight: 'calc(100vh - 88px)' }}
        contentClassName="relative h-full min-h-0 p-0"
      >
        <DialogTitle className="sr-only">{profileDialogTitle}</DialogTitle>
        <DialogDescription className="sr-only">{profileDialogDescription}</DialogDescription>
        <button
          type="button"
          data-testid={E2E_IDS.profileDetailModalClose}
          onClick={props.onClose}
          aria-label={t('Common.close', { defaultValue: 'Close' })}
          className="absolute right-5 top-5 z-30 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-white/90 text-slate-600 shadow-[0_14px_34px_rgba(15,23,42,0.14)] transition-[background-color,border-color,color,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] hover:border-[var(--nimi-action-primary-bg)]/55 hover:bg-white hover:text-[var(--nimi-action-primary-bg-hover)] active:scale-[var(--nimi-motion-pressed-scale)]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
        <div className="h-full min-h-0 flex-1 overflow-hidden">
          {feedback ? (
            <div className="px-6 pt-4">
              <InlineFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
            </div>
          ) : null}
          {profile ? (
            <ProfileDetailView
              profile={profile}
              isBlockedProfile={isBlockedProfile}
              isRestrictedProfile={profile.accessState === 'restricted'}
              loading={false}
              error={false}
              onClose={props.onClose}
              onMessage={profile.accessState === 'restricted' ? () => {} : () => {
                void handleMessage();
              }}
              onAddFriend={profile.isSource ? () => {
                void handleConnectSource();
              } : undefined}
              addFriendLabel={profile.isSource
                ? sourceAction?.label ?? t('Relationship.createLocalAgent', { defaultValue: 'Become my partner' })
                : undefined}
              canAddFriend={profile.isSource
                ? !sourceMaterializationUnavailable
                : undefined}
              addFriendHint={profile.isSource ? sourceMaterializationHint : null}
              onSendGift={profile.accessState === 'restricted' ? () => {} : () => setGiftModalOpen(true)}
              onBlock={!isBlockedProfile ? () => {
                void handleBlock();
              } : undefined}
              onRemove={!isBlockedProfile && profile.isFriend ? () => setRemoveConfirmOpen(true) : undefined}
              showMessageButton={
                !isBlockedProfile
                && profile.accessState !== 'restricted'
                && (!profile.isSource || !sourceMaterializationUnavailable)
              }
            />
          ) : profileQuery.isError ? (
            <div className="flex h-full items-center justify-center bg-white">
              <ProfileDetailErrorState
                backLabel={t('Common.back')}
                label={t('ProfileView.error')}
                onClose={props.onClose}
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center bg-white">
              <ProfileDetailLoadingState label={t('ProfileView.loading')} />
            </div>
          )}
        </div>
      </OverlayShell>

      {profile ? (
        <SendGiftModal
          open={giftModalOpen && !isBlockedProfile}
          receiverId={profile.id}
          receiverName={profile.displayName}
          receiverHandle={profile.handle}
          receiverIsSource={profile.isSource === true}
          receiverAvatarUrl={profile.avatarUrl}
          onClose={() => setGiftModalOpen(false)}
          onSent={() => {
            setFeedback(null);
            setGiftModalOpen(false);
          }}
        />
      ) : null}

      {profile && removeConfirmOpen ? (
        <RemoveFriendConfirmDialog
          contact={profile}
          pending={removeMutationPending}
          onConfirm={() => {
            void handleRemove();
          }}
          onCancel={() => {
            if (!removeMutationPending) {
              setRemoveConfirmOpen(false);
            }
          }}
        />
      ) : null}
    </>
  );
}
