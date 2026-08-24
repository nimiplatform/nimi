import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useRealmSocialData } from '../social/data/realm-social-data-context.js';
import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { ScrollArea, Surface } from '@nimiplatform/kit/ui';
import {
  isPendingSentRequestInContacts,
  type SocialContactSnapshot,
} from '../social/data/social-snapshot';

import { useAppStore } from '../../app-shell/providers/app-store';
import { ProfileDetailView, type EditableProfileDraft } from '../relationship/profile-detail-view.js';
import {
  ProfileDetailErrorState,
  ProfileDetailLoadingState,
} from '../relationship/profile-detail-view-content-shell.js';
import { E2E_IDS } from '../../testability/e2e-ids';
import {
  requireHumanAccountId,
  toHumanProfileData,
  type HumanProfileSource,
} from './profile-model.js';
import { toFriendContact, type ContactRecord } from '../relationship/relationship-model';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast';
import {
  BlockUserConfirmDialog,
  RemoveFriendConfirmDialog,
} from '../relationship/profile-detail-dialogs.js';
import { parseOptionalJsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import { useRealmHumanChatData } from '../chat/data/realm-human-chat-data-context.js';

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const next = error.message.trim();
    if (next) {
      return next;
    }
  }
  return fallback;
}

export function ProfilePanel() {
  const realmHumanChatData = useRealmHumanChatData();
  const realmSocialData = useRealmSocialData();
  const i18n = useDesktopI18nResource().instance;
  const authStatus = useAppStore((state) => state.auth.status);
  const currentUser = useAppStore((state) => state.auth.user);
  const setAuthSession = useAppStore((state) => state.setAuthSession);
  const selectedProfileId = useAppStore((state) => state.selectedProfileId);
  const navigateBack = useAppStore((state) => state.navigateBack);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const queryClient = useQueryClient();
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [removeMutationPending, setRemoveMutationPending] = useState(false);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [blockMutationPending, setBlockMutationPending] = useState(false);
  const setFeedback = emitFeedbackToast;
  const profileScrollContainerRef = useRef<HTMLDivElement>(null);

  const isOwnProfile = !selectedProfileId;

  // Try to get contact info from cache for fallback
  const getContactFromCache = (id: string): ContactRecord | null => {
    const contactsData = queryClient.getQueryData<SocialContactSnapshot>(['contacts', 'authenticated']);
    if (contactsData?.friends) {
      return contactsData.friends.map((item) => toFriendContact(item)).find((f) => f.id === id) || null;
    }
    return null;
  };

  const profileQuery = useQuery({
    queryKey: ['user-profile', selectedProfileId],
    queryFn: async () => {
      const profileId = requireHumanAccountId(selectedProfileId);
      try {
        const result = await realmSocialData.loadUserProfile(profileId);
        const data: HumanProfileSource = result;
        // API may not return isFriend - check local contacts
        if (data.isFriend !== true && (realmSocialData.isFriend(profileId) || Boolean(getContactFromCache(profileId)))) {
          return { ...data, isFriend: true };
        }
        // Check if a pending sent request exists in local cache
        if (data.isPendingFriendRequest !== true && isPendingSentRequestInContacts(realmSocialData.contacts(), profileId)) {
          return { ...data, isPendingFriendRequest: true };
        }
        return data;
      } catch (error) {
        // If API fails, try to get from contacts cache
        const contact = getContactFromCache(profileId);
        if (contact) {
          // Convert contact to profile format
          return {
            id: contact.id,
            displayName: contact.displayName,
            handle: contact.handle,
            avatarUrl: contact.avatarUrl,
            bio: contact.bio,
            createdAt: contact.friendsSince,
            isFriend: true,
            tags: contact.tags || [],
          } satisfies HumanProfileSource;
        }
        // Re-throw if not in cache
        throw error;
      }
    },
    enabled: authStatus === 'authenticated' && !!selectedProfileId,
    retry: 1,
  });
  const profile = useMemo(() => {
    if (isOwnProfile && currentUser) {
      return toHumanProfileData(currentUser);
    }
    if (profileQuery.data) {
      return toHumanProfileData(profileQuery.data);
    }
    return null;
  }, [isOwnProfile, currentUser, profileQuery.data]);

  const loading = !isOwnProfile && profileQuery.isPending;
  const error = !isOwnProfile && profileQuery.isError;
  const isBlockedProfile = Boolean(!isOwnProfile && profile && realmSocialData.isBlockedUser(profile.id));

  const onMessage = async () => {
    if (!profile) {
      return;
    }

    try {
      const result = await realmHumanChatData.startChatWithTarget(profile.id);
      if (result?.chatId) {
        setSelectedChatId(String(result.chatId));
      }
      const chatsSnapshot = await realmHumanChatData.loadChatList();
      queryClient.setQueriesData({ queryKey: ['chats'] }, () => chatsSnapshot);
      setRuntimeFields({
        targetType: 'FRIEND',
        targetAccountId: profile.id,
        agentId: '',
        worldId: '',
      });
      setActiveTab('chat');
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: toErrorMessage(error, i18n.t('Relationship.openChatFailed', { defaultValue: 'Failed to open chat' })),
      });
    }
  };

  const onAddFriend = async () => {
    if (!profile) return;
    try {
      if (!selectedProfileId) {
        return;
      }
      await realmSocialData.requestOrAcceptFriend(selectedProfileId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contacts'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['user-profile'], exact: false }),
      ]);
      setFeedback({
        kind: 'success',
        message: i18n.t('Relationship.addContactSuccess', { defaultValue: 'Friend request sent.' }),
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: toErrorMessage(error, i18n.t('Relationship.addContactFailed', { defaultValue: 'Failed to add contact' })),
      });
    }
  };

  const onBlockProfile = async () => {
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
        bio: profile.bio,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contacts'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['user-profile'], exact: false }),
      ]);
      setFeedback({
        kind: 'success',
        message: i18n.t('Relationship.blockUserSuccess', { defaultValue: 'User blocked.' }),
      });
      setBlockConfirmOpen(false);
      navigateBack();
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: toErrorMessage(error, i18n.t('Relationship.blockUserFailed', { defaultValue: 'Failed to block user' })),
      });
    } finally {
      setBlockMutationPending(false);
    }
  };

  const onRemoveProfile = async () => {
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
        queryClient.invalidateQueries({ queryKey: ['user-profile'], exact: false }),
      ]);
      setFeedback({
        kind: 'success',
        message: i18n.t('Relationship.removeFriendSuccess', { defaultValue: 'Friend removed.' }),
      });
      setRemoveConfirmOpen(false);
      navigateBack();
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: toErrorMessage(error, i18n.t('Relationship.removeFriendFailed', { defaultValue: 'Failed to remove friend' })),
      });
    } finally {
      setRemoveMutationPending(false);
    }
  };

  // Save feedback stays inline (the controller surfaces errors via saveError),
  // matching the Settings > Profile inline-feedback pattern — no toast here.
  const onSaveOwnProfile = async (draft: EditableProfileDraft) => {
    const nextDisplayName = draft.displayName.trim();
    if (!nextDisplayName) {
      throw new Error(i18n.t('Profile.displayNameRequired', { defaultValue: 'Display name is required' }));
    }

    const toArray = (value: string) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

    const updated = await realmSocialData.updateUserProfile({
      displayName: nextDisplayName,
      avatarUrl: draft.avatarUrl.trim() || null,
      bio: draft.bio.trim() || null,
      city: draft.city.trim() || null,
      countryCode: draft.countryCode.trim() || null,
      gender: draft.gender.trim() || null,
      languages: toArray(draft.languages),
      tags: toArray(draft.tags),
    });

    const updatedUser = parseOptionalJsonObject(updated) ?? {};
    const updatedAuthUser = {
      ...updated,
      ...updatedUser,
      avatarUrl: typeof updated.avatarUrl === 'string'
        ? updated.avatarUrl
        : draft.avatarUrl.trim() || null,
    };

    setAuthSession(updatedAuthUser);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['user-profile'] }),
      queryClient.invalidateQueries({ queryKey: ['contacts'] }),
    ]);
  };

  if (loading) {
    return (
      <div data-testid={E2E_IDS.panel('profile')} className="flex min-h-0 flex-1 px-5 pb-5 pt-4">
        <Surface
          tone="panel"
          material="glass-regular"
          padding="none"
          className="flex flex-1 items-center justify-center rounded-[2rem] border-[var(--nimi-border-subtle)] shadow-[0_18px_44px_rgba(15,23,42,0.06)]"
        >
          <ProfileDetailLoadingState label={i18n.t('ProfileView.loading')} />
        </Surface>
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid={E2E_IDS.panel('profile')} className="flex min-h-0 flex-1 px-5 pb-5 pt-4">
        <Surface
          tone="panel"
          material="glass-regular"
          padding="none"
          className="flex flex-1 items-center justify-center rounded-[2rem] border-[var(--nimi-border-subtle)] shadow-[0_18px_44px_rgba(15,23,42,0.06)]"
        >
          <ProfileDetailErrorState
            backLabel={i18n.t('Common.back')}
            label={i18n.t('ProfileView.error')}
            onClose={navigateBack}
          />
        </Surface>
      </div>
    );
  }

  if (!profile) {
    return (
      <div data-testid={E2E_IDS.panel('profile')} className="flex min-h-0 flex-1 px-5 pb-5 pt-4">
        <Surface
          tone="panel"
          material="glass-regular"
          padding="none"
          className="flex flex-1 items-center justify-center rounded-[2rem] border-[var(--nimi-border-subtle)] text-sm text-[var(--nimi-text-secondary)] shadow-[0_18px_44px_rgba(15,23,42,0.06)]"
        >
          {i18n.t('Profile.noProfileDataAvailable', { defaultValue: 'No profile data available' })}
        </Surface>
      </div>
    );
  }

  return (
    <div data-testid={E2E_IDS.panel('profile')} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ScrollArea
        className="min-h-0 flex-1"
        viewportClassName="bg-transparent px-5 pb-5 pt-4"
        contentClassName="flex min-h-full w-full flex-col"
        viewportRef={profileScrollContainerRef}
      >
        <Surface
          tone="panel"
          material="glass-regular"
          padding="none"
          className="min-h-full overflow-hidden rounded-[2rem] border-[var(--nimi-border-subtle)] shadow-[0_22px_52px_rgba(15,23,42,0.08)]"
        >
          <ProfileDetailView
            profile={profile}
            isOwnProfile={isOwnProfile}
            isBlockedProfile={isBlockedProfile}
            loading={loading}
            error={error}
            hideBackButton
            externalScrollContainerRef={profileScrollContainerRef}
            onClose={navigateBack}
            onMessage={() => {
              void onMessage();
            }}
            onAddFriend={!isOwnProfile && !isBlockedProfile && !profile.isFriend && !profile.isPendingFriendRequest ? () => {
              void onAddFriend();
            } : undefined}
            onBlock={!isOwnProfile && !isBlockedProfile ? () => setBlockConfirmOpen(true) : undefined}
            onRemove={!isOwnProfile && !isBlockedProfile && profile.isFriend ? () => setRemoveConfirmOpen(true) : undefined}
            showMessageButton={!isOwnProfile && !isBlockedProfile}
            onSaveProfile={isOwnProfile ? onSaveOwnProfile : undefined}
          />
        </Surface>
      </ScrollArea>
      {profile && removeConfirmOpen ? (
        <RemoveFriendConfirmDialog
          contact={profile}
          pending={removeMutationPending}
          onConfirm={() => {
            void onRemoveProfile();
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
            void onBlockProfile();
          }}
          onCancel={() => {
            if (!blockMutationPending) {
              setBlockConfirmOpen(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}
