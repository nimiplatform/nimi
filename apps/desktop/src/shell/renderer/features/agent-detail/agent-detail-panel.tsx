import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { i18n } from '@renderer/i18n';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal';
import { QuickAddFriendModal } from '@renderer/features/explore/quick-add-friend-modal';
import { resolveAgentFriendLimit } from '@renderer/features/contacts/agent-friend-limit';
import { prefetchWorldDetailAndHistory } from '@renderer/features/world/world-detail-queries.js';
import { prefetchWorldDetailPanel } from '@renderer/features/world/world-detail-route-state';
import { dataSync } from '@runtime/data-sync';
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
        message: agentLimitQuery.data.reason || i18n.t('Contacts.agentFriendLimitReachedShort', { defaultValue: 'Agent friend limit reached' }),
      });
      return;
    }
    setAddFriendModalOpen(true);
  };

  const handleAddFriendSubmit = async (agentId: string, _message?: string) => {
    await dataSync.requestOrAcceptFriend(agentId);
    setFeedback(null);
    void agentLimitQuery.refetch();
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
        canAddFriend={agentLimitQuery.data?.canAdd !== false}
        addFriendHint={agentLimitQuery.data
          ? (
            agentLimitQuery.data.reason
            || i18n.t('Contacts.agentFriendLimitReached', {
              used: agentLimitQuery.data.used,
              limit: agentLimitQuery.data.limit,
              tier: agentLimitQuery.data.tier,
              defaultValue: 'Agent friend limit reached ({{used}}/{{limit}}, tier: {{tier}})',
            })
          )
          : null}
        onSendGift={() => setGiftModalOpen(true)}
        isFriend={agent?.isFriend === true}
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
