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
import { useAgentConversationHostActions } from './chat-agent-shell-host-actions';

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
  const conversationCapabilitySelectionStore = useAppStore((state) => state.conversationCapabilitySelectionStore);
  const textCapabilityProjection = useAppStore(
    (state) => state.conversationCapabilityProjectionByCapability['text.generate'] || null,
  );
  const [submittingThreadId, setSubmittingThreadId] = useState<string | null>(null);
  const [hostFeedback, setHostFeedback] = useState<InlineFeedbackState | null>(null);
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
    conversationCapabilitySelectionStore,
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
    if (!activeTarget) {
      return createReadyConversationSetupState('agent');
    }
    if (agentRouteReady) {
      return createReadyConversationSetupState('agent');
    }
    const resolutionReason = agentResolution?.reason || 'projection_unavailable';
    const issueDetail = resolutionReason === 'eligibility_denied'
      ? 'Agent eligibility check failed'
      : resolutionReason === 'route_unresolved'
        ? 'Agent route is unresolved'
        : 'Agent text capability is not available';
    return {
      mode: 'agent' as const,
      status: 'setup-required' as const,
      issues: [{ code: 'agent-contract-unavailable' as const, detail: issueDetail }],
      primaryAction: {
        kind: 'open-settings' as const,
        targetId: 'runtime-overview' as const,
        returnToMode: 'agent' as const,
      },
    };
  }, [activeTarget, agentResolution, agentRouteReady, input.authStatus]);

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

  const { handleSelectAgent, handleSelectThread, handleSubmit } = useAgentConversationHostActions({
    activeTarget,
    activeThreadId,
    agentResolution,
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
    inputSelectionAgentId: input.selection.agentId,
    isBundleLoading,
    messages,
    onDismissHostFeedback: () => setHostFeedback(null),
    reasoningLabel,
    renderMessageContent,
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
