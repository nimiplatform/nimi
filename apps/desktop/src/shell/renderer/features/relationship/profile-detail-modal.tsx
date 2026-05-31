import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { OverlayShell } from '@nimiplatform/kit/ui';
import { dataSync } from '@runtime/data-sync';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal.js';
import { toProfileData, type ProfileData, type ProfileSource } from '@renderer/features/profile/profile-model';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { ProfileDetailView } from './profile-detail-view.js';
import {
  ProfileDetailErrorState,
  ProfileDetailLoadingState,
} from './profile-detail-view-content-shell.js';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import { RemoveFriendConfirmDialog } from './profile-detail-dialogs.js';
import {
  isPrivateProfileAccessError,
  toRestrictedContactProfileData,
} from './profile-private-state.js';
import { launchAgentConversationFromDisplay } from '@renderer/features/chat/agent-conversation-launcher.js';
import { toAgentContactLaunchTargetFromProfile } from './agent-contact-launch-target.js';
import { startChatWithTarget } from '@renderer/features/chat/data/realm-human-chat-data';

export type ProfileDetailSeed = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl?: string | null;
  bio?: string | null;
  isAgent: boolean;
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
  agentState?: string | null;
  agentCategory?: string | null;
  agentOrigin?: string | null;
  agentTier?: string | null;
  agentWakeStrategy?: string | null;
  agentOwnershipType?: string | null;
  agentWorldId?: string | null;
  agentOwnerWorldId?: string | null;
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
  const setProfileDetailOverlayOpen = useAppStore((state) => state.setProfileDetailOverlayOpen);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const ownerUserId = String(useAppStore((state) => state.auth.user?.id || '')).trim();
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [removeMutationPending, setRemoveMutationPending] = useState(false);

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
    queryKey: ['profile-detail-modal', props.profileId, props.profileSeed?.handle, props.profileSeed?.isAgent, 'restricted-state-v1'],
    queryFn: async () => {
      if (!props.profileId) {
        return null;
      }
      try {
        const result = props.profileSeed?.isAgent
          ? await dataSync.loadAgentDetails(props.profileId)
          : await dataSync.loadUserProfile(props.profileId);
        return toProfileData(result as ProfileSource);
      } catch (error) {
        if (props.profileSeed && !props.profileSeed.isAgent && isPrivateProfileAccessError(error)) {
          return toRestrictedContactProfileData(props.profileSeed);
        }
        throw error;
      }
    },
    enabled: props.open && Boolean(props.profileId),
    retry: (failureCount, error) => !isPrivateProfileAccessError(error) && failureCount < 1,
  });

  const profile: ProfileData | null = profileQuery.data ?? null;
  const isBlockedProfile = Boolean(profile && dataSync.isBlockedUser(profile.id));

  const handleMessage = useCallback(async () => {
    if (!profile) {
      return;
    }
    if (isBlockedProfile) {
      return;
    }

    try {
      if (profile.isAgent) {
        if (!profile.isFriend) {
          throw new Error(t('Relationship.agentFriendRequiredForChat', { defaultValue: 'Add this Agent as a friend before opening local chat.' }));
        }
        await launchAgentConversationFromDisplay({
          target: toAgentContactLaunchTargetFromProfile(profile, ownerUserId),
          setActiveTab,
          setChatMode,
          setSelectedTargetForSource,
          setAgentConversationSelection,
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
        message: toChatErrorMessage(error),
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
    setChatMode,
    setRuntimeFields,
    setSelectedChatId,
    setSelectedTargetForSource,
    toChatErrorMessage,
    t,
  ]);

  const handleBlock = useCallback(async () => {
    if (!profile) {
      return;
    }
    try {
      await dataSync.blockUser({
        id: profile.id,
        displayName: profile.displayName,
        handle: profile.handle,
        avatarUrl: profile.avatarUrl,
        isAgent: profile.isAgent,
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
      await dataSync.removeFriend(profile.id);
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
        <button
          type="button"
          data-testid={E2E_IDS.profileDetailModalClose}
          onClick={props.onClose}
          aria-label={t('Common.close', { defaultValue: 'Close' })}
          className="absolute right-5 top-5 z-30 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-white/90 text-slate-600 shadow-[0_14px_34px_rgba(15,23,42,0.14)] transition hover:border-[#4ECCA3]/55 hover:bg-white hover:text-[#1f8f69]"
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
              onSendGift={profile.accessState === 'restricted' ? () => {} : () => setGiftModalOpen(true)}
              onBlock={!isBlockedProfile ? () => {
                void handleBlock();
              } : undefined}
              onRemove={!isBlockedProfile && profile.isFriend ? () => setRemoveConfirmOpen(true) : undefined}
              showMessageButton={
                !isBlockedProfile
                && profile.accessState !== 'restricted'
                && (!profile.isAgent || profile.isFriend)
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
          receiverIsAgent={profile.isAgent === true}
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
