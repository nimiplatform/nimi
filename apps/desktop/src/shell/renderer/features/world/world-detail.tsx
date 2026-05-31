import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getPlatformClient } from '@nimiplatform/sdk';
import { uploadRealmResourceFileWithRealm } from '@nimiplatform/sdk/realm';
import { realmAgentCreateData } from './data/realm-agent-create-data';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { ScrollArea } from '@nimiplatform/kit/ui';
import { createRendererFlowId, logRendererEvent } from '@nimiplatform/kit/telemetry';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import { i18n } from '@renderer/i18n';
import {
  NarrativeWorldDetailPage,
  OasisWorldDetailPage,
} from './world-detail-template';
import type { WorldAgent } from './world-detail-types';
import { worldAdmitsUserCreatedRealmAgents } from './world-create-agent-admission';
import { clearCreateAgentDraft, type CreateAgentConfirmInput } from './create-agent-drawer';
import { buildRealmAgentWritePayload } from './create-agent/realm-agent-draft-submit';
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
  const [createAgentRejection, setCreateAgentRejection] = useState<string | null>(null);
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
  const agents: WorldAgent[] = display?.agents ?? [];
  const createAgentAdmitted = worldAdmitsUserCreatedRealmAgents(worldData);
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
    lorebooks: [],
    scenes: [],
    bindings: [],
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

  // A RealmAgent in a World is NOT chat-reachable from World detail. Per
  // D-EXPL-006 / T3 there is no RealmAgent direct-chat path: chat is reachable
  // ONLY after friendship, via the `friend` → Open Agent Chat action that
  // routes to the one-to-one LocalAgent Chat. The previous `handleChatAgent` /
  // `handleVoiceAgent` synthesized a `localAgentRef` from a non-befriended
  // RealmAgent and launched a session directly — that drift is removed. World
  // detail's agent affordance is View profile → agent-detail, where the
  // friend-state primary action lives.
  const handleViewAgent = (agent: WorldAgent) => {
    navigateToProfile(agent.id, 'agent-detail');
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

  // The single Realm truth write for lightweight RealmAgent creation
  // (D-EXPL-010). The drawer owns the draft-review-confirm flow; this mutation
  // runs only on the explicit confirm. On rejection the draft stays locally
  // recoverable in the drawer (D-EXPL-011) and a typed message is shown.
  const createAgentMutation = useMutation({
    mutationFn: async (input: CreateAgentConfirmInput) => {
      if (!worldAdmitsUserCreatedRealmAgents(worldData)) {
        throw new Error(i18n.t('World.createAgent.notAdmitted', {
          defaultValue: 'This World is not admitting new user-created RealmAgents.',
        }));
      }
      let resolvedImageUrl: string | undefined;
      if (input.avatarFile) {
        const uploaded = await uploadRealmResourceFileWithRealm({
          realm: getPlatformClient().realm,
          kind: 'image',
          file: input.avatarFile,
          failureMessage: i18n.t('World.createAgent.avatarUploadFailed', {
            defaultValue: 'Avatar upload failed, please retry.',
          }),
        });
        resolvedImageUrl = uploaded.resource.url ?? undefined;
      }
      const payload = buildRealmAgentWritePayload(input.draft, resolvedImageUrl);
      return realmAgentCreateData.createAgent({
        worldId: payload.worldId,
        handle: payload.handle,
        concept: payload.concept,
        displayName: payload.displayName,
        description: payload.description,
        referenceImageUrl: payload.referenceImageUrl,
        dnaPrimary: payload.dnaPrimary,
        dnaSecondary: payload.dnaSecondary,
      });
    },
    onSuccess: async (data) => {
      const agentId = typeof data?.id === 'string' && data.id ? data.id : null;
      setFeedback(null);
      setCreateAgentRejection(null);
      // Realm truth was written: the locally persisted draft is no longer
      // needed and is cleared so it does not resurface as recoverable.
      clearCreateAgentDraft(world.id);
      await queryClient.invalidateQueries({ queryKey: worldDisplayDetailQueryKey(world.id) });
      if (agentId) {
        navigateToProfile(agentId, 'agent-detail');
      }
    },
    onError: (error) => {
      const message = error instanceof Error
        ? error.message
        : i18n.t('World.createAgent.failed', { defaultValue: 'Could not create the agent, please retry.' });
      // Surfaced inside the drawer; the draft remains recoverable (D-EXPL-011).
      setCreateAgentRejection(message);
    },
  });

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
          agents={agents}
          history={safeHistory}
          semantic={safeSemantic}
          audits={safeAudits}
          publicAssets={safePublicAssets}
          loading={initialLoading}
          error={pageError}
          agentsLoading={worldCompositeQuery.isPending}
          historyLoading={worldCompositeQuery.isPending}
          semanticLoading={worldCompositeQuery.isPending}
          auditsLoading={worldCompositeQuery.isPending}
          publicAssetsLoading={worldCompositeQuery.isPending}
          onBack={onBack}
          onEnterEdit={handleEnterEdit}
          onCreateSubWorld={handleCreateSubWorld}
          onViewAgent={handleViewAgent}
          onCreateAgent={createAgentAdmitted ? (input) => createAgentMutation.mutate(input) : undefined}
          createAgentMutating={createAgentMutation.isPending}
          createAgentRejection={createAgentRejection}
        />
      ) : (
        <NarrativeWorldDetailPage
          world={worldData}
          agents={agents}
          history={safeHistory}
          semantic={safeSemantic}
          audits={safeAudits}
          publicAssets={safePublicAssets}
          loading={initialLoading}
          error={pageError}
          agentsLoading={worldCompositeQuery.isPending}
          historyLoading={worldCompositeQuery.isPending}
          semanticLoading={worldCompositeQuery.isPending}
          auditsLoading={worldCompositeQuery.isPending}
          publicAssetsLoading={worldCompositeQuery.isPending}
          onBack={onBack}
          onEnterEdit={handleEnterEdit}
          onCreateSubWorld={handleCreateSubWorld}
          onViewAgent={handleViewAgent}
          onCreateAgent={createAgentAdmitted ? (input) => createAgentMutation.mutate(input) : undefined}
          createAgentMutating={createAgentMutation.isPending}
          createAgentRejection={createAgentRejection}
        />
      )}
    </ScrollArea>
  );
}
