import {
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
  useRef,
  useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../app-shell/providers/app-store';
import type { ChatAiMessageRecord, ChatAiThreadRecord } from '../../bridge/runtime-bridge/types';
import { chatAiStoreClient } from '../../bridge/runtime-bridge/chat-ai-store';
import { useTranslation } from 'react-i18next';
import type { DesktopConversationModeHost } from './chat-shared-mode-host-types';
import {
  hasAiConversationThread,
  resolveAiConversationActiveThreadId,
  toConversationMessageViewModel,
} from './chat-nimi-thread-model';
import type { NimiConversationSelection } from './chat-shell-types';
import {
  createReasoningMessageContentRenderer,
  RuntimeStreamFooter,
  useConversationStreamState,
} from './chat-shared-runtime-stream-ui';
import {
  getChatThinkingUnsupportedCopy,
} from './chat-shared-thinking';
import { type InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import {
  bundleQueryKey,
  isEmptyPendingAssistantMessage,
  sortThreadSummaries,
  THREADS_QUERY_KEY,
} from './chat-nimi-shell-core';
import { useAiConversationPresentation } from './chat-nimi-shell-presentation';
import { useAiConversationEffects } from './chat-nimi-shell-effects';
import { useAiConversationHostActions } from './chat-nimi-shell-host-actions';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import {
  DESKTOP_NIMI_APP_ID,
  findDesktopNimiTextIntent,
  useDesktopNimiAppAIConfig,
} from './chat-nimi-app-ai-config.js';
import { runDesktopNimiTextCapability } from './chat-nimi-shell-runtime-adapter.js';
import { toChatUserFacingRuntimeError } from './chat-runtime-error-message.js';
import { projectNimiCloudConnectorGrantError } from '@nimiplatform/sdk/runtime';

type UseAiConversationModeHostInput = {
  selection: NimiConversationSelection;
  lastSelectedThreadId: string | null;
  setSelection: (selection: NimiConversationSelection) => void;
};

export function useAiConversationModeHost(
  input: UseAiConversationModeHostInput,
): { host: DesktopConversationModeHost } {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const queryClient = useQueryClient();
  const chatThinkingPreference = useAppStore((state) => state.chatThinkingPreference);
  const setChatThinkingPreference = useAppStore((state) => state.setChatThinkingPreference);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const authUserId = useAppStore((state) => String(state.auth.user?.id || '').trim());
  const appAIConfig = useDesktopNimiAppAIConfig();
  const textIntent = findDesktopNimiTextIntent(appAIConfig.data);
  const [submittingThreadId, setSubmittingThreadId] = useState<string | null>(null);
  const [hostFeedback, setHostFeedback] = useState<InlineFeedbackState | null>(null);
  const [ephemeralThread, setEphemeralThread] = useState<ChatAiThreadRecord | null>(null);
  const currentDraftTextRef = useRef('');

  const reportHostError = useCallback((error: unknown) => {
    const userFacing = toChatUserFacingRuntimeError(
      error,
      t('Chat.nimiExecutionFailed', { defaultValue: 'Nimi Chat could not complete this request.' }),
      t,
    );
    const grantFailure = projectNimiCloudConnectorGrantError(error);
    setHostFeedback({
      kind: grantFailure?.tone === 'info'
        ? 'info'
        : grantFailure?.tone === 'warning'
          ? 'warning'
          : 'error',
      message: userFacing.message,
      technicalDetail: error instanceof Error ? error.message : String(error || ''),
      ...(grantFailure ? {
        actionLabel: t('Chat.settingsOpenCloudAuthorization', {
          defaultValue: 'Open account authorization settings',
        }),
        onAction: () => {
          setActiveTab('runtime');
          bindings.app.commands.runtimeConfigNavigation.openPage('cloud');
        },
      } : {}),
    });
  }, [bindings.app.commands.runtimeConfigNavigation, setActiveTab, t]);

  const setSelection = useCallback((selection: NimiConversationSelection) => {
    if (input.selection.threadId === selection.threadId) {
      return;
    }
    input.setSelection(selection);
  }, [input]);

  const threadsQuery = useQuery({
    queryKey: THREADS_QUERY_KEY,
    queryFn: () => chatAiStoreClient.listThreads(),
  });

  const threads = useMemo(() => {
    const dbThreads = sortThreadSummaries(threadsQuery.data || []);
    if (ephemeralThread && !dbThreads.some((t) => t.id === ephemeralThread.id)) {
      return [ephemeralThread, ...dbThreads];
    }
    return dbThreads;
  }, [threadsQuery.data, ephemeralThread]);

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

  const setupState = useMemo(() => {
    if (!textIntent) {
      return {
        mode: 'ai' as const,
        status: 'setup-required' as const,
        issues: [{
          code: 'ai-capability-intent-required' as const,
          detail: appAIConfig.isPending
            ? 'Loading Nimi Desktop AI configuration.'
            : 'Choose Local or Cloud capability intent for Nimi Chat.',
        }],
        primaryAction: null,
      };
    }
    return {
      mode: 'ai' as const,
      status: 'ready' as const,
      issues: [],
      primaryAction: null,
    };
  }, [appAIConfig.isPending, textIntent]);

  const thinkingSupport = useMemo(() => ({
    supported: false,
    reason: 'thinking_unsupported' as const,
  }), []);
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

  const isBundleLoading = Boolean(activeThreadId) && bundleQuery.isPending && !bundle;
  const composerReady = setupState.status === 'ready' && !isBundleLoading;
  const executeTextCapability = useCallback((text: string) => runDesktopNimiTextCapability({
    runtime: { ai: bindings.sdk.machineProduct().ai },
    appId: DESKTOP_NIMI_APP_ID,
    prompt: text,
    subjectUserId: authUserId || undefined,
  }), [authUserId, bindings.sdk]);

  const {
    setBundleCache,
    syncSelectionToThread,
  } = useAiConversationEffects({
    queryClient,
    setSelection,
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
    handleCreateThread,
    handleSelectThread,
    handleSubmit,
  } = useAiConversationHostActions({
    activeThreadId,
    currentDraftTextRef,
    ephemeralThread,
    executeTextCapability,
    now: bindings.clock.now,
    queryClient,
    reportHostError,
    selectedThreadRecord,
    setBundleCache,
    setEphemeralThread,
    setSubmittingThreadId,
    submittingThreadId,
    syncSelectionToThread,
    threads,
  });

  const intentSummary = useMemo(() => ({
    label: textIntent?.route.oneofKind === 'local'
      ? t('Chat.settingsIntentLocal', { defaultValue: 'Local AI' })
      : textIntent?.route.oneofKind === 'cloud'
        ? t('Chat.settingsIntentCloud', { defaultValue: 'Cloud AI' })
        : t('Chat.settingsCapabilityNeedsSetup', { defaultValue: 'Needs setup' }),
    detail: textIntent
      ? t('Chat.settingsRuntimeResolvesOnSubmit', {
        defaultValue: 'Runtime resolves implementation and reports typed execution errors on submit.',
      })
      : null,
  }), [t, textIntent]);

  const aiCharacterData = useMemo(() => ({
    name: t('Chat.nimiAssistantName', { defaultValue: 'Nimi' }),
    avatarUrl: null,
    avatarFallback: 'AI',
    handle: intentSummary.detail || null,
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
  }), [intentSummary.detail, submittingThreadId, t]);

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
    isOnline: Boolean(textIntent),
    metadata: {
      intentLabel: intentSummary.label,
    },
  }), [
    activeThreadId,
    aiCharacterData.avatarFallback,
    aiCharacterData.avatarUrl,
    aiCharacterData.bio,
    aiCharacterData.name,
    intentSummary.label,
    messages,
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
    const optimisticWaiting = submittingThreadId === activeThreadId
      && (!streamState || streamState.phase === 'idle');
    return (
      <RuntimeStreamFooter
        chatId={activeThreadId}
        assistantName={aiCharacterData.name}
        assistantAvatarUrl={aiCharacterData.avatarUrl || null}
        assistantKind="agent"
        streamState={streamState}
        optimisticWaiting={optimisticWaiting}
        stopLabel={t('ChatTimeline.stopGenerating', 'Stop generating')}
        interruptedLabel={t('ChatTimeline.streamInterrupted', 'Response interrupted')}
        reasoningLabel={reasoningLabel}
        waitingLabel={t('Chat.nimiSending', {
          defaultValue: 'Generating response...',
        })}
      />
    );
  }, [activeThreadId, aiCharacterData.avatarUrl, aiCharacterData.name, reasoningLabel, streamState, submittingThreadId, t]);

  const pendingFirstBeat = Boolean(
    (
      streamState
      && streamState.phase === 'waiting'
      && !streamState.partialText
      && !streamState.partialReasoningText
    )
    || (
      submittingThreadId === activeThreadId
      && (!streamState || streamState.phase === 'idle')
    ),
  );

  const host = useAiConversationPresentation({
    activeThreadId,
    aiCharacterData,
    bundle,
    bundleError: bundleQuery.error,
    canonicalMessages,
    composerReady,
    currentDraftTextRef,
    footerContent,
    handleCreateThread,
    handleSelectThread,
    handleSubmit,
    hostFeedback,
    isBundleLoading,
    messages,
    onDismissHostFeedback: () => setHostFeedback(null),
    pendingFirstBeat,
    renderMessageContent,
    intentSummary,
    setChatThinkingPreference,
    setupState,
    submittingThreadId,
    syntheticTarget,
    t,
    thinkingPreference: chatThinkingPreference,
    thinkingSupported: thinkingSupport.supported,
    thinkingUnsupportedReason,
    threads,
  });

  return { host };
}
