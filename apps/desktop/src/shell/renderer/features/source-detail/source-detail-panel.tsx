import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAppStore, useAppStoreApi } from '../../app-shell/providers/app-store';
import {
  characterSourceMaterializationFailureMessage,
  characterSourceMaterializationMessage,
  characterSourceRefKey,
  discoverCharacterSourceLocalAgents,
  resolveCharacterSourceState,
  type CharacterSourceDiscoveredLocalAgent,
} from '../explore/character-source-materialization';
import { ensureCharacterSourceMaterialized } from '../relationship/character-source-launch-target.js';
import {
  fetchLocalAgentList,
  localAgentListQueryKey,
  toLocalAgentSourceDiscoveryProjections,
} from '../agents/local-agent-list-model';
import { resolveAgentTargetSnapshotForSourceRef } from '../agents/agent-conversation-source-resolution.js';
import { launchAgentConversationFromDisplay } from '../chat/agent-conversation-launcher.js';
import { EMPTY_AGENT_CONVERSATION_SELECTION } from '../chat/chat-shell-types.js';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
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
  const appStore = useAppStoreApi();
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
  const setAgentConversationSelection = useAppStore((state) => state.setAgentConversationSelection);
  const setAgentConversationTargetSnapshot = useAppStore((state) => state.setAgentConversationTargetSnapshot);
  const setPendingAgentComposerPrefill = useAppStore((state) => state.setPendingAgentComposerPrefill);
  const setFeedback = emitFeedbackToast;
  // Only track an in-flight action. Availability belongs to current owner data.
  const [sourceMaterialization, setSourceMaterialization] = useState<{
    sourceKey: string;
    ownerUserId: string;
  } | null>(null);
  const currentAction = useRef<{ sourceKey: string; ownerUserId: string } | null>(null);
  const selectedSourceKey = selectedSourceRef ? characterSourceRefKey(selectedSourceRef) : '';
  currentAction.current = { sourceKey: selectedSourceKey, ownerUserId };
  useEffect(() => {
    currentAction.current = { sourceKey: selectedSourceKey, ownerUserId };
    return () => { currentAction.current = null; };
  }, [selectedSourceKey, ownerUserId]);

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

  const currentSourceKey = useMemo(
    () => (source?.sourceRef ? characterSourceRefKey(source.sourceRef) : null),
    [source],
  );

  const sourceForView = useMemo(() => {
    if (!source) {
      return null;
    }
    const resolvedState = resolveCharacterSourceState(
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
    );
    return {
      ...source,
      sourceState: resolvedState,
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

  const ensureCharacterSourceReady = async (isCurrent: () => boolean) => {
    if (!source) {
      throw new Error(characterSourceMaterializationMessage(i18n.t));
    }

    await ensureCharacterSourceMaterialized(source, ownerUserId, i18n.t, bindings.sdk, isCurrent);
    await queryClient.invalidateQueries({ queryKey: ['source-detail-local-agents'], exact: false });
    await queryClient.invalidateQueries({ queryKey: localAgentListQueryKey(ownerUserId), exact: true });
    await queryClient.invalidateQueries({ queryKey: ['desktop-local-app-agent-references'], exact: false });
  };

  const handlePrimaryAction = async () => {
    if (!currentSourceKey) {
      return;
    }
    if (sourceMaterialization?.sourceKey === currentSourceKey
      && sourceMaterialization.ownerUserId === ownerUserId) {
      return;
    }
    const auth = appStore.getState().auth;
    const isCurrent = () => auth.status === 'authenticated'
      && appStore.getState().auth === auth
      && currentAction.current?.sourceKey === currentSourceKey
      && currentAction.current?.ownerUserId === ownerUserId;
    if (!isCurrent()) return;
    setSourceMaterialization({ sourceKey: currentSourceKey, ownerUserId });
    try {
      await ensureCharacterSourceReady(isCurrent);
      if (!isCurrent()) return;
      setFeedback({
        kind: 'success',
        message: i18n.t('Explore.characterSourceMaterializedFeedback', {
          defaultValue: 'Local agent created on this device.',
        }),
      });
    } catch (error) {
      if (!isCurrent()) return;
      setFeedback({
        kind: 'error',
        message: characterSourceMaterializationFailureMessage(error, i18n.t),
      });
    } finally {
      setSourceMaterialization((pending) => pending?.sourceKey === currentSourceKey && pending.ownerUserId === ownerUserId ? null : pending);
    }
  };

  // @nimi-authority: rule.nimi.runtime.agent-participation.r197
  const handleStartChat = async (initialComposerText?: string) => {
    const auth = appStore.getState().auth;
    const isCurrent = () => auth.status === 'authenticated'
      && appStore.getState().auth === auth
      && currentAction.current?.sourceKey === currentSourceKey
      && currentAction.current?.ownerUserId === ownerUserId;
    if (!isCurrent()) return;
    try {
      const prefillText = String(initialComposerText || '').trim();
      const conversationTarget = source?.sourceRef
        ? await resolveAgentTargetSnapshotForSourceRef({
          sourceRef: source.sourceRef,
          ownerUserId,
          sdk: bindings.sdk,
          isCurrent,
        }).catch((error: unknown) => {
          logRendererEvent({
            level: 'warn',
            area: 'source-detail',
            message: 'action:source-agent-conversation-resolve:failed',
            details: { error: error instanceof Error ? error.message : String(error || '') },
          });
          return null;
        })
        : null;
      if (!isCurrent()) return;
      if (conversationTarget) {
        await launchAgentConversationFromDisplay({
          target: conversationTarget,
          initialComposerText: prefillText || null,
          setActiveTab,
          setChatMode,
          setSelectedTargetForSource,
          setAgentConversationSelection,
          setAgentConversationTargetSnapshot,
          setPendingAgentComposerPrefill,
        });
        return;
      }
      setPendingAgentComposerPrefill({ text: '' });
      setAgentConversationSelection(EMPTY_AGENT_CONVERSATION_SELECTION);
      setSelectedTargetForSource('agent', null);
      setChatMode('agent');
      setActiveTab('chat');
      setFeedback({
        kind: 'error',
        message: i18n.t('SourceDetail.partnerUnavailable', {
          defaultValue: 'This partner is no longer available. Choose a current partner from the chat list.',
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
        primaryActionJoining={sourceMaterialization?.sourceKey === currentSourceKey
          && sourceMaterialization.ownerUserId === ownerUserId}
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
