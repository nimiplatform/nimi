import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal';
import { resolveAgentFriendLimit } from '@renderer/features/contacts/agent-friend-limit';
import { prefetchWorldDetailAndEvents } from '@renderer/features/world/world-detail-queries.js';
import { toAgentDetailData } from './agent-detail-model';
import { AgentDetailView } from './agent-detail-view';

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) {
      return message;
    }
  }
  return fallback;
}

export function AgentDetailPanel() {
  const authStatus = useAppStore((state) => state.auth.status);
  const selectedProfileId = useAppStore((state) => state.selectedProfileId);
  const navigateBack = useAppStore((state) => state.navigateBack);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const openModWorkspaceTab = useAppStore((state) => state.openModWorkspaceTab);
  const [giftModalOpen, setGiftModalOpen] = useState(false);

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
    // Open mod workspace tab before setting active tab
    openModWorkspaceTab('mod:local-chat', 'Local Chat', 'local-chat');
    setActiveTab('mod:local-chat');
  };

  const onAddFriend = async () => {
    if (!resolvedAgentId) return;
    try {
      if (agentLimitQuery.data && !agentLimitQuery.data.canAdd) {
        throw new Error(agentLimitQuery.data.reason || 'Agent friend limit reached');
      }
      await dataSync.requestOrAcceptFriend(resolvedAgentId);
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

  if (!agentIdentifier) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        No agent selected
      </div>
    );
  }

  if (!agent && !profileQuery.isPending && !profileQuery.isError) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        No agent data available
      </div>
    );
  }

  return (
    <>
      <AgentDetailView
        agent={agent!}
        memoryStats={memoryStats}
        loading={profileQuery.isPending}
        error={profileQuery.isError}
        onBack={navigateBack}
        onChat={onChat}
        onOpenWorld={() => {
          if (!agent?.worldId) {
            return;
          }
          prefetchWorldDetailAndEvents(agent.worldId);
          navigateToWorld(agent.worldId);
        }}
        onAddFriend={() => { void onAddFriend(); }}
        canAddFriend={agentLimitQuery.data?.canAdd !== false}
        addFriendHint={agentLimitQuery.data
          ? (
            agentLimitQuery.data.reason
            || `Agent friend limit: ${agentLimitQuery.data.used}/${agentLimitQuery.data.limit}`
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
            message: 'Gift sent',
          });
        }}
      />
    </>
  );
}
