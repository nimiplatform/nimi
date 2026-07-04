import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { i18n } from '@renderer/i18n';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal';
import {
  discoverRealmSourceLocalAgents,
  realmPersonaSourceMaterializationFailureMessage,
  realmPersonaSourceMaterializationMessage,
  resolveRealmPersonaSourceState,
  type RealmSourceDiscoveredLocalAgent,
} from '@renderer/features/explore/realm-persona-source-materialization';
import {
  materializeSourceContactLaunchTarget,
  toSourceContactLaunchTarget,
} from '@renderer/features/relationship/source-contact-launch-target.js';
import { ensureRuntimeAgentExists } from '@renderer/features/chat/chat-agent-shell-host-actions-helpers';
import { launchAgentConversationFromDisplay } from '@renderer/features/chat/agent-conversation-launcher.js';
import {
  fetchLocalAgentList,
  localAgentListQueryKey,
  toLocalAgentSourceDiscoveryProjections,
} from '@renderer/features/agents/local-agent-list-model';
import {
  sourceDisplayDetailQueryKey,
  fetchSourceDisplayDetail,
} from './source-detail-queries.js';
import { SourceDetailView } from './source-detail-view.js';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';

export function SourceDetailPanel() {
  const queryClient = useQueryClient();
  const authStatus = useAppStore((state) => state.auth.status);
  const ownerUserId = useAppStore((state) => String(state.auth.user?.id || '').trim());
  const selectedProfileId = useAppStore((state) => state.selectedProfileId);
  const selectedSourceRef = useAppStore((state) => state.selectedSourceRef);
  const navigateBack = useAppStore((state) => state.navigateBack);
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setChatMode = useAppStore((state) => state.setChatMode);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const setAgentConversationSelection = useAppStore((state) => state.setAgentConversationSelection);
  const setAgentConversationTargetSnapshot = useAppStore((state) => state.setAgentConversationTargetSnapshot);
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);

  const sourceIdentifier = String(selectedProfileId || '').trim();
  const sourceSelection = selectedSourceRef ?? sourceIdentifier;

  const profileQuery = useQuery({
    queryKey: sourceDisplayDetailQueryKey(sourceSelection),
    queryFn: async () => fetchSourceDisplayDetail(selectedSourceRef ?? sourceIdentifier),
    enabled: authStatus === 'authenticated' && Boolean(selectedSourceRef || sourceIdentifier),
  });
  const source = useMemo(() => {
    if (!profileQuery.data) return null;
    return profileQuery.data.source;
  }, [profileQuery.data]);

  const sourceLocalAgentsQuery = useQuery({
    queryKey: [
      'source-detail-local-agents',
      ownerUserId,
      source?.sourceRef
        ? `${source.sourceRef.kind}:${source.sourceRef.worldId}:${source.sourceRef.sourceId}:${source.sourceRef.sourceContentHash}`
        : source?.id ?? 'missing-source-ref',
      source?.runtimeSourceRef ?? '',
    ],
    queryFn: async () => (source ? discoverRealmSourceLocalAgents(source, ownerUserId) : []),
    enabled: authStatus === 'authenticated' && Boolean(source) && Boolean(ownerUserId),
    staleTime: 10_000,
  });

  const localAgentListQuery = useQuery({
    queryKey: localAgentListQueryKey(ownerUserId),
    queryFn: async () => fetchLocalAgentList(ownerUserId),
    enabled: authStatus === 'authenticated' && Boolean(ownerUserId),
    staleTime: 15_000,
  });

  const sourceRuntimeLocalAgents = useMemo(() => {
    const byLocalAgentRef = new Map<string, RealmSourceDiscoveredLocalAgent>();
    for (const agent of sourceLocalAgentsQuery.data ?? []) {
      if (agent.localAgentRef) {
        byLocalAgentRef.set(agent.localAgentRef, agent);
      }
    }
    for (const agent of toLocalAgentSourceDiscoveryProjections(
      localAgentListQuery.data ?? [],
      source?.sourceRef,
    )) {
      byLocalAgentRef.set(agent.localAgentRef, agent);
    }
    return [...byLocalAgentRef.values()];
  }, [localAgentListQuery.data, source?.sourceRef, sourceLocalAgentsQuery.data]);

  const sourceForView = useMemo(() => {
    if (!source) {
      return null;
    }
    return {
      ...source,
      sourceState: resolveRealmPersonaSourceState(
        source,
        sourceRuntimeLocalAgents,
        {
          runtimeInventoryPending: Boolean(
            ownerUserId
            && sourceLocalAgentsQuery.isPending
            && localAgentListQuery.isPending
          ),
          runtimeInventoryUnavailable: !ownerUserId || (sourceLocalAgentsQuery.isError && localAgentListQuery.isError),
        },
      ),
    };
  }, [
    localAgentListQuery.isError,
    localAgentListQuery.isPending,
    ownerUserId,
    source,
    sourceLocalAgentsQuery.isError,
    sourceLocalAgentsQuery.isPending,
    sourceRuntimeLocalAgents,
  ]);

  const stats = useMemo(() => {
    if (!profileQuery.data) return null;
    return profileQuery.data.stats;
  }, [profileQuery.data]);

  const worldScore = useMemo(() => {
    if (!profileQuery.data) return 0;
    return profileQuery.data.worldScore;
  }, [profileQuery.data]);

  const handleMaterializeSource = async () => {
    if (!source) {
      setFeedback({
        kind: 'error',
        message: realmPersonaSourceMaterializationMessage(),
      });
      return;
    }
    try {
      const existingAgent = sourceRuntimeLocalAgents.length === 1 ? sourceRuntimeLocalAgents[0] : null;
      const target = existingAgent
        ? toSourceContactLaunchTarget({
          ...source,
          runtimeSourceRef: existingAgent.runtimeSourceRef,
          localAgentRef: existingAgent.localAgentRef,
        }, ownerUserId)
        : await materializeSourceContactLaunchTarget(source, ownerUserId);
      if (!existingAgent) {
        await ensureRuntimeAgentExists(target);
      }
      await queryClient.invalidateQueries({ queryKey: ['source-detail-local-agents'], exact: false });
      await queryClient.invalidateQueries({ queryKey: localAgentListQueryKey(ownerUserId), exact: true });
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
        message: i18n.t('SourceDetail.worldCharacter.partnerReadyFeedback', {
          defaultValue: 'Your partner is ready. Opening chat.',
        }),
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: realmPersonaSourceMaterializationFailureMessage(error),
      });
    }
  };

  if (!selectedSourceRef && !sourceIdentifier) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        {i18n.t('SourceDetail.noSourceSelected', { defaultValue: 'No source selected' })}
      </div>
    );
  }

  if (!source && !profileQuery.isPending && !profileQuery.isError) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        {i18n.t('SourceDetail.noSourceDataAvailable', { defaultValue: 'No source data available' })}
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
      <SourceDetailView
        source={sourceForView!}
        stats={stats}
        worldScore={worldScore}
        loading={profileQuery.isPending}
        error={profileQuery.isError}
        onBack={navigateBack}
        onOpenWorld={() => {
          if (!source?.worldId) {
            return;
          }
          navigateToWorld(source.worldId);
        }}
        onPrimaryAction={() => {
          void handleMaterializeSource();
        }}
        onSendGift={() => setGiftModalOpen(true)}
      />
      <SendGiftModal
        open={giftModalOpen}
        receiverId={source?.id || ''}
        receiverName={source?.displayName || ''}
        receiverHandle={source?.handle}
        receiverIsSource
        receiverAvatarUrl={source?.avatarUrl}
        onClose={() => setGiftModalOpen(false)}
        onSent={() => {
          setFeedback(null);
        }}
      />
    </>
  );
}
