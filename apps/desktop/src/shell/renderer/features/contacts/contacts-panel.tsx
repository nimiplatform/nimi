import { useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { openDefaultPrivateExecutionMod } from '@renderer/mod-ui/lifecycle/default-private-execution';
import type {
  ContactRecord,
  ContactRequestRecord,
  ContactSearchCandidate,
  TabFilter,
} from './contacts-model';
import {
  loadStoredContactsFilter,
  persistStoredContactsFilter,
  toContactSearchCandidate,
  toFriendContact,
  toPendingRequestContact,
} from './contacts-model';
import { ContactsView } from './contacts-view';
import { AddContactModal } from './add-contact-modal';
import { resolveAgentFriendLimit } from './agent-friend-limit';

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const next = error.message.trim();
    if (next) {
      return next;
    }
  }
  return fallback;
}

function extractAgentWorldId(profile: unknown): string {
  if (!profile || typeof profile !== 'object') {
    return '';
  }
  const payload = profile as Record<string, unknown>;
  const direct = String(payload.worldId || '').trim();
  if (direct) {
    return direct;
  }

  const agent = payload.agent && typeof payload.agent === 'object'
    ? (payload.agent as Record<string, unknown>)
    : null;
  const fromAgent = String(agent?.worldId || '').trim();
  if (fromAgent) {
    return fromAgent;
  }

  const agentProfile = payload.agentProfile && typeof payload.agentProfile === 'object'
    ? (payload.agentProfile as Record<string, unknown>)
    : null;
  return String(agentProfile?.worldId || '').trim();
}

