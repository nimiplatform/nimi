import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { i18n } from '@renderer/i18n';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal';
import { QuickAddFriendModal } from '@renderer/features/explore/quick-add-friend-modal';
import { resolveAgentFriendLimit } from '@renderer/features/relationship/agent-friend-limit';
import { prefetchWorldDetailAndHistory } from '@renderer/features/world/world-detail-queries.js';
import { prefetchWorldDetailPanel } from '@renderer/features/world/world-detail-route-state';
import { queryClient } from '@renderer/infra/query-client/query-client';
import {
  addRealmAgentFriend,
  openRealmAgentLocalChat,
} from '@renderer/features/explore/realm-agent-friend-actions';
import { realmAgentSocialProjectionQueryKey } from '@renderer/features/explore/realm-agent-friend-state';
import {
  agentDisplayDetailQueryKey,
  fetchAgentDisplayDetail,
} from './agent-detail-queries.js';
import { AgentDetailView } from './agent-detail-view.js';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';

export function AgentDetailPanel() {
  const authStatus = useAppStore((state) => state.auth.status);
  const selectedProfileId = useAppStore((state) => state.selectedProfileId);
  const navigateBack = useAppStore((state) => state.navigateBack);
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setChatMode = useAppStore((state) => state.setChatMode);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const setAgentConversationSelection = useAppStore((state) => state.setAgentConversationSelection);
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const [addFriendModalOpen, setAddFriendModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);

  const agentIdentifier = String(selectedProfileId || '').trim();

  const profileQuery = useQuery({
    queryKey: agentDisplayDetailQueryKey(agentIdentifier),
    queryFn: async () => fetchAgentDisplayDetail(agentIdentifier),
    enabled: authStatus === 'authenticated' && !!agentIdentifier,
  });
  const agentLimitQuery = useQuery({
    queryKey: ['agent-friend-limit', authStatus],
    queryFn: async () => resolveAgentFriendLimit(),
    enabled: authStatus === 'authenticated',
  });

  const resolvedAgentId = useMemo(() => {
    const profileId = String(profileQuery.data?.agent.id || '').trim();
    if (profileId) {
      return profileId;
    }
    return '';
  }, [profileQuery.data]);

  const agent = useMemo(() => {
    if (!profileQuery.data) return null;
    return profileQuery.data.agent;
  }, [profileQuery.data]);

  const stats = useMemo(() => {
    if (!profileQuery.data) return null;
    return profileQuery.data.stats;
  }, [profileQuery.data]);

  const worldScore = useMemo(() => {
    if (!profileQuery.data) return 0;
    return profileQuery.data.worldScore;
  }, [profileQuery.data]);

  const handleAddFriendClick = () => {
    if (!resolvedAgentId) return;
    if (agentLimitQuery.data && !agentLimitQuery.data.canAdd) {
      setFeedback({
        kind: 'error',
        message: agentLimitQuery.data.reason || i18n.t('Relationship.agentFriendLimitReachedShort', { defaultValue: 'Agent friend limit reached' }),
      });
      return;
    }
    setAddFriendModalOpen(true);
  };

  // D-EXPL-007 Add Friend dual-effect: AgentFriend relation + idempotent
  // account-scoped LocalAgent projection ensured at Add Friend time.
  const handleAddFriendSubmit = async (agentId: string, message?: string) => {
    await addRealmAgentFriend(
      {
        realmAgentId: agentId,
        displayName: agent?.displayName ?? agentId,
        handle: agent?.handle ?? '',
        avatarUrl: agent?.avatarUrl ?? null,
        worldId: agent?.worldId ?? null,
        worldName: null,
        bio: agent?.bio ?? null,
      },
      message,
    );
    setFeedback(null);
    await Promise.all([
      agentLimitQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: realmAgentSocialProjectionQueryKey }),
      queryClient.invalidateQueries({ queryKey: agentDisplayDetailQueryKey(agentIdentifier) }),
    ]);
  };

  // `friend` → Open Agent Chat — opens the one-to-one LocalAgent Chat.
  const handleOpenChat = async () => {
    if (!agent) {
      return;
    }
    try {
      await openRealmAgentLocalChat(
        {
          realmAgentId: agent.id,
          displayName: agent.displayName,
          handle: agent.handle,
          avatarUrl: agent.avatarUrl,
          worldId: agent.worldId,
          worldName: null,
          bio: agent.bio,
        },
        { setActiveTab, setChatMode, setSelectedTargetForSource, setAgentConversationSelection },
      );
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error
          ? error.message
          : i18n.t('Relationship.openChatFailed', { defaultValue: 'Failed to open chat' }),
      });
    }
  };

  // `limit_reached` stays inline. Keep the
  // action fail-closed until an in-context management action is admitted.
  const handleManageFriends = () => {
    setFeedback({
      kind: 'warning',
      message: i18n.t('AgentDetail.agentFriendLimitManagementUnavailable', {
        defaultValue: 'Agent friend limit reached. Remove an agent friend from a profile before adding another.',
      }),
    });
  };

  if (!agentIdentifier) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        {i18n.t('AgentDetail.noAgentSelected', { defaultValue: 'No agent selected' })}
      </div>
    );
  }

  if (!agent && !profileQuery.isPending && !profileQuery.isError) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        {i18n.t('AgentDetail.noAgentDataAvailable', { defaultValue: 'No agent data available' })}
      </div>
    );
  }

  return (
    <>
      {feedback ? (
        <div className="px-6 pt-4">
          <InlineFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
        </div>
      ) : null}
      <AgentDetailView
        agent={agent!}
        stats={stats}
        worldScore={worldScore}
        loading={profileQuery.isPending}
        error={profileQuery.isError}
        onBack={navigateBack}
        onOpenWorld={() => {
          if (!agent?.worldId) {
            return;
          }
          prefetchWorldDetailPanel();
          prefetchWorldDetailAndHistory(agent.worldId);
          navigateToWorld(agent.worldId);
        }}
        onAddFriend={handleAddFriendClick}
        onOpenChat={() => { void handleOpenChat(); }}
        onManageFriends={handleManageFriends}
        onSendGift={() => setGiftModalOpen(true)}
      />
      <SendGiftModal
        open={giftModalOpen}
        receiverId={agent?.id || ''}
        receiverName={agent?.displayName || agent?.handle || 'Agent'}
        receiverHandle={agent?.handle}
        receiverIsAgent
        receiverAvatarUrl={agent?.avatarUrl}
        onClose={() => setGiftModalOpen(false)}
        onSent={() => {
          setFeedback(null);
        }}
      />
      <QuickAddFriendModal
        open={addFriendModalOpen}
        agent={agent ? {
          id: agent.id,
          name: agent.displayName,
          handle: agent.handle,
          avatarUrl: agent.avatarUrl,
          tags: [],
          worldId: agent.worldId,
          worldName: null,
          worldBannerUrl: agent.worldBannerUrl,
          isAgent: true,
          bio: agent.bio,
          category: agent.category,
        } : null}
        agentLimit={agentLimitQuery.data ?? null}
        onClose={() => setAddFriendModalOpen(false)}
        onAdd={handleAddFriendSubmit}
      />
    </>
  );
}
