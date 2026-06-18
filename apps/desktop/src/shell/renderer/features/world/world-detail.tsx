import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { ScrollArea } from '@nimiplatform/kit/ui';
import { createRendererFlowId, logRendererEvent } from '@nimiplatform/kit/telemetry';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
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

type WorldDetailProps = {
  world: WorldListItem;
  onBack: () => void;
};

export function WorldDetail({ world, onBack }: WorldDetailProps) {
  const authStatus = useAppStore((state) => state.auth.status);
  const navigateToProfile = useAppStore((state) => state.navigateToProfile);
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
  const supplementalError = display
    ? Object.values(display.sections).some((status) => status === 'error')
    : false;
  const pageError = initialError || supplementalError;
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

  // World characters are not chat-reachable from World detail. Chat opens only
  // after a connected source is materialized into a runtime localAgent by value.
  const handleViewCharacter = (character: WorldCharacter) => {
    navigateToProfile(character.id, 'source-detail');
  };

  const handleEnterEdit = () => {
    logRendererEvent({
      level: 'info',
      area: 'world-detail',
      message: 'action:enter-edit:clicked',
      details: {
        worldId: world.id,
      },
    });
  };

  const handleCreateSubWorld = () => {
    logRendererEvent({
      level: 'info',
      area: 'world-detail',
      message: 'action:create-sub-world:clicked',
      details: {
        worldId: world.id,
      },
    });
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
          onEnterEdit={handleEnterEdit}
          onCreateSubWorld={handleCreateSubWorld}
          onViewCharacter={handleViewCharacter}
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
          onEnterEdit={handleEnterEdit}
          onCreateSubWorld={handleCreateSubWorld}
          onViewCharacter={handleViewCharacter}
        />
      )}
    </ScrollArea>
  );
}
