import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { realmSocialData } from '../social/data/realm-social-data';
import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { ScrollArea, Surface } from '@nimiplatform/kit/ui';
import {
  getCachedContacts,
  isPendingSentRequestInContacts,
  type SocialContactSnapshot,
} from '../social/data/social-snapshot';

import { useAppStore } from '../../app-shell/providers/app-store';
import { ProfileDetailView, type EditableProfileDraft } from '../relationship/profile-detail-view.js';
import {
  ProfileDetailErrorState,
  ProfileDetailLoadingState,
} from '../relationship/profile-detail-view-content-shell.js';
import { SendGiftModal } from '../economy/send-gift-modal';
import {
  characterSourceMaterializationFailureMessage,
  characterSourceMaterializationMessage,
  characterSourceRefKey,
  describeCharacterPrimaryAction,
  discoverCharacterSourceLocalAgents,
  resolveCharacterSourceState,
} from '../explore/character-source-materialization';
import { materializeSourceContactLaunchTarget } from '../relationship/source-contact-launch-target.js';
import { ensureRuntimeAgentExists } from '../chat/chat-agent-shell-host-actions-helpers';
import { launchAgentConversationFromDisplay } from '../chat/agent-conversation-launcher.js';
import { E2E_IDS } from '../../testability/e2e-ids';
import { toProfileData, type ProfileSource } from './profile-model.js';
import { toFriendContact, type ContactRecord } from '../relationship/relationship-model';
import { InlineFeedback, type InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import { parseOptionalJsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  loadChatList,
  startChatWithTarget,
} from '../chat/data/realm-human-chat-data';

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
  const i18n = useDesktopI18nResource().instance;
  const authStatus = useAppStore((state) => state.auth.status);
  const currentUser = useAppStore((state) => state.auth.user);
  const ownerUserId = String(currentUser?.id || '').trim();
  const setAuthSession = useAppStore((state) => state.setAuthSession);
  const selectedProfileId = useAppStore((state) => state.selectedProfileId);
  const navigateBack = useAppStore((state) => state.navigateBack);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setChatMode = useAppStore((state) => state.setChatMode);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const setAgentConversationSelection = useAppStore((state) => state.setAgentConversationSelection);
  const setAgentConversationTargetSnapshot = useAppStore((state) => state.setAgentConversationTargetSnapshot);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const queryClient = useQueryClient();
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);
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
      try {
        const result = await realmSocialData.loadUserProfile(selectedProfileId!);
        const data: ProfileSource = result;
        // API may not return isFriend - check local contacts
        if (data.isFriend !== true && (realmSocialData.isFriend(selectedProfileId!) || Boolean(getContactFromCache(selectedProfileId!)))) {
          return { ...data, isFriend: true };
        }
        // Check if a pending sent request exists in local cache
        if (data.isPendingFriendRequest !== true && isPendingSentRequestInContacts(getCachedContacts(), selectedProfileId!)) {
          return { ...data, isPendingFriendRequest: true };
        }
        return data;
      } catch (error) {
        // If API fails, try to get from contacts cache
        const contact = getContactFromCache(selectedProfileId!);
        if (contact) {
          // Convert contact to profile format
          return {
            id: contact.id,
            displayName: contact.displayName,
            handle: contact.handle,
            avatarUrl: contact.avatarUrl,
            bio: contact.bio,
            isSource: contact.isSource,
            createdAt: contact.friendsSince,
            isFriend: true,
            // Add other fields with defaults
            isCreator: false,
            isVerified: false,
            worldId: null,
            sourceWorldId: null,
            sourceConfig: null,
            tags: contact.tags || [],
            followerCount: 0,
            followingCount: 0,
            postCount: 0,
          } satisfies ProfileSource;
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
      return toProfileData(currentUser);
    }
    if (profileQuery.data) {
      return toProfileData(profileQuery.data);
    }
    return null;
  }, [isOwnProfile, currentUser, profileQuery.data]);
  const profileSourceRefKey = profile?.sourceRef ? characterSourceRefKey(profile.sourceRef) : 'missing-source-ref';
  const profileSourceLocalAgentsQuery = useQuery({
    queryKey: [
      'profile-source-local-agents',
      ownerUserId,
      profileSourceRefKey,
      profile?.runtimeSourceRef ?? '',
    ],
    queryFn: async () => (profile ? discoverCharacterSourceLocalAgents(profile, ownerUserId) : []),
    enabled: authStatus === 'authenticated' && Boolean(profile?.isSource) && Boolean(ownerUserId),
    staleTime: 10_000,
  });
  const sourceAction = useMemo(() => {
    if (!profile?.isSource) {
      return null;
    }
    return describeCharacterPrimaryAction(resolveCharacterSourceState(
      profile,
      profileSourceLocalAgentsQuery.data ?? [],
      {
        runtimeInventoryPending: Boolean(ownerUserId && profileSourceLocalAgentsQuery.isPending),
        runtimeInventoryUnavailable: !ownerUserId || profileSourceLocalAgentsQuery.isError,
      },
    ));
  }, [
    ownerUserId,
    profile,
    profileSourceLocalAgentsQuery.data,
    profileSourceLocalAgentsQuery.isError,
    profileSourceLocalAgentsQuery.isPending,
  ]);

  const loading = !isOwnProfile && profileQuery.isPending;
  const error = !isOwnProfile && profileQuery.isError;
  const isBlockedProfile = Boolean(!isOwnProfile && profile && realmSocialData.isBlockedUser(profile.id));
  const addFriendBlocked = Boolean(profile?.isSource && sourceAction?.disabled);
  const addFriendHint = profile?.isSource && sourceAction?.disabled
    ? sourceAction.hint ?? characterSourceMaterializationMessage()
    : null;
  const addFriendLabel = profile?.isSource
    ? sourceAction?.label || i18n.t('Explore.characterSourceMaterialize', { defaultValue: 'Become my partner' })
    : undefined;

  const onMessage = async () => {
    if (!profile) {
      return;
    }

    try {
      const result = await startChatWithTarget(profile.id);
      if (result?.chatId) {
        setSelectedChatId(String(result.chatId));
      }
      const chatsSnapshot = await loadChatList();
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
      if (profile.isSource) {
        if (addFriendBlocked) {
          throw new Error(addFriendHint || characterSourceMaterializationMessage());
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
          message: i18n.t('Explore.characterSourceMaterializedFeedback', {
            defaultValue: 'Your partner is ready. Opening chat.',
          }),
        });
        return;
      }
      if (!selectedProfileId) {
        return;
      }
      await realmSocialData.requestOrAcceptFriend(selectedProfileId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contacts'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['user-profile'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['contact-profile'], exact: false }),
      ]);
      setFeedback(null);
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: profile.isSource
          ? characterSourceMaterializationFailureMessage(error)
          : toErrorMessage(error, i18n.t('Relationship.addContactFailed', { defaultValue: 'Failed to add contact' })),
      });
    }
  };

  const onBlockProfile = async () => {
    if (!profile) {
      return;
    }
    try {
      await realmSocialData.blockUser({
        id: profile.id,
        displayName: profile.displayName,
        handle: profile.handle,
        avatarUrl: profile.avatarUrl,
        bio: profile.bio,
        isSource: profile.isSource,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contacts'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['user-profile'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['contact-profile'], exact: false }),
      ]);
      setFeedback(null);
      navigateBack();
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: toErrorMessage(error, i18n.t('Relationship.blockUserFailed', { defaultValue: 'Failed to block user' })),
      });
    }
  };

  const onRemoveProfile = async () => {
    if (!profile) {
      return;
    }
    try {
      await realmSocialData.removeFriend(profile.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contacts'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['chats'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['user-profile'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['contact-profile'], exact: false }),
      ]);
      setFeedback(null);
      navigateBack();
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: toErrorMessage(error, i18n.t('Relationship.removeFriendFailed', { defaultValue: 'Failed to remove friend' })),
      });
    }
  };

  const onSaveOwnProfile = async (draft: EditableProfileDraft) => {
    try {
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
        queryClient.invalidateQueries({ queryKey: ['contact-profile'] }),
        queryClient.invalidateQueries({ queryKey: ['contacts'] }),
      ]);
      setFeedback({
        kind: 'success',
        message: i18n.t('Profile.updateSuccess', { defaultValue: 'Profile updated' }),
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: toErrorMessage(error, i18n.t('Profile.updateError', { defaultValue: 'Failed to update profile' })),
      });
      throw error;
    }
  };

  if (loading) {
    return (
      <div data-testid={E2E_IDS.panel('profile')} className="flex min-h-0 flex-1 px-5 pb-5 pt-4">
        <Surface
          tone="panel"
          material="glass-regular"
          padding="none"
          className="flex flex-1 items-center justify-center rounded-[2rem] border-white/60 shadow-[0_18px_44px_rgba(15,23,42,0.06)]"
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
          className="flex flex-1 items-center justify-center rounded-[2rem] border-white/60 shadow-[0_18px_44px_rgba(15,23,42,0.06)]"
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
          className="flex flex-1 items-center justify-center rounded-[2rem] border-white/60 text-sm text-[var(--nimi-text-secondary)] shadow-[0_18px_44px_rgba(15,23,42,0.06)]"
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
        {feedback ? (
          <div className="px-6 pt-4">
            <InlineFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
          </div>
        ) : null}
        <Surface
          tone="panel"
          material="glass-regular"
          padding="none"
          className="min-h-full overflow-hidden rounded-[2rem] border-white/60 shadow-[0_22px_52px_rgba(15,23,42,0.08)]"
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
            addFriendLabel={addFriendLabel}
            canAddFriend={!addFriendBlocked}
            addFriendHint={addFriendHint}
            onSendGift={() => setGiftModalOpen(true)}
            onBlock={!isOwnProfile && !isBlockedProfile ? () => {
              void onBlockProfile();
            } : undefined}
            onRemove={!isOwnProfile && !isBlockedProfile && profile.isFriend ? () => {
              void onRemoveProfile();
            } : undefined}
            showMessageButton={!isOwnProfile && !profile.isSource && !isBlockedProfile}
            onSaveProfile={isOwnProfile ? onSaveOwnProfile : undefined}
          />
        </Surface>
      </ScrollArea>
      <SendGiftModal
        open={giftModalOpen && !isOwnProfile && !isBlockedProfile}
        receiverId={profile?.id || ''}
        receiverName={profile?.displayName || profile?.handle || 'User'}
        receiverHandle={profile?.handle}
        receiverIsSource={profile?.isSource === true}
        receiverAvatarUrl={profile?.avatarUrl}
        onClose={() => setGiftModalOpen(false)}
        onSent={() => {
          setFeedback(null);
        }}
      />
    </div>
  );
}
