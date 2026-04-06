import {
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
  useRef,
  useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ConversationOrchestrationRegistry,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import { createSimpleAiConversationProvider } from '@nimiplatform/nimi-kit/features/chat/runtime';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import type { ChatAiMessageRecord } from '@renderer/bridge/runtime-bridge/types';
import { chatAiStoreClient } from '@renderer/bridge/runtime-bridge/chat-ai-store';
import { type RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { useTranslation } from 'react-i18next';
import { resolveAiConversationRouteReadiness, type AiConversationResolvedRoute, type AiConversationRouteReadiness } from './chat-ai-route-readiness';
import type { DesktopConversationModeHost } from './chat-mode-host-types';
import {
  getResolvedRouteDisplaySummary,
  hasAiConversationThread,
  resolveAiConversationActiveThreadId,
  toConversationMessageViewModel,
} from './chat-ai-thread-model';
import type { AiConversationSelection } from './chat-shell-types';
import {
  createReasoningMessageContentRenderer,
  RuntimeStreamFooter,
  useConversationStreamState,
} from './chat-runtime-stream-ui';
import { composeDesktopChatSystemPrompt } from './chat-output-contract';
import {
  getChatThinkingUnsupportedCopy,
  resolveAiThinkingSupportFromProjection,
} from './chat-thinking';
import { type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import {
  bundleQueryKey,
  isEmptyPendingAssistantMessage,
  sortThreadSummaries,
  THREADS_QUERY_KEY,
  toErrorMessage,
} from './chat-ai-shell-core';
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import { useAiConversationPresentation } from './chat-ai-shell-presentation';
import { createChatAiConversationRuntimeAdapter } from './chat-ai-shell-runtime-adapter';
import { useAiConversationEffects } from './chat-ai-shell-effects';
import { useAiConversationCapabilityEffects } from './chat-ai-shell-capability-effects';
import { useAiConversationHostActions } from './chat-ai-shell-host-actions';

type UseAiConversationModeHostInput = {
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  selection: AiConversationSelection;
  lastSelectedThreadId: string | null;
  setSelection: (selection: AiConversationSelection) => void;
};


export function useAiConversationModeHost(
  input: UseAiConversationModeHostInput,
): { host: DesktopConversationModeHost; readiness: AiConversationRouteReadiness } {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const chatThinkingPreference = useAppStore((state) => state.chatThinkingPreference);
  const setChatThinkingPreference = useAppStore((state) => state.setChatThinkingPreference);
  const conversationCapabilitySelectionStore = useAppStore((state) => state.conversationCapabilitySelectionStore);
  const setConversationCapabilityBinding = useAppStore((state) => state.setConversationCapabilityBinding);
  const textCapabilityProjection = useAppStore(
    (state) => state.conversationCapabilityProjectionByCapability['text.generate'] || null,
  );
  const [submittingThreadId, setSubmittingThreadId] = useState<string | null>(null);
  const [hostFeedback, setHostFeedback] = useState<InlineFeedbackState | null>(null);
  const currentDraftTextRef = useRef('');
  const reportHostError = useCallback((error: unknown) => {
    setHostFeedback({
      kind: 'error',
      message: toErrorMessage(error),
    });
  }, []);

  const setSelection = useCallback((selection: AiConversationSelection) => {
    if (input.selection.threadId === selection.threadId) {
      return;
    }
    input.setSelection(selection);
  }, [input]);

  const threadsQuery = useQuery({
    queryKey: THREADS_QUERY_KEY,
    queryFn: () => chatAiStoreClient.listThreads(),
  });

  const threads = useMemo(
    () => sortThreadSummaries(threadsQuery.data || []),
    [threadsQuery.data],
  );

  const activeThreadId = useMemo(
    () => resolveAiConversationActiveThreadId({
      threads,
      selectionThreadId: input.selection.threadId,
      lastSelectedThreadId: input.lastSelectedThreadId,
    }),
    [input.lastSelectedThreadId, input.selection.threadId, threads],
  );

  const selectedThreadRecord = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) || null,
    [activeThreadId, threads],
  );

  const textGenerateBinding: RuntimeRouteBinding | null | undefined =
    conversationCapabilitySelectionStore.selectedBindings['text.generate'];
  const readiness = useMemo(
    () => resolveAiConversationRouteReadiness({
      runtimeConfigState: input.runtimeConfigState,
      selectedBinding: textGenerateBinding ?? undefined,
    }),
    [input.runtimeConfigState, textGenerateBinding],
  );

  const availableResolvedRoutes = useMemo(
    () => readiness.readyRoutes,
    [readiness.readyRoutes],
  );

  const currentResolvedRoute: AiConversationResolvedRoute | null =
    readiness.preferredRoute || readiness.defaultRoute || null;
  const thinkingSupport = useMemo(
    () => resolveAiThinkingSupportFromProjection(textCapabilityProjection),
    [textCapabilityProjection],
  );
  const thinkingUnsupportedReason = useMemo(() => {
    if (thinkingSupport.supported || !thinkingSupport.reason) {
      return null;
    }
    const copy = getChatThinkingUnsupportedCopy(thinkingSupport.reason);
    return t(copy.key, { defaultValue: copy.defaultValue });
  }, [t, thinkingSupport]);

  const bundleQuery = useQuery({
    queryKey: activeThreadId ? bundleQueryKey(activeThreadId) : ['chat-ai-thread-bundle', 'inactive'],
    queryFn: () => chatAiStoreClient.getThreadBundle(activeThreadId as string),
    enabled: Boolean(activeThreadId),
  });

  const bundle = bundleQuery.data || null;
  const messages = useMemo(
    () => (bundle?.messages || [])
      .map((message: ChatAiMessageRecord) => toConversationMessageViewModel(message))
      .filter((message) => !isEmptyPendingAssistantMessage(message)),
    [bundle?.messages],
  );
  const streamState = useConversationStreamState(activeThreadId);
  const projectionSupported = textCapabilityProjection?.supported === true;
  const aiProvider = useMemo(() => {
    if (!projectionSupported || !activeThreadId) {
      return null;
    }
    const registry = new ConversationOrchestrationRegistry();
    registry.register(createSimpleAiConversationProvider({
      runtimeAdapter: createChatAiConversationRuntimeAdapter({
        threadId: activeThreadId,
        reasoningPreference: chatThinkingPreference,
        textProjection: textCapabilityProjection,
        runtimeConfigState: input.runtimeConfigState,
        runtimeFields: input.runtimeFields,
      }),
      resolveSystemPrompt: (turnInput) => composeDesktopChatSystemPrompt(turnInput.systemPrompt),
    }));
    return registry.require('simple-ai');
  }, [
    activeThreadId,
    chatThinkingPreference,
    projectionSupported,
    textCapabilityProjection,
    input.runtimeConfigState,
    input.runtimeFields,
  ]);

  const isBundleLoading = Boolean(activeThreadId) && bundleQuery.isPending && !bundle;
  // Composer is available whenever setup is ready — don't gate on activeThreadId
  // so that the composer shows before auto-create finishes.
  const composerReady = readiness.setupState.status === 'ready'
    && !isBundleLoading
    && !bundleQuery.error;

  const {
    setBundleCache,
    setThreadsCache,
    syncSelectionToThread,
  } = useAiConversationEffects({
    queryClient,
    setSelection,
  });

  useAiConversationCapabilityEffects({
    bootstrapReady,
    conversationCapabilitySelectionStore,
    currentDraftTextRef,
    draftText: bundle?.draft?.text,
    draftUpdatedAtMs: bundle?.draft?.updatedAtMs,
  });

  useEffect(() => {
    if (!threadsQuery.isSuccess) {
      return;
    }
    if (input.selection.threadId && !hasAiConversationThread(threads, input.selection.threadId)) {
      setSelection({ threadId: null });
      return;
    }
    if (!input.selection.threadId && activeThreadId && selectedThreadRecord) {
      syncSelectionToThread(activeThreadId);
    }
  }, [
    activeThreadId,
    input.selection.threadId,
    selectedThreadRecord,
    setSelection,
    syncSelectionToThread,
    threads,
    threadsQuery.isSuccess,
  ]);

  const {
    handleArchiveThread,
    handleCreateThread,
    handleRenameThread,
    handleRouteSelection,
    handleSelectThread,
    handleSubmit,
  } = useAiConversationHostActions({
    activeThreadId,
    bundleMessages: bundle?.messages,
    currentDraftTextRef,
    queryClient,
    reportHostError,
    runAiTurn: aiProvider
      ? (turnInput) => aiProvider.runTurn({
        modeId: 'simple-ai',
        ...turnInput,
      })
      : null,
    selectedThreadRecord,
    setBundleCache,
    setConversationCapabilityBinding,
    setSubmittingThreadId,
    setThreadsCache,
    setupReady: readiness.setupState.status === 'ready',
    submittingThreadId,
    syncSelectionToThread,
    t,
    threads,
  });

  const routeSummary = getResolvedRouteDisplaySummary(currentResolvedRoute, input.runtimeConfigState);
  const aiCharacterData = useMemo(() => ({
    name: t('Chat.aiAssistantName', { defaultValue: 'AI Assistant' }),
    avatarUrl: null,
    avatarFallback: 'AI',
    handle: routeSummary.detail || null,
    bio: null,
    interactionState: {
      phase: submittingThreadId ? 'thinking' as const : 'idle' as const,
      busy: Boolean(submittingThreadId),
    },
    theme: {
      roomSurface: 'linear-gradient(180deg, rgba(250,252,252,0.98), rgba(244,247,248,0.96))',
      roomAura: 'linear-gradient(135deg,rgba(255,255,255,0.9),rgba(232,245,245,0.78))',
      accentSoft: 'rgba(125,211,252,0.22)',
      accentStrong: '#38bdf8',
      border: 'rgba(56,189,248,0.34)',
      text: '#0c4a6e',
    },
  }), [routeSummary.detail, submittingThreadId, t]);
  const syntheticTarget = useMemo(() => ({
    id: 'ai:assistant',
    source: 'ai' as const,
    canonicalSessionId: activeThreadId || 'ai:assistant',
    title: aiCharacterData.name,
    handle: null,
    bio: aiCharacterData.bio || null,
    avatarUrl: aiCharacterData.avatarUrl || null,
    avatarFallback: aiCharacterData.avatarFallback || 'AI',
    previewText: messages[messages.length - 1]?.text || null,
    updatedAt: selectedThreadRecord ? new Date(selectedThreadRecord.updatedAtMs).toISOString() : null,
    unreadCount: 0,
    status: 'active' as const,
    isOnline: readiness.localReady || readiness.cloudReady,
    metadata: {
      routeLabel: routeSummary.label,
    },
  }), [
    activeThreadId,
    aiCharacterData.avatarFallback,
    aiCharacterData.avatarUrl,
    aiCharacterData.bio,
    aiCharacterData.name,
    messages,
    readiness.cloudReady,
    readiness.localReady,
    routeSummary.label,
    selectedThreadRecord,
  ]);
  const aiAssistantName = aiCharacterData.name;
  const canonicalMessages = useMemo(
    () => messages.map((message) => {
      const isUser = message.role === 'user' || message.role === 'human';
      return {
        id: message.id,
        sessionId: activeThreadId || 'ai:assistant',
        targetId: 'ai:assistant',
        source: 'ai' as const,
        role: message.role,
        text: message.text,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        status: message.status,
        error: message.error,
        kind: 'text' as const,
        senderName: isUser ? 'You' : aiAssistantName,
        senderKind: isUser ? ('human' as const) : ('ai' as const),
        metadata: message.metadata,
      };
    }),
    [activeThreadId, aiAssistantName, messages],
  );
  const reasoningLabel = t('Chat.reasoningLabel', { defaultValue: 'Thought process' });
  const renderMessageContent = useMemo(
    () => createReasoningMessageContentRenderer(reasoningLabel),
    [reasoningLabel],
  );
  const footerContent = useMemo<ReactNode>(() => {
    if (!activeThreadId) {
      return null;
    }
    return (
      <RuntimeStreamFooter
        chatId={activeThreadId}
        assistantName={aiCharacterData.name}
        assistantAvatarUrl={aiCharacterData.avatarUrl || null}
        assistantKind="agent"
        streamState={streamState}
        stopLabel={t('ChatTimeline.stopGenerating', 'Stop generating')}
        interruptedLabel={t('ChatTimeline.streamInterrupted', 'Response interrupted')}
        reasoningLabel={reasoningLabel}
      />
    );
  }, [activeThreadId, aiCharacterData.avatarUrl, aiCharacterData.name, reasoningLabel, streamState, t]);
  const pendingFirstBeat = Boolean(
    streamState
    && streamState.phase === 'waiting'
    && !streamState.partialText
    && !streamState.partialReasoningText,
  );
  const host = useAiConversationPresentation({
    activeThreadId,
    aiCharacterData,
    availableResolvedRoutes,
    bundle,
    bundleError: bundleQuery.error,
    canonicalMessages,
    composerReady,
    currentDraftTextRef,
    currentResolvedRoute,
    footerContent,
    handleArchiveThread,
    handleCreateThread,
    handleRenameThread,
    handleRouteSelection,
    handleSelectThread,
    handleSubmit,
    hostFeedback,
    isBundleLoading,
    messages,
    onDismissHostFeedback: () => setHostFeedback(null),
    pendingFirstBeat,
    readiness: {
      cloudReady: readiness.cloudReady,
      localReady: readiness.localReady,
      setupState: readiness.setupState,
    },
    renderMessageContent,
    routeSummary,
    runtimeConfigState: input.runtimeConfigState,
    setChatThinkingPreference,
    submittingThreadId,
    syntheticTarget,
    t,
    thinkingPreference: chatThinkingPreference,
    thinkingSupported: thinkingSupport.supported,
    thinkingUnsupportedReason,
    threads,
  });

  return { host, readiness };
}
