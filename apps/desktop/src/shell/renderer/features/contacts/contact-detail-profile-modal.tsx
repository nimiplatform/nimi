import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { OverlayShell } from '@renderer/components/overlay.js';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal.js';
import { toProfileData, type ProfileData, type ProfileSource } from '@renderer/features/profile/profile-model';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { ContactDetailView } from './contact-detail-view.js';
import {
  ContactDetailErrorState,
  ContactDetailLoadingState,
} from './contact-detail-view-content-shell.js';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';

export type ContactDetailProfileSeed = {
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

type ContactDetailProfileModalProps = {
  open: boolean;
  profileId: string;
  profileSeed: ContactDetailProfileSeed | null;
  onClose: () => void;
};

const INTERNAL_OPEN_CHAT_ERROR_CODE = 'CONTACTS_OPEN_CHAT_FAILED';

export function ContactDetailProfileModal(props: ContactDetailProfileModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const setProfileDetailOverlayOpen = useAppStore((state) => state.setProfileDetailOverlayOpen);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);

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
    return t('Contacts.openChatFailed', { defaultValue: 'Failed to open chat' });
  }, [t]);

  const profileQuery = useQuery({
    queryKey: ['contact-detail-modal-profile', props.profileId, props.profileSeed?.handle, props.profileSeed?.isAgent],
    queryFn: async () => {
      if (!props.profileId) {
        return null;
      }
      const result = props.profileSeed?.isAgent
        ? await dataSync.loadAgentDetails(props.profileId)
        : await dataSync.loadUserProfile(props.profileId);
      return toProfileData(result as ProfileSource);
    },
    enabled: props.open && Boolean(props.profileId),
    retry: 1,
  });

  const profile: ProfileData | null = profileQuery.data ?? null;
  const isBlockedProfile = Boolean(profile && dataSync.isBlockedUser(profile.id));

  const handleMessage = useCallback(async () => {
    if (!profile) {
      return;
    }
    if (profile.isAgent || isBlockedProfile) {
      return;
    }

    try {
      const result = await dataSync.startChat(profile.id);
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
    profile,
    props,
    queryClient,
    setRuntimeFields,
    setSelectedChatId,
    t,
    toChatErrorMessage,
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
        queryClient.invalidateQueries({ queryKey: ['contact-detail-modal-profile'], exact: false }),
      ]);
      setFeedback(null);
      props.onClose();
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error && error.message.trim()
          ? error.message
          : t('Contacts.blockUserFailed', { defaultValue: 'Failed to block user' }),
      });
    }
  }, [profile, props, queryClient, t]);

  const handleRemove = useCallback(async () => {
    if (!profile) {
      return;
    }
    try {
      await dataSync.removeFriend(profile.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contacts'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['chats'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['contact-detail-modal-profile'], exact: false }),
      ]);
      setFeedback(null);
      props.onClose();
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error && error.message.trim()
          ? error.message
          : t('Contacts.removeFriendFailed', { defaultValue: 'Failed to remove friend' }),
      });
    }
  }, [profile, props, queryClient, t]);

  if (!props.open) {
    return null;
  }

  return (
    <>
      <OverlayShell
        open={props.open && Boolean(profile)}
        kind="dialog"
        onClose={props.onClose}
        dataTestId={E2E_IDS.contactDetailProfileModal}
        className="top-14 bottom-0 left-0 right-0 bg-black/42 p-0 items-stretch justify-stretch"
        panelClassName="h-full max-w-none rounded-none border-0 bg-white shadow-none"
        contentClassName="h-full p-0"
      >
        <div className="h-full min-h-0 flex-1 overflow-hidden">
          {feedback ? (
            <div className="px-6 pt-4">
              <InlineFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
            </div>
          ) : null}
          {profile ? (
            <ContactDetailView
              profile={profile}
              isBlockedProfile={isBlockedProfile}
              loading={false}
              error={false}
              onClose={props.onClose}
              onMessage={() => {
                void handleMessage();
              }}
              onSendGift={() => setGiftModalOpen(true)}
              onBlock={!isBlockedProfile ? () => {
                void handleBlock();
              } : undefined}
              onRemove={!isBlockedProfile && profile.isFriend ? () => {
                void handleRemove();
              } : undefined}
              showMessageButton={!profile.isAgent && !isBlockedProfile}
            />
          ) : profileQuery.isError ? (
            <div className="flex h-full items-center justify-center bg-white">
              <ContactDetailErrorState
                backLabel={t('Common.back')}
                label={t('ProfileView.error')}
                onClose={props.onClose}
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center bg-white">
              <ContactDetailLoadingState label={t('ProfileView.loading')} />
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
    </>
  );
}
