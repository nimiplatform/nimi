import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal';
import { resolveAgentFriendLimit } from '@renderer/features/contacts/agent-friend-limit';
import { toProfileData } from './profile-model';
import { ProfileView } from './profile-view';
import type { ContactRecord } from '@renderer/features/contacts/contacts-model';

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
  const selectedProfileId = useAppStore((state) => state.selectedProfileId);
  const navigateBack = useAppStore((state) => state.navigateBack);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const openModWorkspaceTab = useAppStore((state) => state.openModWorkspaceTab);
  const queryClient = useQueryClient();
  const [giftModalOpen, setGiftModalOpen] = useState(false);

  const isOwnProfile = !selectedProfileId;

  // Try to get contact info from cache for fallback
  const getContactFromCache = (id: string): ContactRecord | null => {
    const contactsData = queryClient.getQueryData<{ friends?: ContactRecord[] }>(['contacts', 'authenticated']);
    if (contactsData?.friends) {
      return contactsData.friends.find((f) => f.id === id) || null;
    }
    return null;
  };

  const profileQuery = useQuery({
    queryKey: ['user-profile', selectedProfileId],
    queryFn: async () => {
      try {
        const result = await dataSync.loadUserProfile(selectedProfileId!);
        const data = result as Record<string, unknown>;
        // API may not return isFriend — check local contacts
        if (data.isFriend !== true && dataSync.isFriend(selectedProfileId!)) {
          return { ...data, isFriend: true };
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
          } as Record<string, unknown>;
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
  const addFriendHint = profile?.isAgent && agentLimitQuery.data
    ? (
      agentLimitQuery.data.reason
      || `Agent friend limit: ${agentLimitQuery.data.used}/${agentLimitQuery.data.limit}`
    )
    : null;

  const onMessage = async () => {
    if (!profile) {
      return;
    }

    if (profile.isAgent) {
      setRuntimeFields({
        targetType: 'AGENT',
        targetAccountId: '',
        agentId: profile.id,
        worldId: profile.agentWorldId || '',
      });
      // Open mod workspace tab before setting active tab
      openModWorkspaceTab('mod:local-chat', 'Local Chat', 'local-chat');
      setActiveTab('mod:local-chat');
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
      setStatusBanner({
        kind: 'error',
        message: toErrorMessage(error, 'Failed to open chat'),
      });
    }
  };

  const onAddFriend = async () => {
    if (!selectedProfileId) return;
    try {
      if (profile?.isAgent && addFriendBlocked) {
        throw new Error(addFriendHint || 'Agent friend limit reached');
      }
      await dataSync.requestOrAcceptFriend(selectedProfileId);
      setStatusBanner({
        kind: 'success',
        message: 'Friend request sent or accepted',
      });
      void agentLimitQuery.refetch();
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: toErrorMessage(error, 'Failed to add friend'),
      });
    }
  };

  if (!profile && !loading && !error) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        No profile data available
      </div>
    );
  }

  return (
    <>
      <ProfileView
        profile={profile!}
        isOwnProfile={isOwnProfile}
        loading={loading}
        error={error}
        onBack={navigateBack}
        onMessage={() => {
          void onMessage();
        }}
        onAddFriend={() => { void onAddFriend(); }}
        canAddFriend={!addFriendBlocked}
        addFriendHint={addFriendHint}
        onSendGift={() => setGiftModalOpen(true)}
      />
      <SendGiftModal
        open={giftModalOpen && !isOwnProfile}
        receiverId={profile?.id || ''}
        receiverName={profile?.displayName || profile?.handle || 'User'}
        receiverHandle={profile?.handle}
        receiverAvatarUrl={profile?.avatarUrl}
        onClose={() => setGiftModalOpen(false)}
        onSent={() => {
          setStatusBanner({
            kind: 'success',
            message: 'Gift sent',
          });
        }}
      />
    </>
  );
}