export function ContactsPanel() {
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const currentUserId = String(useAppStore((state) => state.auth.user?.id || '')).trim() || null;
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState('');
  const [activeFilter, setActiveFilter] = useState<TabFilter>(() => loadStoredContactsFilter('humans'));
  const [addContactOpen, setAddContactOpen] = useState(false);

  const contactsQuery = useQuery({
    queryKey: ['contacts', authStatus],
    queryFn: async () => {
      const snapshot = await dataSync.loadSocialSnapshot();
      return snapshot as {
        friends?: Array<Record<string, unknown>>;
        agents?: Array<Record<string, unknown>>;
        pendingReceived?: Array<Record<string, unknown>>;
        pendingSent?: Array<Record<string, unknown>>;
        blocked?: Array<Record<string, unknown>>;
      };
    },
    enabled: authStatus === 'authenticated',
  });
  const refetchContacts = contactsQuery.refetch;

  const agentLimitQuery = useQuery({
    queryKey: ['agent-friend-limit', authStatus],
    queryFn: async () => resolveAgentFriendLimit(),
    enabled: authStatus === 'authenticated',
  });

  // 从 snapshot 获取拉黑列表（由后端 /me/blocks 提供）
  const blockedContacts: ContactRecord[] = useMemo(() => {
    const blocked = contactsQuery.data?.blocked || [];
    return blocked.map((item) => toFriendContact(item));
  }, [contactsQuery.data?.blocked]);

  const blockedIds = useMemo(() => new Set(blockedContacts.map((c) => c.id)), [blockedContacts]);

  const allFriends: ContactRecord[] = useMemo(() => {
    return (contactsQuery.data?.friends || [])
      .map((item) => toFriendContact(item))
      .filter((contact) => !blockedIds.has(contact.id));
  }, [contactsQuery.data?.friends, blockedIds]);

  const humans = useMemo(() => allFriends.filter((contact) => !contact.isAgent), [allFriends]);
  // Agents: 所有是我的好友的 Agent（我不是 Owner）
  const agents = useMemo(() => allFriends.filter((contact) => contact.isAgent && contact.agentOwnershipType !== 'MASTER_OWNED'), [allFriends]);
  // My Agents: 我是 Owner 的 Agent（来自好友列表）
  const myAgents = useMemo(() => allFriends.filter((contact) => contact.isAgent && contact.agentOwnershipType === 'MASTER_OWNED'), [allFriends]);

  const navigateToProfile = useAppStore((state) => state.navigateToProfile);
  const pendingReceived = useMemo(
    () => (contactsQuery.data?.pendingReceived || []).map((item) => toPendingRequestContact(item)),
    [contactsQuery.data?.pendingReceived],
  );
  const pendingSent = useMemo(
    () => (contactsQuery.data?.pendingSent || []).map((item) => toPendingRequestContact(item)),
    [contactsQuery.data?.pendingSent],
  );
  const pendingRequests = useMemo(
    () => [...pendingReceived, ...pendingSent],
    [pendingReceived, pendingSent],
  );

  const activeList = useMemo(() => {
    switch (activeFilter) {
      case 'humans':
        return humans;
      case 'agents':
        return agents;
      case 'myAgents':
        return myAgents;
      case 'blocks':
        return blockedContacts;
      default:
        return humans;
    }
  }, [activeFilter, humans, agents, myAgents, blockedContacts]);

  const filteredContacts = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return activeList;
    // 搜索所有非 blocked 的联系人（不限制于当前分类）
    const allContacts = [...humans, ...agents, ...myAgents];
    return allContacts.filter(
      (contact) =>
        contact.displayName.toLowerCase().includes(query) ||
        contact.handle.toLowerCase().includes(query) ||
        (contact.bio && contact.bio.toLowerCase().includes(query)),
    );
  }, [activeList, searchText, humans, agents, myAgents]);

  const filteredRequests = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return pendingRequests;
    }
    return pendingRequests.filter((request) => (
      request.displayName.toLowerCase().includes(query)
      || request.handle.toLowerCase().includes(query)
      || (request.bio && request.bio.toLowerCase().includes(query))
    ));
  }, [pendingRequests, searchText]);

  const onViewProfile = useCallback(
    (contact: ContactRecord) => {
      const targetTab = activeFilter === 'agents' || contact.isAgent ? 'agent-detail' : 'profile';
      navigateToProfile(contact.id, targetTab);
    },
    [activeFilter, navigateToProfile],
  );

  const onFilterChange = useCallback((filter: TabFilter) => {
    setActiveFilter(filter);
    persistStoredContactsFilter(filter);
  }, []);

  const onSearchAddContact = useCallback(async (identifier: string): Promise<ContactSearchCandidate> => {
    const result = await dataSync.searchUser(identifier);
    const candidate = toContactSearchCandidate(result);
    if (!candidate) {
      throw new Error(t('Contacts.invalidSearchResult', { defaultValue: 'User search returned invalid data' }));
    }
    return candidate;
  }, [t]);

  const onAddContact = useCallback(async (candidate: ContactSearchCandidate, _message?: string) => {
    try {
      if (candidate.isAgent && (!agentLimitQuery.data || !agentLimitQuery.data.canAdd)) {
        throw new Error(agentLimitQuery.data.reason || t('Contacts.agentFriendLimitReachedShort', { defaultValue: 'Agent friend limit reached' }));
      }
      await dataSync.requestOrAcceptFriend(candidate.id);
      await Promise.all([refetchContacts(), agentLimitQuery.refetch()]);
      setStatusBanner({
        kind: 'success',
        message: t('Contacts.friendRequestSentOrAccepted', {
          name: candidate.displayName,
          defaultValue: 'Friend request sent or accepted for {{name}}.',
        }),
      });
    } catch (error) {
      const message = toErrorMessage(error, t('Contacts.addContactFailed', { defaultValue: 'Failed to add contact' }));
      setStatusBanner({
        kind: 'error',
        message,
      });
      throw error instanceof Error ? error : new Error(message);
    }
  }, [agentLimitQuery.data, agentLimitQuery.refetch, refetchContacts, setStatusBanner, t]);

  const onViewRequestProfile = useCallback((request: ContactRequestRecord) => {
    navigateToProfile(request.id, request.isAgent ? 'agent-detail' : 'profile');
  }, [navigateToProfile]);

  const onAcceptRequest = useCallback(async (request: ContactRequestRecord) => {
    try {
      if (request.isAgent && (!agentLimitQuery.data || !agentLimitQuery.data.canAdd)) {
        throw new Error(agentLimitQuery.data.reason || t('Contacts.agentFriendLimitReachedShort', { defaultValue: 'Agent friend limit reached' }));
      }
      await dataSync.requestOrAcceptFriend(request.userId);
      await Promise.all([refetchContacts(), agentLimitQuery.refetch()]);
      setStatusBanner({
        kind: 'success',
        message: t('Contacts.requestAccepted', {
          name: request.displayName,
          defaultValue: 'Accepted request from {{name}}.',
        }),
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: toErrorMessage(error, t('Contacts.acceptRequestFailed', { defaultValue: 'Failed to accept friend request' })),
      });
    }
  }, [agentLimitQuery.data, agentLimitQuery.refetch, refetchContacts, setStatusBanner, t]);

  const onRejectRequest = useCallback(async (request: ContactRequestRecord) => {
    try {
      await dataSync.rejectOrRemoveFriend(request.userId);
      await refetchContacts();
      setStatusBanner({
        kind: 'success',
        message: t('Contacts.requestRejected', {
          name: request.displayName,
          defaultValue: 'Rejected request from {{name}}.',
        }),
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: toErrorMessage(error, t('Contacts.rejectRequestFailed', { defaultValue: 'Failed to reject friend request' })),
      });
    }
  }, [refetchContacts, setStatusBanner, t]);

  const onCancelRequest = useCallback(async (request: ContactRequestRecord) => {
    try {
      await dataSync.rejectOrRemoveFriend(request.userId);
      await refetchContacts();
      setStatusBanner({
        kind: 'success',
        message: t('Contacts.requestCancelled', {
          name: request.displayName,
          defaultValue: 'Cancelled request to {{name}}.',
        }),
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: toErrorMessage(error, t('Contacts.cancelRequestFailed', { defaultValue: 'Failed to cancel friend request' })),
      });
    }
  }, [refetchContacts, setStatusBanner, t]);

  const onRemoveFriend = useCallback(async (contact: ContactRecord) => {
    try {
      await dataSync.rejectOrRemoveFriend(contact.id);
      await Promise.all([refetchContacts(), agentLimitQuery.refetch()]);
      setStatusBanner({
        kind: 'success',
        message: t('Contacts.friendRemoved', {
          name: contact.displayName,
          defaultValue: 'Removed {{name}} from your friends.',
        }),
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: toErrorMessage(error, t('Contacts.removeFriendFailed', { defaultValue: 'Failed to remove friend' })),
      });
    }
  }, [refetchContacts, agentLimitQuery.refetch, setStatusBanner, t]);

  const onBlockFriend = useCallback(async (contact: ContactRecord) => {
    try {
      await dataSync.blockUser({
        id: contact.id,
        displayName: contact.displayName,
        handle: contact.handle,
        avatarUrl: contact.avatarUrl,
        bio: contact.bio,
        isAgent: contact.isAgent,
        friendsSince: contact.friendsSince,
        age: contact.age,
        gender: contact.gender,
        location: contact.location,
        tags: contact.tags,
      });
      await Promise.all([refetchContacts(), agentLimitQuery.refetch()]);
      setStatusBanner({
        kind: 'success',
        message: t('Contacts.userBlocked', {
          name: contact.displayName,
          defaultValue: 'Blocked {{name}}.',
        }),
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: toErrorMessage(error, t('Contacts.blockUserFailed', { defaultValue: 'Failed to block user' })),
      });
    }
  }, [refetchContacts, agentLimitQuery.refetch, setStatusBanner, t]);

  const onUnblockUser = useCallback(async (contact: ContactRecord) => {
    try {
      await dataSync.unblockUser({
        id: contact.id,
        displayName: contact.displayName,
        handle: contact.handle,
        avatarUrl: contact.avatarUrl,
        bio: contact.bio,
        isAgent: contact.isAgent,
        friendsSince: contact.friendsSince,
        age: contact.age,
        gender: contact.gender,
        location: contact.location,
        tags: contact.tags,
      });
      await refetchContacts();
      setStatusBanner({
        kind: 'success',
        message: t('Contacts.userUnblocked', {
          name: contact.displayName,
          defaultValue: 'Unblocked {{name}}.',
        }),
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: toErrorMessage(error, t('Contacts.unblockUserFailed', { defaultValue: 'Failed to unblock user' })),
      });
    }
  }, [refetchContacts, setStatusBanner, t]);

  const onMessage = useCallback(async (contact: ContactRecord) => {
    if (contact.isAgent) {
      let worldId = '';
      try {
        const profile = await dataSync.loadUserProfile(contact.id);
        worldId = extractAgentWorldId(profile);
      } catch {
        // keep fallback empty worldId
      }

      setRuntimeFields({
        targetType: 'AGENT',
        targetAccountId: contact.id,
        agentId: contact.id,
        targetId: contact.id,
        worldId,
      });
      // Open mod workspace tab before setting active tab
      openDefaultPrivateExecutionMod();
      return;
    }

    try {
      const result = await dataSync.startChat(contact.id);
      if (result?.chatId) {
        setSelectedChatId(String(result.chatId));
      }
      const chatsSnapshot = await dataSync.loadChats();
      queryClient.setQueriesData({ queryKey: ['chats'] }, () => chatsSnapshot);
      setRuntimeFields({
        targetType: 'FRIEND',
        targetAccountId: contact.id,
        agentId: '',
        worldId: '',
      });
      setActiveTab('chat');
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: toErrorMessage(error, t('Contacts.openChatFailed', { defaultValue: 'Failed to open chat' })),
      });
    }
  }, [queryClient, setActiveTab, setRuntimeFields, setSelectedChatId, setStatusBanner, t]);

  return (
    <>
      <ContactsView
        searchText={searchText}
        activeFilter={activeFilter}
        humansCount={humans.length}
        agentsCount={agents.length}
        myAgentsCount={myAgents.length}
        requestsCount={pendingRequests.length}
        blocksCount={blockedContacts.length}
        blockedContacts={blockedContacts}
        agentLimit={agentLimitQuery.data || null}
        allFriends={allFriends}
        filteredContacts={filteredContacts}
        filteredRequests={filteredRequests}
        loading={contactsQuery.isPending}
        error={contactsQuery.isError}
        onSearchTextChange={setSearchText}
        onFilterChange={onFilterChange}
        onMessage={(contact) => {
          void onMessage(contact);
        }}
        onViewProfile={onViewProfile}
        onViewRequestProfile={onViewRequestProfile}
        onAcceptRequest={(request) => {
          void onAcceptRequest(request);
        }}
        onRejectRequest={(request) => {
          void onRejectRequest(request);
        }}
        onCancelRequest={(request) => {
          void onCancelRequest(request);
        }}
        onRemoveFriend={(contact) => {
          void onRemoveFriend(contact);
        }}
        onBlockFriend={(contact) => {
          void onBlockFriend(contact);
        }}
        onUnblockUser={(contact) => {
          void onUnblockUser(contact);
        }}
        onOpenAddContact={() => {
          setAddContactOpen(true);
        }}
      />
      <AddContactModal
        open={addContactOpen}
        selfUserId={currentUserId}
        agentLimit={agentLimitQuery.data || null}
        onClose={() => {
          setAddContactOpen(false);
        }}
        onSearch={onSearchAddContact}
        onAdd={onAddContact}
      />
    </>
  );
}
