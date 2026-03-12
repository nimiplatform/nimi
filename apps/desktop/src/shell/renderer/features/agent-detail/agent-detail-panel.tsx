import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { i18n } from '@renderer/i18n';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal';
import { QuickAddFriendModal } from '@renderer/features/explore/quick-add-friend-modal';
import { resolveAgentFriendLimit } from '@renderer/features/contacts/agent-friend-limit';
import { openDefaultPrivateExecutionMod } from '@renderer/mod-ui/lifecycle/default-private-execution';
import { prefetchWorldDetailAndEvents } from '@renderer/features/world/world-detail-queries.js';
import { prefetchWorldDetailPanel } from '@renderer/features/world/world-detail-route-state';
import { toAgentDetailData } from './agent-detail-model';
import { AgentDetailView } from './agent-detail-view';

export function AgentDetailPanel() {
  const authStatus = useAppStore((state) => state.auth.status);
  const selectedProfileId = useAppStore((state) => state.selectedProfileId);
  const navigateBack = useAppStore((state) => state.navigateBack);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const [addFriendModalOpen, setAddFriendModalOpen] = useState(false);

  const agentIdentifier = String(selectedProfileId || '').trim();

  const profileQuery = useQuery({
    queryKey: ['agent-profile', agentIdentifier],
    queryFn: async () => {
      if (!agentIdentifier) {
        return null;
      }
      const result = await dataSync.loadAgentDetails(agentIdentifier) as Record<string, unknown>;
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
    const profileId = String((profileQuery.data as Record<string, unknown> | null)?.id || '').trim();
    if (profileId) {
      return profileId;
    }
    return '';
  }, [profileQuery.data]);

  const memoryStatsQuery = useQuery({
    queryKey: ['agent-memory-stats', resolvedAgentId],
    queryFn: async () => {
      const result = await dataSync.loadAgentMemoryStats(resolvedAgentId);
      return result as Record<string, unknown>;
    },
    enabled: authStatus === 'authenticated' && !!resolvedAgentId,
  });

  const agent = useMemo(() => {
    if (!profileQuery.data) return null;
    return toAgentDetailData(profileQuery.data);
  }, [profileQuery.data]);

  const memoryStats = useMemo(() => {
    if (!memoryStatsQuery.data) return null;
    const data = memoryStatsQuery.data;
    return {
      coreCount: typeof data.coreCount === 'number' ? data.coreCount : 0,
      e2eCount: typeof data.e2eCount === 'number' ? data.e2eCount : 0,
      profileCount: typeof data.profileCount === 'number' ? data.profileCount : 0,
    };
  }, [memoryStatsQuery.data]);

  // Extract stats from profile data (if available from API)
  const stats = useMemo(() => {
    if (!profileQuery.data) return null;
    const data = profileQuery.data as Record<string, unknown>;
    const statsData = data.stats as Record<string, number> | undefined;
    return {
      friendsCount: statsData?.friendsCount ?? 0,
      postsCount: statsData?.postsCount ?? 0,
      likesCount: 0, // Not available from current API, can be added later
    };
  }, [profileQuery.data]);

  // World score from agent data (if available)
  const worldScore = useMemo(() => {
    if (!profileQuery.data) return 0;
    const data = profileQuery.data as Record<string, unknown>;
    // Try to get score from various possible sources
    const worldData = data.world as Record<string, unknown> | undefined;
    return (worldData?.scoreEwma as number) ?? (data.worldScoreEwma as number) ?? 0;
  }, [profileQuery.data]);

  const onChat = () => {
    if (!agent) {
      return;
    }
    setRuntimeFields({
      targetType: 'AGENT',
      targetAccountId: agent.id,
      agentId: agent.id,
      targetId: agent.id,
      worldId: agent.worldId || '',
    });
    openDefaultPrivateExecutionMod();
  };

  const handleAddFriendClick = () => {
    if (!resolvedAgentId) return;
    if (agentLimitQuery.data && !agentLimitQuery.data.canAdd) {
      setStatusBanner({
        kind: 'error',
        message: agentLimitQuery.data.reason || i18n.t('Contacts.agentFriendLimitReachedShort', { defaultValue: 'Agent friend limit reached' }),
      });
      return;
    }
    setAddFriendModalOpen(true);
  };

  const handleAddFriendSubmit = async (agentId: string, _message?: string) => {
    await dataSync.requestOrAcceptFriend(agentId);
    setStatusBanner({
      kind: 'success',
      message: i18n.t('Contacts.friendRequestSentOrAccepted', {
        name: agent?.displayName || agent?.handle || i18n.t('AgentDetail.agentBadge', { defaultValue: 'Agent' }),
        defaultValue: 'Friend request sent or accepted for {{name}}.',
      }),
    });
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
      <AgentDetailView
        agent={agent!}
        memoryStats={memoryStats}
        stats={stats}
        worldScore={worldScore}
        loading={profileQuery.isPending}
        error={profileQuery.isError}
        onBack={navigateBack}
        onChat={onChat}
        onOpenWorld={() => {
          if (!agent?.worldId) {
            return;
          }
          prefetchWorldDetailPanel();
          prefetchWorldDetailAndEvents(agent.worldId);
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
        receiverAvatarUrl={agent?.avatarUrl}
        onClose={() => setGiftModalOpen(false)}
        onSent={() => {
          setStatusBanner({
            kind: 'success',
            message: i18n.t('Contacts.giftSentTo', {
              name: agent?.displayName || agent?.handle || i18n.t('AgentDetail.agentBadge', { defaultValue: 'Agent' }),
              defaultValue: 'Gift sent to {{name}}',
            }),
          });
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
