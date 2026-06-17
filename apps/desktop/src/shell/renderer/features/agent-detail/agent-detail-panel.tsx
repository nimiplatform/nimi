import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { i18n } from '@renderer/i18n';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal';
import { prefetchWorldDetailAndHistory } from '@renderer/features/world/world-detail-queries.js';
import { prefetchWorldDetailPanel } from '@renderer/features/world/world-detail-route-state';
import { realmPersonaSourceHandoffMessage } from '@renderer/features/explore/realm-persona-source-admission';
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
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);

  const agentIdentifier = String(selectedProfileId || '').trim();

  const profileQuery = useQuery({
    queryKey: agentDisplayDetailQueryKey(agentIdentifier),
    queryFn: async () => fetchAgentDisplayDetail(agentIdentifier),
    enabled: authStatus === 'authenticated' && !!agentIdentifier,
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

  const handleManageFriends = () => {
    if (!resolvedAgentId) return;
    setFeedback({
      kind: 'warning',
      message: realmPersonaSourceHandoffMessage(),
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
        onManageFriends={handleManageFriends}
        onSendGift={() => setGiftModalOpen(true)}
      />
      <SendGiftModal
        open={giftModalOpen}
        receiverId={agent?.id || ''}
        receiverName={agent?.displayName || agent?.handle || 'Agent'}
        receiverHandle={agent?.handle}
        receiverIsSource
        receiverAvatarUrl={agent?.avatarUrl}
        onClose={() => setGiftModalOpen(false)}
        onSent={() => {
          setFeedback(null);
        }}
      />
    </>
  );
}
