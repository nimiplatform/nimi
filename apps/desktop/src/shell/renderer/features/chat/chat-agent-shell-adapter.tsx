import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createReadyConversationSetupState,
} from '@nimiplatform/nimi-kit/features/chat';
import {
  ConversationOrchestrationRegistry,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import { dataSync } from '@runtime/data-sync';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import {
  type AgentLocalMessageRecord,
  type AgentLocalTargetSnapshot,
} from '@renderer/bridge/runtime-bridge/types';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import { type RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { DesktopConversationModeHost } from './chat-mode-host-types';
import {
  resolveAgentConversationActiveThreadId,
  toAgentFriendTargetsFromSocialSnapshot,
  toConversationMessageViewModel,
} from './chat-agent-thread-model';
import {
  type AgentTurnLifecycleState,
} from './chat-agent-shell-lifecycle';
import {
  type AgentHostFlowFooterState,
} from './chat-agent-shell-host-flow';
import { resolveAgentLocalRoute } from './chat-agent-runtime';
import { createAgentLocalChatConversationProvider } from './chat-agent-orchestration';
import type { AgentConversationSelection } from './chat-shell-types';
import {
  createReasoningMessageContentRenderer,
  useConversationStreamState,
} from './chat-runtime-stream-ui';
import {
  getChatThinkingUnsupportedCopy,
  resolveAgentThinkingSupportFromProjection,
} from './chat-thinking';
import { type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import {
  bundleQueryKey,
  sortThreadSummaries,
  toErrorMessage,
  THREADS_QUERY_KEY,
  TARGETS_QUERY_KEY,
  isEmptyPendingAssistantMessage,
} from './chat-agent-shell-core';
import { useAgentConversationPresentation } from './chat-agent-shell-presentation';
import { useAgentConversationEffects } from './chat-agent-shell-effects';
import { useAgentConversationCapabilityEffects } from './chat-agent-shell-capability-effects';
import { useSchedulingFeasibility } from './chat-execution-scheduling-guard';
import { useAgentConversationHostActions } from './chat-agent-shell-host-actions';
import { resolveAiConversationSetupStateFromProjection } from './chat-ai-route-view';
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import type { RouteModelPickerSelection } from '@nimiplatform/nimi-kit/features/model-picker';
import { toRuntimeRouteBindingFromPickerSelection } from './conversation-capability';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service';

type SocialSnapshot = Awaited<ReturnType<typeof dataSync.loadSocialSnapshot>>;

type UseAgentConversationModeHostInput = {
  authStatus: 'bootstrapping' | 'anonymous' | 'authenticated';
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  selection: AgentConversationSelection;
  lastSelectedThreadId: string | null;
  setSelection: (selection: AgentConversationSelection) => void;
};

export function useAgentConversationModeHost(
  input: UseAgentConversationModeHostInput,
): DesktopConversationModeHost {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const chatThinkingPreference = useAppStore((state) => state.chatThinkingPreference);
  const setChatThinkingPreference = useAppStore((state) => state.setChatThinkingPreference);
  const agentAdapterAiConfig = useAppStore((state) => state.aiConfig);
  const textCapabilityProjection = useAppStore(
    (state) => state.conversationCapabilityProjectionByCapability['text.generate'] || null,
  );
  const [submittingThreadId, setSubmittingThreadId] = useState<string | null>(null);
  const [hostFeedback, setHostFeedback] = useState<InlineFeedbackState | null>(null);
  const schedulingJudgement = useSchedulingFeasibility();
  const [footerHostStateByThreadId, setFooterHostStateByThreadId] = useState<
    Record<string, {
      footerState: AgentHostFlowFooterState;
      lifecycle: AgentTurnLifecycleState;
    }>
  >({});
  const currentDraftTextRef = useRef('');
  const registry = useMemo(() => {
    const nextRegistry = new ConversationOrchestrationRegistry();
    nextRegistry.register(createAgentLocalChatConversationProvider());
    return nextRegistry;
  }, []);
  const agentProvider = useMemo(
    () => registry.require('agent-local-chat-v1'),
    [registry],
  );
  const reportHostError = useCallback((error: unknown) => {
    setHostFeedback({
      kind: 'error',
      message: toErrorMessage(error),
    });
  }, []);
  const thinkingSupport = useMemo(
    () => resolveAgentThinkingSupportFromProjection(textCapabilityProjection),
    [textCapabilityProjection],
  );
  const thinkingUnsupportedReason = useMemo(() => {
    if (thinkingSupport.supported || !thinkingSupport.reason) {
      return null;
    }
    const copy = getChatThinkingUnsupportedCopy(thinkingSupport.reason);
    return t(copy.key, { defaultValue: copy.defaultValue });
  }, [t, thinkingSupport]);

  const textGenerateBinding: RuntimeRouteBinding | null | undefined =
    agentAdapterAiConfig.capabilities.selectedBindings['text.generate'] as RuntimeRouteBinding | null | undefined;
  const hasExplicitTextGenerateSelection = Object.prototype.hasOwnProperty.call(
    agentAdapterAiConfig.capabilities.selectedBindings,
    'text.generate',
  );
  const selectedTextBinding = hasExplicitTextGenerateSelection
    ? (textGenerateBinding ?? null)
    : null;

  const handleModelSelectionChange = useCallback((selection: RouteModelPickerSelection) => {
    if (!selection.model) {
      return;
    }
    const currentModel = selectedTextBinding?.modelId || selectedTextBinding?.model || '';
    if (
      selectedTextBinding
      && selectedTextBinding.source === selection.source
      && currentModel === selection.model
    ) {
      return;
    }
    const binding = toRuntimeRouteBindingFromPickerSelection({
      capability: 'text.generate',
      selection,
    });
    if (binding) {
      // Write through AIConfig surface (D-AIPC-003) — the formal config owner.
      const surface = getDesktopAIConfigService();
      const nextBindings = { ...agentAdapterAiConfig.capabilities.selectedBindings };
      nextBindings['text.generate'] = binding;
      const nextConfig = {
        ...agentAdapterAiConfig,
        capabilities: { ...agentAdapterAiConfig.capabilities, selectedBindings: nextBindings },
      };
      surface.aiConfig.update(nextConfig.scopeRef, nextConfig);
    }
  }, [agentAdapterAiConfig, selectedTextBinding]);

  const initialModelSelection = useMemo<Partial<RouteModelPickerSelection>>(() => {
    if (!selectedTextBinding) {
      return {};
    }
    return {
      source: selectedTextBinding.source,
      connectorId: selectedTextBinding.connectorId || '',
      model: selectedTextBinding.modelId || selectedTextBinding.model || '',
      modelLabel: selectedTextBinding.modelLabel,
    };
  }, [selectedTextBinding]);

  const setSelection = useCallback((selection: AgentConversationSelection) => {
    if (
      input.selection.threadId === selection.threadId
      && input.selection.agentId === selection.agentId
      && input.selection.targetId === selection.targetId
    ) {
      return;
    }
    input.setSelection(selection);
  }, [input]);

  const targetsQuery = useQuery({
    queryKey: [...TARGETS_QUERY_KEY, input.authStatus],
    queryFn: async (): Promise<AgentLocalTargetSnapshot[]> => {
      const snapshot = await dataSync.loadSocialSnapshot() as SocialSnapshot;
      return toAgentFriendTargetsFromSocialSnapshot(snapshot);
    },
    enabled: input.authStatus === 'authenticated',
  });

  const targets = useMemo(
    () => targetsQuery.data || [],
    [targetsQuery.data],
  );
  const targetByAgentId = useMemo(
    () => new Map(targets.map((target) => [target.agentId, target])),
    [targets],
  );

  const threadsQuery = useQuery({
    queryKey: THREADS_QUERY_KEY,
    queryFn: () => chatAgentStoreClient.listThreads(),
    enabled: input.authStatus === 'authenticated',
  });
  const threads = useMemo(
    () => sortThreadSummaries(threadsQuery.data || []),
    [threadsQuery.data],
  );

  const activeThreadId = useMemo(
    () => resolveAgentConversationActiveThreadId({
      threads,
      selectionThreadId: input.selection.threadId,
      selectionAgentId: input.selection.agentId,
      lastSelectedThreadId: input.lastSelectedThreadId,
    }),
    [input.lastSelectedThreadId, input.selection.agentId, input.selection.threadId, threads],
  );

  const selectedThreadRecord = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) || null,
    [activeThreadId, threads],
  );
  const selectedTarget = useMemo(
    () => targetByAgentId.get(input.selection.agentId || '') || null,
    [input.selection.agentId, targetByAgentId],
  );
  const activeTarget = selectedThreadRecord?.targetSnapshot || selectedTarget || null;
  const agentRouteQuery = useQuery({
    queryKey: ['agent-chat-route', activeTarget?.agentId || 'inactive'],
    queryFn: () => resolveAgentLocalRoute(activeTarget?.agentId || ''),
    enabled: input.authStatus === 'authenticated' && Boolean(activeTarget?.agentId),
  });

  const agentResolution = useAppStore((state) => state.agentEffectiveCapabilityResolution);
  const agentRouteReady = agentResolution?.ready === true;

  const bundleQuery = useQuery({
    queryKey: activeThreadId ? bundleQueryKey(activeThreadId) : ['chat-agent-thread-bundle', 'inactive'],
    queryFn: () => chatAgentStoreClient.getThreadBundle(activeThreadId as string),
    enabled: Boolean(activeThreadId),
  });
  const bundle = bundleQuery.data || null;
  const messages = useMemo(
    () => (bundle?.messages || [])
      .map((message: AgentLocalMessageRecord) => toConversationMessageViewModel(message))
      .filter((message) => !isEmptyPendingAssistantMessage(message)),
    [bundle?.messages],
  );
  const streamState = useConversationStreamState(activeThreadId);
  const isBundleLoading = Boolean(activeThreadId) && bundleQuery.isPending && !bundle;

  useAgentConversationCapabilityEffects({
    agentRouteData: agentRouteQuery.data
      ? {
        channel: agentRouteQuery.data.channel,
        sessionClass: agentRouteQuery.data.sessionClass,
        providerSelectable: agentRouteQuery.data.providerSelectable,
        reason: agentRouteQuery.data.reason || '',
      }
      : null,
    bootstrapReady,
    textCapabilityProjection,
  });

  const setupState = useMemo(() => {
    if (input.authStatus !== 'authenticated') {
      return {
        mode: 'agent' as const,
        status: 'setup-required' as const,
        issues: [{ code: 'agent-contract-unavailable' as const, detail: 'Sign in to use Agent mode' }],
        primaryAction: {
          kind: 'sign-in' as const,
          returnToMode: 'agent' as const,
        },
      };
    }
    if (textCapabilityProjection?.supported) {
      return createReadyConversationSetupState('agent');
    }
    if (!activeTarget) {
      return createReadyConversationSetupState('agent');
    }
    return resolveAiConversationSetupStateFromProjection(textCapabilityProjection);
  }, [activeTarget, input.authStatus, textCapabilityProjection]);

  const composerReady = setupState.status === 'ready'
    && !isBundleLoading
    && !bundleQuery.error;

  const {
    applyDriverEffects,
    setBundleCache,
    setFooterHostState,
    setThreadsCache,
    syncSelectionToThread,
  } = useAgentConversationEffects({
    currentDraftTextRef,
    queryClient,
    setFooterHostStateByThreadId,
    setSelection,
  });

  const agentAiConfig = useAppStore((state) => state.aiConfig);
  const { handleSelectAgent, handleSelectThread, handleSubmit } = useAgentConversationHostActions({
    activeTarget,
    activeThreadId,
    agentResolution,
    aiConfig: agentAiConfig,
    applyDriverEffects,
    bundle,
    currentDraftTextRef,
    draftText: bundle?.draft?.text,
    draftUpdatedAtMs: bundle?.draft?.updatedAtMs,
    queryClient,
    reportHostError,
    runAgentTurn: (turnInput) => agentProvider.runTurn({
      modeId: 'agent-local-chat-v1',
      threadId: turnInput.threadId,
      turnId: turnInput.turnId,
      userMessage: turnInput.userMessage,
      history: turnInput.history,
      signal: turnInput.signal,
      metadata: {
        agentLocalChat: {
          agentId: turnInput.target.agentId,
          targetSnapshot: turnInput.target,
          routeResult: turnInput.routeResult,
          agentResolution: turnInput.agentResolution,
          executionSnapshot: turnInput.executionSnapshot,
          runtimeConfigState: input.runtimeConfigState,
          runtimeFields: input.runtimeFields,
          reasoningPreference: chatThinkingPreference,
        },
      },
    }),
    selectedAgentId: input.selection.agentId,
    selectedThreadRecord,
    setBundleCache,
    setFooterHostState,
    setSubmittingThreadId,
    setThreadsCache,
    submittingThreadId,
    syncSelectionToThread,
    t,
    targetByAgentId,
    targetsReady: targetsQuery.isSuccess,
    threads,
    threadsReady: threadsQuery.isSuccess,
  });

  const reasoningLabel = t('Chat.reasoningLabel', { defaultValue: 'Thought process' });
  const renderMessageContent = useMemo(
    () => createReasoningMessageContentRenderer(reasoningLabel),
    [reasoningLabel],
  );
  const currentFooterHostState = activeThreadId ? footerHostStateByThreadId[activeThreadId] || null : null;
  const presentation = useAgentConversationPresentation({
    activeTarget,
    activeThreadId,
    bundle,
    bundleError: bundleQuery.error,
    composerReady,
    currentDraftTextRef,
    currentFooterHostState,
    handleSubmit,
    hostFeedback,
    initialModelSelection,
    inputSelectionAgentId: input.selection.agentId,
    isBundleLoading,
    messages,
    onDismissHostFeedback: () => setHostFeedback(null),
    onModelSelectionChange: handleModelSelectionChange,
    reasoningLabel,
    renderMessageContent,
    schedulingJudgement,
    selectedTargetId: activeTarget?.agentId || null,
    setChatThinkingPreference,
    setupState,
    streamState,
    submittingThreadId,
    t,
    targetSummariesInput: { targets, threads },
    targetsPending: targetsQuery.isPending,
    thinkingPreference: chatThinkingPreference,
    thinkingSupported: thinkingSupport.supported,
    thinkingUnsupportedReason,
    agentRouteReady,
  });

  return useMemo<DesktopConversationModeHost>(() => ({
    ...presentation,
    onSelectTarget: handleSelectAgent,
    onSelectThread: handleSelectThread,
  }), [handleSelectAgent, handleSelectThread, presentation]);
}
