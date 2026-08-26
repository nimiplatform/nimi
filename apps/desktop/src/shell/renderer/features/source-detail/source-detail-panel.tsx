import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAppStore } from '../../app-shell/providers/app-store';
import {
  characterSourceMaterializationFailureMessage,
  characterSourceMaterializationMessage,
  characterSourceRefKey,
  discoverCharacterSourceLocalAgents,
  resolveCharacterSourceState,
  type CharacterSourceDiscoveredLocalAgent,
} from '../explore/character-source-materialization';
import {
  materializeCharacterSourceLaunchTarget,
  toCharacterSourceLaunchTarget,
} from '../relationship/character-source-launch-target.js';
import { ensureRuntimeAgentExists } from '../chat/chat-agent-shell-host-actions-helpers';
import {
  fetchLocalAgentList,
  localAgentListQueryKey,
  toLocalAgentSourceDiscoveryProjections,
} from '../agents/local-agent-list-model';
import {
  sourceDisplayDetailQueryKey,
  fetchSourceDisplayDetail,
} from './source-detail-queries.js';
import { SourceDetailView } from './source-detail-view.js';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import type { CharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';

export function SourceDetailPanel({
  sourceRef: sourceRefProp,
  onBack,
}: {
  // Embedded hosts (e.g. the Explore persona rail+detail layout) pass an
  // explicit sourceRef; the standalone panel falls back to the store-driven
  // selection. Pass onBack=null to hide the back control when embedded.
  sourceRef?: CharacterSourceRefV3 | null;
  onBack?: (() => void) | null;
} = {}) {
  const bindings = useDesktopRendererBindings();
  const i18n = useDesktopI18nResource().instance;
  const queryClient = useQueryClient();
  const authStatus = useAppStore((state) => state.auth.status);
  const ownerUserId = useAppStore((state) => String(state.auth.user?.id || '').trim());
  const storeSelectedSourceRef = useAppStore((state) => state.selectedSourceRef);
  const selectedSourceRef = sourceRefProp === undefined ? storeSelectedSourceRef : sourceRefProp;
  const navigateBack = useAppStore((state) => state.navigateBack);
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setChatMode = useAppStore((state) => state.setChatMode);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const setFeedback = emitFeedbackToast;

  const profileQuery = useQuery({
    queryKey: selectedSourceRef
      ? sourceDisplayDetailQueryKey(selectedSourceRef)
      : ['source-display-detail', 'missing-character-source-ref-v3'],
    queryFn: async () => selectedSourceRef
      ? fetchSourceDisplayDetail(selectedSourceRef, bindings.sdk)
      : null,
    enabled: authStatus === 'authenticated' && Boolean(selectedSourceRef),
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
        ? characterSourceRefKey(source.sourceRef)
        : source?.id ?? 'missing-source-ref',
      source?.runtimeSourceRef ?? '',
    ],
    queryFn: async () => (source
      ? discoverCharacterSourceLocalAgents(source, ownerUserId, bindings.sdk)
      : []),
    enabled: authStatus === 'authenticated' && Boolean(source) && Boolean(ownerUserId),
    staleTime: 10_000,
  });

  const localAgentListQuery = useQuery({
    queryKey: localAgentListQueryKey(ownerUserId),
    queryFn: async () => fetchLocalAgentList(ownerUserId, bindings.sdk),
    enabled: authStatus === 'authenticated' && Boolean(ownerUserId),
    staleTime: 15_000,
  });

  const sourceRuntimeLocalAgents = useMemo(() => {
    const byLocalAgentRef = new Map<string, CharacterSourceDiscoveredLocalAgent>();
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
      sourceState: resolveCharacterSourceState(
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

  const resolveCharacterSourceTarget = async () => {
    if (!source) {
      throw new Error(characterSourceMaterializationMessage(i18n.t));
    }

    const existingAgent = sourceRuntimeLocalAgents.length === 1 ? sourceRuntimeLocalAgents[0] : null;
    const target = existingAgent
      ? toCharacterSourceLaunchTarget({
        ...source,
        runtimeSourceRef: existingAgent.runtimeSourceRef,
        localAgentRef: existingAgent.localAgentRef,
      }, ownerUserId)
      : await materializeCharacterSourceLaunchTarget(source, ownerUserId, i18n.t, bindings.sdk);

    if (!existingAgent) {
      await ensureRuntimeAgentExists(target, bindings.sdk, ownerUserId);
    }
    await queryClient.invalidateQueries({ queryKey: ['source-detail-local-agents'], exact: false });
    await queryClient.invalidateQueries({ queryKey: localAgentListQueryKey(ownerUserId), exact: true });
    return target;
  };

  const handlePrimaryAction = async () => {
    try {
      await resolveCharacterSourceTarget();
      setFeedback({
        kind: 'success',
        message: i18n.t('Explore.characterSourceMaterializedFeedback', {
          defaultValue: 'Local agent created on this device.',
        }),
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: characterSourceMaterializationFailureMessage(error, i18n.t),
      });
    }
  };

  const handleStartChat = async (initialComposerText?: string) => {
    try {
      await resolveCharacterSourceTarget();
      void initialComposerText;
      setSelectedTargetForSource('agent', null);
      setChatMode('agent');
      setActiveTab('chat');
      setFeedback({
        kind: 'success',
        message: i18n.t('Explore.characterSourceMaterializedFeedback', {
          defaultValue: 'Your partner is ready. Select it from the chat list.',
        }),
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: characterSourceMaterializationFailureMessage(error, i18n.t),
      });
    }
  };

  if (!selectedSourceRef) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--nimi-text-muted)]">
        {i18n.t('SourceDetail.noSourceSelected', { defaultValue: 'No source selected' })}
      </div>
    );
  }

  if (!source && !profileQuery.isPending && !profileQuery.isError) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--nimi-text-muted)]">
        {i18n.t('SourceDetail.noSourceDataAvailable', { defaultValue: 'No source data available' })}
      </div>
    );
  }

  return (
    <>
      <SourceDetailView
        source={sourceForView!}
        stats={stats}
        loading={profileQuery.isPending}
        error={profileQuery.isError}
        onBack={onBack === null ? undefined : (onBack ?? navigateBack)}
        onOpenWorld={() => {
          if (!source?.worldId) {
            return;
          }
          navigateToWorld(source.worldId);
        }}
        onPrimaryAction={() => {
          void handlePrimaryAction();
        }}
        onStartChat={(initialComposerText) => {
          void handleStartChat(initialComposerText);
        }}
      />
    </>
  );
}
