import { useRealmSocialData } from '../social/data/realm-social-data-context.js';
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DialogDescription, DialogTitle, OverlayShell } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store';
import {
  requireHumanAccountId,
  toHumanProfileData,
  type HumanProfileData,
  type HumanProfileSource,
} from '../profile/profile-model';
import { E2E_IDS } from '../../testability/e2e-ids';
import { ProfileDetailView } from './profile-detail-view.js';
import {
  ProfileDetailErrorState,
  ProfileDetailLoadingState,
} from './profile-detail-view-content-shell.js';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast';
import { BlockUserConfirmDialog, RemoveFriendConfirmDialog } from './profile-detail-dialogs.js';
import {
  isPrivateProfileAccessError,
  toRestrictedHumanProfileData,
} from './profile-private-state.js';
import { useRealmHumanChatData } from '../chat/data/realm-human-chat-data-context.js';
import { isPendingSentRequestInContacts } from '../social/data/social-snapshot.js';

export type HumanProfileDetailSeed = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl?: string | null;
  bio?: string | null;
  isOnline?: boolean;
  createdAt?: string;
  friendsSince?: string | null;
  tags?: string[];
  city?: string | null;
  countryCode?: string | null;
  gender?: string | null;
  friendsCount?: number;
  postsCount?: number;
  likesCount?: number;
  isFriend?: boolean;
  isPendingFriendRequest?: boolean;
};

type ProfileDetailModalProps = {
  open: boolean;
  profileId: string;
  profileSeed: HumanProfileDetailSeed | null;
  onClose: () => void;
};

const INTERNAL_OPEN_CHAT_ERROR_CODE = 'PROFILE_OPEN_CHAT_FAILED';

