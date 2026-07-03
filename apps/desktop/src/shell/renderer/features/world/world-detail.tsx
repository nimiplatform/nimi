import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { i18n } from '@renderer/i18n';
import { ScrollArea } from '@nimiplatform/kit/ui';
import { createRendererFlowId, logRendererEvent } from '@nimiplatform/kit/telemetry';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import { materializeSourceContactLaunchTarget } from '@renderer/features/relationship/source-contact-launch-target.js';
import { ensureRuntimeAgentExists } from '@renderer/features/chat/chat-agent-shell-host-actions-helpers';
import {
  NarrativeWorldDetailPage,
  OasisWorldDetailPage,
} from './world-detail-template';
import type { WorldCharacter } from './world-detail-types';
import type { WorldListItem } from './world-list-model';
import {
  fetchWorldDisplayDetail,
  toWorldDisplayFallback,
  worldDisplayDetailQueryKey,
} from './world-detail-queries';
import { useFollowedWorlds } from './world-follow-store';

type WorldDetailProps = {
  world: WorldListItem;
  onBack: () => void;
  initialSubpage?: 'relationship-explorer' | null;
};

export function WorldDetail({ world, onBack, initialSubpage }: WorldDetailProps) {
  const authStatus = useAppStore((state) => state.auth.status);
  const ownerUserId = useAppStore((state) => String(state.auth.user?.id || '').trim());
  const navigateToSourceDetail = useAppStore((state) => state.navigateToSourceDetail);
  const isReady = authStatus === 'authenticated' && !!world.id;
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);
  const flowIdRef = useRef('');
  const enteredAtRef = useRef(0);
  const primaryReadyLoggedRef = useRef(false);
  const historySemanticReadyLoggedRef = useRef(false);
  const extendedReadyLoggedRef = useRef(false);

  const worldCompositeQuery = useQuery({
    queryKey: worldDisplayDetailQueryKey(world.id),
    queryFn: () => fetchWorldDisplayDetail(world.id),
    enabled: isReady,
    staleTime: 30_000,
  });

  const display = worldCompositeQuery.data;
  const initialLoading = worldCompositeQuery.isPending && !display;
  const initialError = !initialLoading
    && (worldCompositeQuery.isError || (worldCompositeQuery.isSuccess && !display));
  const pageError = initialError;
  const worldData = display?.world ?? toWorldDisplayFallback(world);
  const characters: WorldCharacter[] = display?.characters ?? [];
  const safeHistory = display?.history ?? { items: [], summary: null };
  const safeSemantic = display?.semantic ?? {
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
  const safeAudits = display?.audits ?? [];
  const safePublicAssets = display?.publicAssets ?? {
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
    if (!worldCompositeQuery.isSuccess || !display || primaryReadyLoggedRef.current) {
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
  }, [display, world.id, worldCompositeQuery.isSuccess]);

  useEffect(() => {
    if (!display || historySemanticReadyLoggedRef.current) {
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
        historyStatus: display.sections.history,
        semanticStatus: display.sections.semantic,
      },
    });
  }, [display, world.id]);

  useEffect(() => {
    if (!display || extendedReadyLoggedRef.current) {
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
        auditStatus: display.sections.audits,
        publicAssetsStatus: display.sections.publicAssets,
      },
    });
  }, [display, world.id]);

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
      const target = await materializeSourceContactLaunchTarget({
        ...character,
        isSource: true,
        displayName: character.name,
        sourceWorldId: character.sourceRef.worldId,
        sourceKind: character.sourceRef.kind,
        sourceId: character.sourceRef.sourceId,
        sourceContentHash: character.sourceRef.sourceContentHash,
      }, ownerUserId);
      await ensureRuntimeAgentExists(target);
      setFeedback({
        kind: 'success',
        message: `${character.name} created as a local agent on this device.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create local agent.';
      setFeedback({ kind: 'error', message });
    }
  };

  return (
    <ScrollArea className="h-full bg-transparent" viewportClassName="bg-transparent">
      {feedback ? (
        <div className="mx-auto w-full max-w-[1400px] px-5 pt-5">
          <InlineFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
        </div>
      ) : null}
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
          charactersLoading={worldCompositeQuery.isPending}
          historyLoading={worldCompositeQuery.isPending}
          semanticLoading={worldCompositeQuery.isPending}
          auditsLoading={worldCompositeQuery.isPending}
          publicAssetsLoading={worldCompositeQuery.isPending}
          onBack={onBack}
          onViewCharacter={handleViewCharacter}
          onMaterializeSource={handleMaterializeSource}
          onFollowWorld={handleFollowWorld}
          worldFollowed={worldFollowed}
          initialSubpage={initialSubpage}
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
          charactersLoading={worldCompositeQuery.isPending}
          historyLoading={worldCompositeQuery.isPending}
          semanticLoading={worldCompositeQuery.isPending}
          auditsLoading={worldCompositeQuery.isPending}
          publicAssetsLoading={worldCompositeQuery.isPending}
          onBack={onBack}
          onViewCharacter={handleViewCharacter}
          onMaterializeSource={handleMaterializeSource}
          onFollowWorld={handleFollowWorld}
          worldFollowed={worldFollowed}
          initialSubpage={initialSubpage}
        />
      )}
    </ScrollArea>
  );
}
