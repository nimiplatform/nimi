import { ChatStreamStatus } from '@nimiplatform/kit/features/chat/components/chat-stream-status';
import { useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { homeChatHandoff } from '../../../shared/chat-ai-handoff.js';
import { saveHomeChatHandoff } from './chat-nimi-handoff.js';
import { nimiComposerDraftRef, nimiComposerMemory } from './chat-nimi-composer-draft.js';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../app-shell/providers/app-store';
import type { ChatAiMessageRecord, ChatAiThreadRecord } from '../../bridge/runtime-bridge/types';
import { chatAiStoreClient } from '../../bridge/runtime-bridge/chat-ai-store';
import { useTranslation } from 'react-i18next';
import {
  hasAiConversationThread,
  resolveAiConversationActiveThreadId,
  toConversationMessageViewModel,
} from './chat-nimi-thread-model';
import type { NimiConversationSelection } from './chat-shell-types';
import {
  createReasoningMessageContentRenderer,
} from './chat-shared-runtime-stream-ui';
import {
  getChatThinkingUnsupportedCopy,
} from './chat-shared-thinking';
import { type InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import { createNimiClientId } from '@nimiplatform/sdk';
import { AI_NEW_CONVERSATION_TITLE } from './chat-nimi-thread-model';
import {
  bundleQueryKey,
  chatAiThreadBundleQueryOptions,
  createEmptyBundle,
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
  desktopNimiTextIntentUsesChatGPTPlan,
  findDesktopNimiTextIntent,
  resolveDesktopNimiChatSetupState,
  useDesktopNimiAppAIConfig,
} from './chat-nimi-app-ai-config.js';
import { runDesktopNimiTextCapability } from './chat-nimi-shell-runtime-adapter.js';
import { toChatUserFacingRuntimeError } from './chat-runtime-error-message.js';
import { chatGPTPlanManageUsageFeedbackAction } from './chat-chatgpt-plan-feedback.js';

type UseAiConversationModeHostInput = {
  selection: NimiConversationSelection;
  lastSelectedThreadId: string | null;
  setSelection: (selection: NimiConversationSelection) => void;
};

export function useAiConversationModeHost(
  input: UseAiConversationModeHostInput,
) {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const queryClient = useQueryClient();
  const chatThinkingPreference = useAppStore((state) => state.chatThinkingPreference);
  const setChatThinkingPreference = useAppStore((state) => state.setChatThinkingPreference);
  const authUser = useAppStore((state) => state.auth.user);
  const userDisplayName = authUser && (authUser.displayName || authUser.handle)
    ? String(authUser.displayName || authUser.handle)
    : null;
  const appAIConfig = useDesktopNimiAppAIConfig(DESKTOP_NIMI_APP_ID);
  const textIntent = findDesktopNimiTextIntent(appAIConfig.data?.config);
  const textRouteUsesChatGPTPlan = desktopNimiTextIntentUsesChatGPTPlan(textIntent);
  const [hostFeedback, setHostFeedback] = useState<InlineFeedbackState | null>(null);
  const navigation = useHomeNavigation();
  const composerMemory = nimiComposerMemory(navigation);
  const { pending, ephemeralThread } = useSyncExternalStore(composerMemory.subscribe, composerMemory.getSnapshot);
  const submittingThreadId = pending?.threadId ?? null;
  const setEphemeralThread = composerMemory.setEphemeralThread;

  const reportHostError = useCallback((error: unknown) => {
    const userFacing = toChatUserFacingRuntimeError(
      error,
      t('Chat.nimiExecutionFailed', { defaultValue: 'Nimi Chat could not complete this request.' }),
      t,
      { chatGPTPlanRoute: textRouteUsesChatGPTPlan },
    );
    setHostFeedback({
      kind: 'error',
      message: userFacing.message,
      technicalDetail: error instanceof Error ? error.message : String(error || ''),
      ...(userFacing.chatGPTPlanUsageLimited ? chatGPTPlanManageUsageFeedbackAction(t) : {}),
    });
  }, [t, textRouteUsesChatGPTPlan]);

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
      pendingThreadId: pending?.threadId,
    }),
    [input.lastSelectedThreadId, input.selection.threadId, pending?.threadId, threads],
  );

  const selectedThreadRecord = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) || null,
    [activeThreadId, threads],
  );

  const setupState = useMemo(() => resolveDesktopNimiChatSetupState({
    isPending: appAIConfig.isPending,
    isError: appAIConfig.isError,
    hasTextIntent: Boolean(textIntent),
  }), [appAIConfig.isPending, appAIConfig.isError, textIntent]);

  const thinkingSupport = useMemo(() => ({
    supported: false,
    reason: 'thinking_unsupported' as const,
  }), []);
  const thinkingUnsupportedReason = useMemo(() => {
    if (thinkingSupport.supported || !thinkingSupport.reason) {
      return null;
    }
    const copy = getChatThinkingUnsupportedCopy();
    return t(copy.key, { defaultValue: copy.defaultValue });
  }, [t, thinkingSupport]);

  const bundleOptions = chatAiThreadBundleQueryOptions(
    activeThreadId, ephemeralThread?.id ?? null, (id) => chatAiStoreClient.getThreadBundle(id),
  );
  const bundleQuery = useQuery({
    ...bundleOptions,
    enabled: bundleOptions.enabled && pending?.threadId !== activeThreadId,
  });

  const bundle = bundleQuery.data || null;
  const generation = navigation.getSnapshot().generation;
  const currentDraftTextRef = useMemo(() => nimiComposerDraftRef(navigation, activeThreadId, bundle?.draft?.text ?? ''),
    [navigation, generation, activeThreadId, bundle?.draft?.text]);
  const messages = useMemo(
    () => (bundle?.messages || [])
      .map((message: ChatAiMessageRecord) => toConversationMessageViewModel(message))
      .filter((message) => !isEmptyPendingAssistantMessage(message)),
    [bundle?.messages],
  );

  const isBundleLoading = Boolean(activeThreadId) && bundleQuery.isPending && !bundle;
  const composerReady = setupState.status === 'ready' && !isBundleLoading;
  const executeTextCapability = useCallback((text: string, history: ChatAiMessageRecord[], signal: AbortSignal, onText: (text: string) => void) => runDesktopNimiTextCapability({
    client: bindings.sdk.appProduct(),
    prompt: text,
    history,
    signal,
    onText,
  }), [bindings.sdk]);

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
    if (!input.selection.threadId && activeThreadId && (selectedThreadRecord || activeThreadId === pending?.threadId)) {
      syncSelectionToThread(activeThreadId);
    }
  }, [
    activeThreadId,
    input.selection.threadId,
    selectedThreadRecord,
    pending?.threadId,
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
    clearHostError: () => setHostFeedback(null),
    now: bindings.clock.now,
    queryClient,
    reportHostError,
    selectedThreadRecord,
    setBundleCache,
    setEphemeralThread,
    composerMemory,
    navigation,
    reportExpiredSave: () => setHostFeedback({ kind: 'warning', message: t('Chat.nimiSaveScopeEnded') }),
    reportTruncation: () => setHostFeedback({ kind: 'warning', message: t('Chat.nimiResponseTruncated') }),
    syncSelectionToThread,
    threads,
  });

  // Home hands over typed text: open a fresh ephemeral thread whose draft is
  // that text. Nothing is persisted until the person actually sends.
  const pendingNimiPrefill = useAppStore((state) => state.pendingNimiComposerPrefill);
  const clearPendingNimiPrefill = useAppStore((state) => state.clearPendingNimiComposerPrefill);
  useEffect(() => {
    if (!pendingNimiPrefill || submittingThreadId) return;
    const timestampMs = bindings.clock.now();
    const thread: ChatAiThreadRecord = {
      id: createNimiClientId('ai-thread'),
      title: AI_NEW_CONVERSATION_TITLE,
      createdAtMs: timestampMs,
      updatedAtMs: timestampMs,
      lastMessageAtMs: null,
    };
    setEphemeralThread(thread);
    queryClient.setQueryData(bundleQueryKey(thread.id), {
      ...createEmptyBundle(thread),
      draft: { threadId: thread.id, text: pendingNimiPrefill.text, attachments: [], updatedAtMs: timestampMs },
    });
    syncSelectionToThread(thread.id);
    clearPendingNimiPrefill(pendingNimiPrefill.requestId);
  }, [bindings.clock, clearPendingNimiPrefill, pendingNimiPrefill, queryClient, submittingThreadId, syncSelectionToThread]);

  const intentSummary = useMemo(() => ({
    label: textIntent?.route.oneofKind === 'local'
      ? t('Chat.settingsIntentLocal', { defaultValue: 'Local AI' })
      : textIntent?.route.oneofKind === 'cloud'
        ? t('Chat.settingsIntentCloud', { defaultValue: 'Cloud AI' })
        : t('Chat.settingsCapabilityNeedsSetup', { defaultValue: 'Needs setup' }),
  }), [t, textIntent]);

  const aiCharacterData = useMemo(() => ({
    name: t('Chat.nimiAssistantName', { defaultValue: 'Nimi' }),
    avatarUrl: null,
    avatarFallback: 'AI',
    handle: null,
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
  }), [submittingThreadId, t]);

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
  const visibleTurn = activeThreadId && pending?.threadId === activeThreadId ? pending : null;
  const pendingFirstBeat = visibleTurn?.phase === 'generating' && !visibleTurn.text;
  const footerContent = visibleTurn?.text ? (
    <ChatStreamStatus
      mode="streaming"
      partialText={visibleTurn.text}
      actions={visibleTurn.stop ? (
        <button type="button" className="block mt-2 underline" onClick={visibleTurn.stop}>{t('Chat.stopGenerating')}</button>
      ) : undefined}
      reasoningText=""
      reasoningLabel={reasoningLabel}
    />
  ) : null;

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
    hostFeedback: pending?.retrySave ? {
      kind: 'warning',
      message: t('Chat.nimiSaveUnconfirmed'),
      actionLabel: t('Chat.nimiConfirmSave'),
      onAction: pending.retrySave,
    } : pending?.phase === 'saving' ? { kind: 'info', message: t('Chat.nimiSavingReply') } : hostFeedback,
    isBundleLoading,
    messages,
    onDismissHostFeedback: () => setHostFeedback(null),
    pendingFirstBeat,
    onStopGenerating: visibleTurn?.stop,
    renderMessageContent,
    setChatThinkingPreference,
    setupPending: appAIConfig.isPending,
    setupState,
    submittingThreadId,
    syntheticTarget,
    t,
    thinkingPreference: chatThinkingPreference,
    thinkingSupported: thinkingSupport.supported,
    thinkingUnsupportedReason,
    threads,
    userDisplayName,
  });

  const saveForHarness = bundle && bundle.thread.id === activeThreadId && !visibleTurn && !bundleQuery.isError && !threadsQuery.isError ? () => {
    if (navigation.getSnapshot().generation !== generation || composerMemory.getSnapshot().pending?.threadId === activeThreadId) return false;
    const copy = homeChatHandoff(bundle, currentDraftTextRef.current);
    if (!copy) return false;
    return saveHomeChatHandoff(copy);
  } : undefined;
  const historyError = threadsQuery.isError
    ? t(threadsQuery.error instanceof Error && threadsQuery.error.message.includes('CHAT_AI_SCHEMA_MISMATCH')
      ? 'Chat.historyVersionMismatch' : 'Chat.historyReadFailed')
    : null;
  return { host, saveForHarness, historyError, loadingHistory: threadsQuery.isPending,
    retryHistory: () => { void threadsQuery.refetch(); } };
}