export function ProfileDetailModal(props: ProfileDetailModalProps) {
  const realmHumanChatData = useRealmHumanChatData();
  const realmSocialData = useRealmSocialData();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const setProfileDetailOverlayOpen = useAppStore((state) => state.setProfileDetailOverlayOpen);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const setFeedback = emitFeedbackToast;
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [removeMutationPending, setRemoveMutationPending] = useState(false);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [blockMutationPending, setBlockMutationPending] = useState(false);

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
      'human-profile-detail',
      props.profileId,
      props.profileSeed?.handle,
      'restricted-state-v1',
    ],
    queryFn: async () => {
      if (!props.profileId) {
        return null;
      }
      const profileId = requireHumanAccountId(props.profileId);
      if (props.profileSeed && requireHumanAccountId(props.profileSeed.id) !== profileId) {
        throw new Error('Human profile seed accountId does not match navigation accountId');
      }
      try {
        const result = await realmSocialData.loadUserProfile(profileId);
        const isFriend = realmSocialData.isFriend(profileId);
        const isPendingFriendRequest = isPendingSentRequestInContacts(
          realmSocialData.contacts(),
          profileId,
        );
        return toHumanProfileData({
          ...(result as HumanProfileSource),
          isFriend,
          isPendingFriendRequest,
        });
      } catch (error) {
        if (props.profileSeed && isPrivateProfileAccessError(error)) {
          return toRestrictedHumanProfileData(props.profileSeed);
        }
        throw error;
      }
    },
    enabled: props.open && Boolean(props.profileId),
    retry: (failureCount, error) => !isPrivateProfileAccessError(error) && failureCount < 1,
  });

  const profile: HumanProfileData | null = profileQuery.data ?? null;
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

  const handleMessage = useCallback(async () => {
    if (!profile) {
      return;
    }
    if (isBlockedProfile) {
      return;
    }

    try {
      const result = await realmHumanChatData.startChatWithTarget(profile.id);
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
      setSelectedChatId(String(result.chatId));
      setActiveTab('chat');
      props.onClose();
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
    setActiveTab,
    setRuntimeFields,
    setSelectedChatId,
    toChatErrorMessage,
  ]);

  const handleAddFriend = useCallback(async () => {
    if (!profile || isBlockedProfile || profile.isFriend || profile.isPendingFriendRequest) {
      return;
    }
    try {
      await realmSocialData.requestOrAcceptFriend(profile.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contacts'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['user-profile'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['human-profile-detail'], exact: false }),
      ]);
      setFeedback({
        kind: 'success',
        message: t('Relationship.addContactSuccess', { defaultValue: 'Friend request sent.' }),
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error && error.message.trim()
          ? error.message
          : t('Relationship.addContactFailed', { defaultValue: 'Failed to add contact' }),
      });
    }
  }, [isBlockedProfile, profile, queryClient, t]);

  const handleBlock = useCallback(async () => {
    if (!profile) {
      return;
    }
    if (blockMutationPending) {
      return;
    }
    try {
      setBlockMutationPending(true);
      await realmSocialData.blockUser({
        id: profile.id,
        displayName: profile.displayName,
        handle: profile.handle,
        avatarUrl: profile.avatarUrl,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contacts'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['human-profile-detail'], exact: false }),
      ]);
      setFeedback({
        kind: 'success',
        message: t('Relationship.blockUserSuccess', { defaultValue: 'User blocked.' }),
      });
      setBlockConfirmOpen(false);
      props.onClose();
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error && error.message.trim()
          ? error.message
          : t('Relationship.blockUserFailed', { defaultValue: 'Failed to block user' }),
      });
    } finally {
      setBlockMutationPending(false);
    }
  }, [profile, props, queryClient, blockMutationPending, t]);

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
        queryClient.invalidateQueries({ queryKey: ['human-profile-detail'], exact: false }),
      ]);
      setFeedback({
        kind: 'success',
        message: t('Relationship.removeFriendSuccess', { defaultValue: 'Friend removed.' }),
      });
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
        className="nimi-material-glass-thin bg-[var(--nimi-scrim-modal)] backdrop-blur-[var(--nimi-backdrop-blur-thin)]"
        panelClassName="h-[calc(100cqh-88px)] max-w-none overflow-hidden rounded-[var(--nimi-radius-xl)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] shadow-[var(--nimi-elevation-floating)]"
        panelStyle={{ width: 'min(1180px, calc(100cqw - 88px))', maxHeight: 'calc(100cqh - 88px)' }}
        contentClassName="relative h-full min-h-0 p-0"
      >
        <DialogTitle className="sr-only">{profileDialogTitle}</DialogTitle>
        <DialogDescription className="sr-only">{profileDialogDescription}</DialogDescription>
        <button
          type="button"
          data-testid={E2E_IDS.profileDetailModalClose}
          onClick={props.onClose}
          aria-label={t('Common.close', { defaultValue: 'Close' })}
          className="absolute right-5 top-5 z-30 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,transparent)] text-[var(--nimi-text-secondary)] shadow-[var(--nimi-elevation-raised)] transition-[background-color,border-color,color,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] hover:border-[var(--nimi-action-primary-bg)]/55 hover:bg-[var(--nimi-surface-card)] hover:text-[var(--nimi-action-primary-bg-hover)] active:scale-[var(--nimi-motion-pressed-scale)]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
        <div className="h-full min-h-0 flex-1 overflow-hidden">
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
              onAddFriend={!isBlockedProfile && !profile.isFriend && !profile.isPendingFriendRequest ? () => {
                void handleAddFriend();
              } : undefined}
              onBlock={!isBlockedProfile ? () => setBlockConfirmOpen(true) : undefined}
              onRemove={!isBlockedProfile && profile.isFriend ? () => setRemoveConfirmOpen(true) : undefined}
              showMessageButton={
                !isBlockedProfile
                && profile.accessState !== 'restricted'
              }
            />
          ) : profileQuery.isError ? (
            <div className="flex h-full items-center justify-center bg-[var(--nimi-surface-canvas)]">
              <ProfileDetailErrorState
                backLabel={t('Common.back')}
                label={t('ProfileView.error')}
                onClose={props.onClose}
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center bg-[var(--nimi-surface-canvas)]">
              <ProfileDetailLoadingState label={t('ProfileView.loading')} />
            </div>
          )}
        </div>
      </OverlayShell>

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

      {profile && blockConfirmOpen ? (
        <BlockUserConfirmDialog
          contact={profile}
          pending={blockMutationPending}
          onConfirm={() => {
            void handleBlock();
          }}
          onCancel={() => {
            if (!blockMutationPending) {
              setBlockConfirmOpen(false);
            }
          }}
        />
      ) : null}
    </>
  );
}
