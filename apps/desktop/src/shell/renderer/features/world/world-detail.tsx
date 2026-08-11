import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../app-shell/providers/app-store';

import { ScrollArea } from '@nimiplatform/kit/ui';
import { createRendererFlowId, logRendererEvent } from '@nimiplatform/kit/telemetry';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast';
import { characterSourceMaterializationFailureMessage } from '../explore/character-source-materialization';
import { materializeCharacterSourceLaunchTarget } from '../relationship/character-source-launch-target.js';
import { ensureRuntimeAgentExists } from '../chat/chat-agent-shell-host-actions-helpers';
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
  onBack: () => void;
  initialSubpage?: 'people-archive' | 'relationship-explorer' | null;
};

export function WorldDetail({ world, onBack, initialSubpage }: WorldDetailProps) {
  const bindings = useDesktopRendererBindings();
  const i18n = useDesktopI18nResource().instance;
  const queryClient = useQueryClient();
  const authStatus = useAppStore((state) => state.auth.status);
  const ownerUserId = useAppStore((state) => String(state.auth.user?.id || '').trim());
  const navigateToSourceDetail = useAppStore((state) => state.navigateToSourceDetail);
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
      const target = await materializeCharacterSourceLaunchTarget({
        ...character,
        displayName: character.name,
        sourceWorldId: character.sourceRef.worldId,
        sourceKind: character.sourceRef.kind,
        sourceId: character.sourceRef.id,
        sourceHash: character.sourceRef.sourceHash,
      }, ownerUserId, i18n.t, bindings.sdk);
      await ensureRuntimeAgentExists(target, bindings.sdk, ownerUserId);
      setFeedback({
        kind: 'success',
        message: `${character.name} is ready as your partner.`,
      });
    } catch (error) {
      const message = characterSourceMaterializationFailureMessage(error, i18n.t);
      setFeedback({ kind: 'error', message });
    }
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
          characters={characters}
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
          onFollowWorld={handleFollowWorld}
          worldFollowed={worldFollowed}
          initialSubpage={initialSubpage}
          rootScrollViewportRef={detailViewportRef}
        />
      ) : (
        <NarrativeWorldDetailPage
          world={worldData}
          characters={characters}
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
          onFollowWorld={handleFollowWorld}
          worldFollowed={worldFollowed}
          initialSubpage={initialSubpage}
          rootScrollViewportRef={detailViewportRef}
        />
      )}
    </ScrollArea>
  );
}
