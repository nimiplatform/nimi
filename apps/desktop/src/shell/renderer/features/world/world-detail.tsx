import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../app-shell/providers/app-store';

import { ScrollArea } from '@nimiplatform/kit/ui';
import { createRendererFlowId, logRendererEvent } from '@nimiplatform/kit/telemetry';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast';
import {
  characterSourceMaterializationFailureMessage,
  characterSourceRefKey,
  discoverCharacterSourceLocalAgents,
  resolveCharacterSourceState,
} from '../explore/character-source-materialization';
import { ensureCharacterSourceMaterialized } from '../relationship/character-source-launch-target.js';
import { localAgentListQueryKey } from '../agents/local-agent-list-model';
import { resolveAgentTargetSnapshotForSourceRef } from '../agents/agent-conversation-source-resolution.js';
import { launchAgentConversationFromDisplay } from '../chat/agent-conversation-launcher.js';
import { EMPTY_AGENT_CONVERSATION_SELECTION } from '../chat/chat-shell-types.js';
import {
  NarrativeWorldDetailPage,
  OasisWorldDetailPage,
} from './world-detail-template';
import type { WorldCharacter } from './world-detail-types';
import type { WorldListItem } from './world-list-model';
import {
  fetchWorldPrimaryDisplayDetail,
  fetchWorldSupplementalDisplayDetail,
  toWorldPrimaryDisplayDetail,
  toWorldSupplementalDisplayDetail,
  type WorldDisplayDetail,
  toWorldDisplayFallback,
  worldDisplayDetailQueryKey,
  worldPrimaryDisplayDetailQueryKey,
  worldSupplementalDisplayDetailQueryKey,
} from './world-detail-queries';
import { useFollowedWorlds } from './world-follow-store-context.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { createRealmWorldData } from './data/realm-world-data.js';

type WorldDetailProps = {
  world: WorldListItem;
  // Embedded surfaces (e.g. the Explore worlds rail+detail layout) omit onBack;
  // the detail templates hide the hero back control when it is absent.
  onBack?: () => void;
  initialSubpage?: 'people-archive' | 'relationship-explorer' | null;
};

