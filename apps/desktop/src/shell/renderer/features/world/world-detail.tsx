import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import { i18n } from '@renderer/i18n';
import {
  NarrativeWorldDetailPage,
  OasisWorldDetailPage,
} from './world-detail-template';
import type { WorldAgent } from './world-detail-types';
import type { WorldListItem } from './world-list-model';
import {
  fetchWorldDisplayDetail,
  toWorldDisplayFallback,
  worldDisplayDetailQueryKey,
} from './world-detail-queries';
import {
  launchAgentConversationFromDisplay,
  launchAgentVoiceFromDisplay,
} from '@renderer/features/chat/agent-conversation-launcher.js';

type WorldDetailProps = {
  world: WorldListItem;
  onBack: () => void;
};

export function WorldDetail({ world, onBack }: WorldDetailProps) {
  const authStatus = useAppStore((state) => state.auth.status);
  const navigateToProfile = useAppStore((state) => state.navigateToProfile);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setChatMode = useAppStore((state) => state.setChatMode);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const setAgentConversationSelection = useAppStore((state) => state.setAgentConversationSelection);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
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
  const agents: WorldAgent[] = display?.agents ?? [];
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

  const toAgentConversationTarget = (agent: WorldAgent): AgentLocalTargetSnapshot => ({
    agentId: agent.id,
    displayName: agent.name,
    handle: agent.handle,
    avatarUrl: agent.avatarUrl ?? null,
    worldId: worldData.id || world.id,
    worldName: worldData.name || world.name,
    bio: agent.bio || null,
    ownershipType: null,
  });

  const handleChatAgent = async (agent: WorldAgent) => {
    logRendererEvent({
      level: 'info',
      area: 'world-detail',
      message: 'action:chat-agent:clicked',
      details: {
        worldId: world.id,
        agentId: agent.id,
      },
    });
    try {
      const launch = await launchAgentVoiceFromDisplay({
        target: toAgentConversationTarget(agent),
        setActiveTab,
        setChatMode,
        setSelectedTargetForSource,
        setAgentConversationSelection,
        setRuntimeFields,
      });
      setFeedback({
        kind: 'info',
        message: i18n.t('WorldDetail.xianxia.v2.agents.chatOpensInConversation', {
          defaultValue: 'Chat opens inside the agent conversation surface.',
        }),
      });
      logRendererEvent({
        level: 'info',
        area: 'world-detail',
        message: 'action:chat-agent:opened',
        details: {
          worldId: world.id,
          agentId: agent.id,
          threadId: launch.threadId,
          createdThread: launch.createdThread,
          routedSurface: launch.routedSurface,
        },
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error
          ? error.message
          : i18n.t('Contacts.openChatFailed', { defaultValue: 'Failed to open chat' }),
      });
      logRendererEvent({
        level: 'warn',
        area: 'world-detail',
        message: 'action:chat-agent:failed',
        details: {
          worldId: world.id,
          agentId: agent.id,
          error: error instanceof Error ? error.message : String(error || ''),
        },
      });
    }
  };

  const handleVoiceAgent = async (agent: WorldAgent) => {
    logRendererEvent({
      level: 'info',
      area: 'world-detail',
      message: 'action:voice-agent:clicked',
      details: {
        worldId: world.id,
        agentId: agent.id,
      },
    });
    try {
      const launch = await launchAgentConversationFromDisplay({
        target: toAgentConversationTarget(agent),
        setActiveTab,
        setChatMode,
        setSelectedTargetForSource,
        setAgentConversationSelection,
        setRuntimeFields,
      });
      setFeedback({
        kind: 'info',
        message: i18n.t('WorldDetail.xianxia.v2.agents.voiceOpensInConversation', {
          defaultValue: 'Voice interaction opens inside the agent conversation surface.',
        }),
      });
      logRendererEvent({
        level: 'info',
        area: 'world-detail',
        message: 'action:voice-agent:opened',
        details: {
          worldId: world.id,
          agentId: agent.id,
          threadId: launch.threadId,
          createdThread: launch.createdThread,
          routedSurface: launch.routedSurface,
        },
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error
          ? error.message
          : i18n.t('Contacts.openChatFailed', { defaultValue: 'Failed to open chat' }),
      });
      logRendererEvent({
        level: 'warn',
        area: 'world-detail',
        message: 'action:voice-agent:failed',
        details: {
          worldId: world.id,
          agentId: agent.id,
          error: error instanceof Error ? error.message : String(error || ''),
        },
      });
    }
  };

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

  const createAgentMutation = useMutation({
    mutationFn: async (input: {
      handle: string;
      displayName: string;
      concept: string;
      description: string;
      scenario: string;
      greeting: string;
      referenceImageUrl: string;
      referenceImageFile: File | null;
      wakeStrategy: '' | 'PASSIVE' | 'PROACTIVE';
      dnaPrimary: '' | 'CARING' | 'PLAYFUL' | 'INTELLECTUAL' | 'CONFIDENT' | 'MYSTERIOUS' | 'ROMANTIC';
      dnaSecondary: string[];
    }) => {
      let resolvedImageUrl: string | undefined;
      if (input.referenceImageFile) {
        const upload = await dataSync.createImageDirectUpload();
        const formData = new FormData();
        formData.append('file', input.referenceImageFile);
        const response = await fetch(upload.uploadUrl, { method: 'POST', body: formData });
        if (!response.ok) {
          throw new Error('头像上传失败，请重试');
        }
        const finalized = await dataSync.finalizeResource(upload.resourceId, {});
        resolvedImageUrl = finalized.url ?? undefined;
      }
      return dataSync.createAgent({
        worldId: world.id,
        handle: input.handle,
        concept: input.concept,
        displayName: input.displayName || undefined,
        description: input.description || undefined,
        scenario: input.scenario || undefined,
        greeting: input.greeting || undefined,
        referenceImageUrl: resolvedImageUrl,
        wakeStrategy: input.wakeStrategy || undefined,
        dnaPrimary: (input.dnaPrimary || undefined) as Parameters<typeof dataSync.createAgent>[0]['dnaPrimary'],
        dnaSecondary: input.dnaSecondary.length
          ? input.dnaSecondary as Parameters<typeof dataSync.createAgent>[0]['dnaSecondary']
          : undefined,
      });
    },
    onSuccess: async (data) => {
      const agentId = typeof data?.id === 'string' && data.id ? data.id : null;
      setFeedback(null);
      await queryClient.invalidateQueries({ queryKey: worldDisplayDetailQueryKey(world.id) });
      if (agentId) {
        navigateToProfile(agentId, 'agent-detail');
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : '创建 Agent 失败，请重试';
      setFeedback({ kind: 'error', message });
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
          onChatAgent={handleChatAgent}
          onVoiceAgent={handleVoiceAgent}
          onViewAgent={handleViewAgent}
          onCreateAgent={(input) => createAgentMutation.mutate(input)}
          createAgentMutating={createAgentMutation.isPending}
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
          onChatAgent={handleChatAgent}
          onVoiceAgent={handleVoiceAgent}
          onViewAgent={handleViewAgent}
          onCreateAgent={(input) => createAgentMutation.mutate(input)}
          createAgentMutating={createAgentMutation.isPending}
        />
      )}
    </ScrollArea>
  );
}
