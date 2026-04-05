import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { i18n } from '@renderer/i18n';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal';
import { QuickAddFriendModal } from '@renderer/features/explore/quick-add-friend-modal';
import { resolveAgentFriendLimit } from '@renderer/features/contacts/agent-friend-limit';
import { prefetchWorldDetailAndHistory } from '@renderer/features/world/world-detail-queries.js';
import { prefetchWorldDetailPanel } from '@renderer/features/world/world-detail-route-state';
import { parseOptionalJsonObject, type JsonObject } from '@renderer/bridge/runtime-bridge/shared';
import { toAgentDetailData } from './agent-detail-model.js';
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
    queryKey: ['agent-profile', agentIdentifier],
    queryFn: async () => {
      if (!agentIdentifier) {
        return null;
      }
      const result = await dataSync.loadAgentDetails(agentIdentifier);
      // API may not return isFriend — check local contacts
      const agentId = String(result.id || '').trim();
      if (result.isFriend !== true && agentId && dataSync.isFriend(agentId)) {
        return { ...result, isFriend: true };
      }
      return result;
    },
    enabled: authStatus === 'authenticated' && !!agentIdentifier,
  });
  const agentLimitQuery = useQuery({
    queryKey: ['agent-friend-limit', authStatus],
    queryFn: async () => resolveAgentFriendLimit(),
    enabled: authStatus === 'authenticated',
  });

  const resolvedAgentId = useMemo(() => {
    const profileId = String(profileQuery.data?.id || '').trim();
    if (profileId) {
      return profileId;
    }
    return '';
  }, [profileQuery.data]);

  const agent = useMemo(() => {
    if (!profileQuery.data) return null;
    return toAgentDetailData(profileQuery.data);
  }, [profileQuery.data]);

  // Extract stats from profile data (if available from API)
  const stats = useMemo(() => {
    if (!profileQuery.data) return null;
    const statsData = parseOptionalJsonObject(profileQuery.data.stats) as (JsonObject & {
      friendsCount?: number;
      postsCount?: number;
    }) | undefined;
    return {
      friendsCount: statsData?.friendsCount ?? 0,
      postsCount: statsData?.postsCount ?? 0,
      likesCount: 0, // Not available from current API, can be added later
    };
  }, [profileQuery.data]);

  // World score from agent data (if available)
  const worldScore = useMemo(() => {
    if (!profileQuery.data) return 0;
    const worldData = parseOptionalJsonObject(profileQuery.data.world) as (JsonObject & {
      scoreEwma?: number;
    }) | undefined;
    return worldData?.scoreEwma ?? (
      typeof profileQuery.data.worldScoreEwma === 'number' ? profileQuery.data.worldScoreEwma : 0
    );
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
