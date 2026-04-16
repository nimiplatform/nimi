import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import {
  dataSync,
  getCachedContacts,
  isPendingSentRequestInContacts,
  type SocialContactSnapshot,
} from '@runtime/data-sync';
import { i18n } from '@renderer/i18n';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { ContactDetailView, type EditableProfileDraft } from '@renderer/features/contacts/contact-detail-view.js';
import {
  ContactDetailErrorState,
  ContactDetailLoadingState,
} from '@renderer/features/contacts/contact-detail-view-content-shell.js';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal';
import { resolveAgentFriendLimit } from '@renderer/features/contacts/agent-friend-limit';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { toProfileData, type ProfileSource } from './profile-model.js';
import { toFriendContact, type ContactRecord } from '@renderer/features/contacts/contacts-model';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';

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
  const authStatus = useAppStore((state) => state.auth.status);
  const currentUser = useAppStore((state) => state.auth.user);
  const authToken = useAppStore((state) => state.auth.token);
  const refreshToken = useAppStore((state) => state.auth.refreshToken);
  const setAuthSession = useAppStore((state) => state.setAuthSession);
  const selectedProfileId = useAppStore((state) => state.selectedProfileId);
  const navigateBack = useAppStore((state) => state.navigateBack);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const queryClient = useQueryClient();
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);

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
        const result = await dataSync.loadUserProfile(selectedProfileId!);
        const data: ProfileSource = result;
        // API may not return isFriend — check local contacts
        if (data.isFriend !== true && (dataSync.isFriend(selectedProfileId!) || Boolean(getContactFromCache(selectedProfileId!)))) {
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
            isAgent: contact.isAgent,
            createdAt: contact.friendsSince,
            isFriend: true,
            // Add other fields with defaults
            isCreator: false,
            isVerified: false,
            worldId: null,
            agentWorldId: null,
            agentConfig: null,
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
  const agentLimitQuery = useQuery({
    queryKey: ['agent-friend-limit', authStatus],
    queryFn: async () => resolveAgentFriendLimit(),
    enabled: authStatus === 'authenticated',
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

  const loading = !isOwnProfile && profileQuery.isPending;
  const error = !isOwnProfile && profileQuery.isError;
  const addFriendBlocked = Boolean(
    profile?.isAgent && agentLimitQuery.data && !agentLimitQuery.data.canAdd,
  );
  const isBlockedProfile = Boolean(!isOwnProfile && profile && dataSync.isBlockedUser(profile.id));
  const addFriendHint = profile?.isAgent && agentLimitQuery.data
    ? (
      agentLimitQuery.data.reason
      || i18n.t('Contacts.agentFriendLimitReached', {
        used: agentLimitQuery.data.used,
        limit: agentLimitQuery.data.limit,
        tier: agentLimitQuery.data.tier,
        defaultValue: 'Agent friend limit reached ({{used}}/{{limit}}, tier: {{tier}})',
      })
    )
    : null;

  const onMessage = async () => {
    if (!profile) {
      return;
    }

    try {
      const result = await dataSync.startChat(profile.id);
      if (result?.chatId) {
        setSelectedChatId(String(result.chatId));
      }
      const chatsSnapshot = await dataSync.loadChats();
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
        message: toErrorMessage(error, i18n.t('Contacts.openChatFailed', { defaultValue: 'Failed to open chat' })),
      });
    }
  };

  const onAddFriend = async () => {
    if (!selectedProfileId) return;
    try {
      if (profile?.isAgent && addFriendBlocked) {
        throw new Error(addFriendHint || i18n.t('Contacts.agentFriendLimitReachedShort', { defaultValue: 'Agent friend limit reached' }));
      }
      await dataSync.requestOrAcceptFriend(selectedProfileId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contacts'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['user-profile'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['contact-profile'], exact: false }),
      ]);
      setFeedback(null);
      void agentLimitQuery.refetch();
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: toErrorMessage(error, i18n.t('Contacts.addContactFailed', { defaultValue: 'Failed to add contact' })),
      });
    }
  };

  const onBlockProfile = async () => {
    if (!profile) {
      return;
    }
    try {
      await dataSync.blockUser({
        id: profile.id,
        displayName: profile.displayName,
        handle: profile.handle,
        avatarUrl: profile.avatarUrl,
        bio: profile.bio,
        isAgent: profile.isAgent,
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
        message: toErrorMessage(error, i18n.t('Contacts.blockUserFailed', { defaultValue: 'Failed to block user' })),
      });
    }
  };

  const onRemoveProfile = async () => {
    if (!profile) {
      return;
    }
    try {
      await dataSync.removeFriend(profile.id);
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
        message: toErrorMessage(error, i18n.t('Contacts.removeFriendFailed', { defaultValue: 'Failed to remove friend' })),
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

      const updated = await dataSync.updateUserProfile({
        displayName: nextDisplayName,
        avatarUrl: draft.avatarUrl.trim() || null,
        bio: draft.bio.trim() || null,
        city: draft.city.trim() || null,
        countryCode: draft.countryCode.trim() || null,
        gender: draft.gender.trim() || null,
        languages: toArray(draft.languages),
        tags: toArray(draft.tags),
      });

      if (typeof updated.avatarUrl !== 'string') {
        updated.avatarUrl = draft.avatarUrl.trim() || null;
      }

      setAuthSession(updated, authToken, refreshToken);
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
          <ContactDetailLoadingState label={i18n.t('ProfileView.loading')} />
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
          <ContactDetailErrorState
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
    <div data-testid={E2E_IDS.panel('profile')} className="flex min-h-0 flex-1 flex-col px-5 pb-5 pt-4">
      {feedback ? (
        <div className="px-6 pt-4">
          <InlineFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
        </div>
      ) : null}
      <Surface
        tone="panel"
        material="glass-regular"
        padding="none"
        className="min-h-0 flex-1 overflow-hidden rounded-[2rem] border-white/60 shadow-[0_22px_52px_rgba(15,23,42,0.08)]"
      >
        <ContactDetailView
          profile={profile}
          isOwnProfile={isOwnProfile}
          isBlockedProfile={isBlockedProfile}
          loading={loading}
          error={error}
          onClose={navigateBack}
          onMessage={() => {
            void onMessage();
          }}
          onAddFriend={!isOwnProfile && !isBlockedProfile && !profile.isFriend && !profile.isPendingFriendRequest ? () => {
            void onAddFriend();
          } : undefined}
          canAddFriend={!addFriendBlocked}
          addFriendHint={addFriendHint}
          onSendGift={() => setGiftModalOpen(true)}
          onBlock={!isOwnProfile && !isBlockedProfile ? () => {
            void onBlockProfile();
          } : undefined}
          onRemove={!isOwnProfile && !isBlockedProfile && profile.isFriend ? () => {
            void onRemoveProfile();
          } : undefined}
          showMessageButton={!isOwnProfile && !profile.isAgent && !isBlockedProfile}
          onSaveProfile={isOwnProfile ? onSaveOwnProfile : undefined}
        />
      </Surface>
      <SendGiftModal
        open={giftModalOpen && !isOwnProfile && !isBlockedProfile}
        receiverId={profile?.id || ''}
        receiverName={profile?.displayName || profile?.handle || 'User'}
        receiverHandle={profile?.handle}
        receiverIsAgent={profile?.isAgent === true}
        receiverAvatarUrl={profile?.avatarUrl}
        onClose={() => setGiftModalOpen(false)}
        onSent={() => {
          setFeedback(null);
        }}
      />
    </div>
  );
}