export function WorldDetail({ world, onBack, initialSubpage }: WorldDetailProps) {
  const bindings = useDesktopRendererBindings();
  const i18n = useDesktopI18nResource().instance;
  const queryClient = useQueryClient();
  const authStatus = useAppStore((state) => state.auth.status);
  const ownerUserId = useAppStore((state) => String(state.auth.user?.id || '').trim());
  const navigateToSourceDetail = useAppStore((state) => state.navigateToSourceDetail);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setChatMode = useAppStore((state) => state.setChatMode);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const setAgentConversationSelection = useAppStore((state) => state.setAgentConversationSelection);
  const setAgentConversationTargetSnapshot = useAppStore((state) => state.setAgentConversationTargetSnapshot);
  const setPendingAgentComposerPrefill = useAppStore((state) => state.setPendingAgentComposerPrefill);
  const detailViewportRef = useRef<HTMLDivElement | null>(null);
  const isReady = authStatus === 'authenticated' && !!world.id;
  const setFeedback = emitFeedbackToast;
  const flowIdRef = useRef('');
  const enteredAtRef = useRef(0);
  const primaryReadyLoggedRef = useRef(false);
  const historySemanticReadyLoggedRef = useRef(false);
  const extendedReadyLoggedRef = useRef(false);
  const cachedCompositeDisplay = isReady
    ? queryClient.getQueryData<WorldDisplayDetail>(worldDisplayDetailQueryKey(world.id))
    : undefined;

  const worldPrimaryQuery = useQuery({
    queryKey: worldPrimaryDisplayDetailQueryKey(world.id),
    queryFn: () => fetchWorldPrimaryDisplayDetail(
      world.id,
      createRealmWorldData(bindings.sdk),
    ),
    enabled: isReady,
    initialData: cachedCompositeDisplay ? () => toWorldPrimaryDisplayDetail(cachedCompositeDisplay) : undefined,
    staleTime: 30_000,
  });

  const primaryDisplay = worldPrimaryQuery.data;
  const worldSupplementalQuery = useQuery({
    queryKey: worldSupplementalDisplayDetailQueryKey(world.id),
    queryFn: () => fetchWorldSupplementalDisplayDetail(
      world.id,
      createRealmWorldData(bindings.sdk),
    ),
    enabled: isReady && Boolean(primaryDisplay),
    initialData: cachedCompositeDisplay ? () => toWorldSupplementalDisplayDetail(cachedCompositeDisplay) : undefined,
    staleTime: 30_000,
  });

  const supplementalDisplay = worldSupplementalQuery.data;
  const primaryLoading = worldPrimaryQuery.isPending && !primaryDisplay;
  const supplementalLoading = Boolean(primaryDisplay) && worldSupplementalQuery.isPending && !supplementalDisplay;
  const initialLoading = primaryLoading && !world.id;
  const initialError = !initialLoading
    && !primaryDisplay
    && worldPrimaryQuery.isError;
  const pageError = initialError;
  const worldData = primaryDisplay?.world ?? toWorldDisplayFallback(world);
  const characters: WorldCharacter[] = primaryDisplay?.characters ?? [];
  // Realm does not know about device-local Runtime LocalAgents, so the realm
  // payload's relation.state alone can never mark an already-added character as
  // connected. Join the owner-scope runtime inventory here (same seam as
  // Explore / SourceDetail) before rendering connect/chat actions.
  const characterDiscoveryKey = useMemo(
    () => characters.map((character) => characterSourceRefKey(character.sourceRef)).join('|'),
    [characters],
  );
  const worldCharactersLocalAgentsQuery = useQuery({
    queryKey: ['world-detail-local-agents', ownerUserId, world.id, characterDiscoveryKey],
    queryFn: async () => (await Promise.all(
      characters.map((character) => discoverCharacterSourceLocalAgents(character, ownerUserId, bindings.sdk)),
    )).flat(),
    enabled: isReady && Boolean(ownerUserId) && characters.length > 0,
    staleTime: 10_000,
  });
  const charactersWithRelation = useMemo(() => {
    const localAgents = worldCharactersLocalAgentsQuery.data;
    if (!localAgents) {
      return characters;
    }
    return characters.map((character) => {
      const sourceState = resolveCharacterSourceState(character, localAgents);
      const connected = sourceState === 'local_agent_available' || sourceState === 'local_agent_ambiguous';
      if (!connected || character.relation?.state === 'connected') {
        return character;
      }
      return {
        ...character,
        relation: { ...character.relation, state: 'connected' as const },
      };
    });
  }, [characters, worldCharactersLocalAgentsQuery.data]);
  const safeHistory = supplementalDisplay?.history ?? { items: [], summary: null };
  const safeSemantic = supplementalDisplay?.semantic ?? {
    operationTitle: null,
    operationDescription: null,
    operationRules: [],
    powerSystems: [],
    standaloneLevels: [],
    taboos: [],
    topology: null,
    causality: null,
    languages: [],
    worldviewEvents: [],
    worldviewSnapshots: [],
    hasContent: false,
  };
  const safeAudits = supplementalDisplay?.audits ?? [];
  const safePublicAssets = supplementalDisplay?.publicAssets ?? {
    resourceRefs: [],
    externalRefs: [],
    intents: [],
    scenes: [],
  };

  useEffect(() => {
    if (!isReady) {
      return;
    }
    flowIdRef.current = createRendererFlowId('world-detail');
    enteredAtRef.current = performance.now();
    primaryReadyLoggedRef.current = false;
    historySemanticReadyLoggedRef.current = false;
    extendedReadyLoggedRef.current = false;
    logRendererEvent({
      level: 'info',
      area: 'world-detail',
      message: 'detail:entered',
      flowId: flowIdRef.current,
      details: {
        worldId: world.id,
        stage: 'entered',
      },
    });
  }, [isReady, world.id]);

  useEffect(() => {
    if (!worldPrimaryQuery.isSuccess || !primaryDisplay || primaryReadyLoggedRef.current) {
      return;
    }
    primaryReadyLoggedRef.current = true;
    logRendererEvent({
      level: 'info',
      area: 'world-detail',
      message: 'detail:primary-ready',
      flowId: flowIdRef.current,
      costMs: Number((performance.now() - enteredAtRef.current).toFixed(2)),
      details: {
        worldId: world.id,
        stage: 'primary',
      },
    });
  }, [primaryDisplay, world.id, worldPrimaryQuery.isSuccess]);

  useEffect(() => {
    if (!supplementalDisplay || !worldSupplementalQuery.isSuccess || historySemanticReadyLoggedRef.current) {
      return;
    }
    historySemanticReadyLoggedRef.current = true;
    logRendererEvent({
      level: 'info',
      area: 'world-detail',
      message: 'detail:history-semantic-settled',
      flowId: flowIdRef.current,
      costMs: Number((performance.now() - enteredAtRef.current).toFixed(2)),
      details: {
        worldId: world.id,
        stage: 'secondary',
        historyStatus: supplementalDisplay.sections.history,
        semanticStatus: supplementalDisplay.sections.semantic,
      },
    });
  }, [supplementalDisplay, world.id, worldSupplementalQuery.isSuccess]);

  useEffect(() => {
    if (!supplementalDisplay || !worldSupplementalQuery.isSuccess || extendedReadyLoggedRef.current) {
      return;
    }
    extendedReadyLoggedRef.current = true;
    logRendererEvent({
      level: 'info',
      area: 'world-detail',
      message: 'detail:assets-audits-settled',
      flowId: flowIdRef.current,
      costMs: Number((performance.now() - enteredAtRef.current).toFixed(2)),
      details: {
        worldId: world.id,
        stage: 'non-critical',
        auditStatus: supplementalDisplay.sections.audits,
        publicAssetsStatus: supplementalDisplay.sections.publicAssets,
      },
    });
  }, [supplementalDisplay, world.id, worldSupplementalQuery.isSuccess]);

  // World characters are not chat-reachable until Runtime creates a localAgent
  // from a fresh Realm materialization packet on this device.
  const handleViewCharacter = (character: WorldCharacter) => {
    navigateToSourceDetail(character.sourceRef);
  };

  const followed = useFollowedWorlds();
  const worldFollowed = followed.isFollowed(world.id);
  const handleFollowWorld = () => {
    if (!followed.available) {
      setFeedback({ kind: 'error', message: i18n.t('World.atlas.followed.unavailable') });
      return;
    }
    try {
      followed.toggle(world.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : i18n.t('World.atlas.followed.error');
      setFeedback({ kind: 'error', message });
    }
  };

  const handleMaterializeSource = async (character: WorldCharacter) => {
    try {
      await ensureCharacterSourceMaterialized({
        ...character,
        displayName: character.name,
        sourceWorldId: character.sourceRef.worldId,
        sourceKind: character.sourceRef.kind,
        sourceId: character.sourceRef.id,
        sourceHash: character.sourceRef.sourceHash,
      }, ownerUserId, i18n.t, bindings.sdk);
      await queryClient.invalidateQueries({ queryKey: ['world-detail-local-agents'], exact: false });
      await queryClient.invalidateQueries({ queryKey: localAgentListQueryKey(ownerUserId), exact: true });
      setFeedback({
        kind: 'success',
        message: i18n.t('Explore.characterSourceMaterializedFeedback', {
          defaultValue: 'Local agent created on this device.',
        }),
      });
    } catch (error) {
      const message = characterSourceMaterializationFailureMessage(error, i18n.t);
      setFeedback({ kind: 'error', message });
    }
  };

  // Connected characters skip the materialize CTA and launch the canonical
  // agent Conversation directly; any target-resolution miss fails closed to
  // the agent chat list.
  const handleOpenCharacterConversation = async (character: WorldCharacter) => {
    const conversationTarget = await resolveAgentTargetSnapshotForSourceRef({
      sourceRef: character.sourceRef,
      ownerUserId,
      sdk: bindings.sdk,
    }).catch((error: unknown) => {
      logRendererEvent({
        level: 'warn',
        area: 'world-detail',
        message: 'action:character-conversation-resolve:failed',
        details: { error: error instanceof Error ? error.message : String(error || '') },
      });
      return null;
    });
    if (conversationTarget) {
      await launchAgentConversationFromDisplay({
        target: conversationTarget,
        setActiveTab,
        setChatMode,
        setSelectedTargetForSource,
        setAgentConversationSelection,
        setAgentConversationTargetSnapshot,
        setPendingAgentComposerPrefill,
      });
      return;
    }
    setAgentConversationSelection(EMPTY_AGENT_CONVERSATION_SELECTION);
    setSelectedTargetForSource('agent', null);
    setChatMode('agent');
    setActiveTab('chat');
  };

  return (
    <ScrollArea
      className="h-full bg-transparent"
      viewportClassName="bg-transparent"
      viewportRef={detailViewportRef}
    >
      {worldData.type === 'OASIS' ? (
        <OasisWorldDetailPage
          world={worldData}
          characters={charactersWithRelation}
          history={safeHistory}
          semantic={safeSemantic}
          audits={safeAudits}
          publicAssets={safePublicAssets}
          loading={initialLoading}
          error={pageError}
          charactersLoading={primaryLoading}
          historyLoading={supplementalLoading}
          semanticLoading={supplementalLoading}
          auditsLoading={false}
          publicAssetsLoading={supplementalLoading}
          onBack={onBack}
          onViewCharacter={handleViewCharacter}
          onMaterializeSource={handleMaterializeSource}
          onOpenConversation={handleOpenCharacterConversation}
          onFollowWorld={handleFollowWorld}
          worldFollowed={worldFollowed}
          initialSubpage={initialSubpage}
          rootScrollViewportRef={detailViewportRef}
        />
      ) : (
        <NarrativeWorldDetailPage
          world={worldData}
          characters={charactersWithRelation}
          history={safeHistory}
          semantic={safeSemantic}
          audits={safeAudits}
          publicAssets={safePublicAssets}
          loading={initialLoading}
          error={pageError}
          charactersLoading={primaryLoading}
          historyLoading={supplementalLoading}
          semanticLoading={supplementalLoading}
          auditsLoading={false}
          publicAssetsLoading={supplementalLoading}
          onBack={onBack}
          onViewCharacter={handleViewCharacter}
          onMaterializeSource={handleMaterializeSource}
          onOpenConversation={handleOpenCharacterConversation}
          onFollowWorld={handleFollowWorld}
          worldFollowed={worldFollowed}
          initialSubpage={initialSubpage}
          rootScrollViewportRef={detailViewportRef}
        />
      )}
    </ScrollArea>
  );
}
