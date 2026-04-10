import {
  useCallback,
  useEffect,
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
import { createAgentLocalChatConversationProvider } from './chat-agent-orchestration';
import type { AgentConversationSelection } from './chat-shell-types';
import {
  RuntimeImageMessageContent,
  createReasoningMessageContentRenderer,
  useConversationStreamState,
} from './chat-runtime-stream-ui';
import {
  getChatThinkingUnsupportedCopy,
  resolveAgentThinkingSupportFromProjection,
} from './chat-thinking';
import {
  loadStoredAgentChatExperienceSettings,
  persistStoredAgentChatExperienceSettings,
  type AgentChatExperienceSettings,
} from './chat-settings-storage';
import { resolveAgentChatBehavior } from './chat-agent-behavior-resolver';
import { type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import {
  bundleQueryKey,
  upsertBundleDraft,
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
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import type { RouteModelPickerSelection } from '@nimiplatform/nimi-kit/features/model-picker';
import {
  createAISnapshot,
  toRuntimeRouteBindingFromPickerSelection,
} from './conversation-capability';
import { parseAgentChatVoiceWorkflowMetadata } from './chat-agent-voice-workflow';
import { reconcileAgentChatVoiceWorkflowMessage } from './chat-agent-voice-workflow-tracker';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service';
import { logRendererEvent } from '@renderer/bridge/runtime-bridge/logging';
import { cancelStream } from '../turns/stream-controller';
import {
  transcribeChatAgentVoiceRuntime,
  toChatAgentRuntimeError,
} from './chat-agent-runtime';
import { startAgentVoiceCaptureSession, type AgentVoiceCaptureSession } from './chat-agent-voice-capture';
import {
  createInitialAgentVoiceSessionShellState,
  type AgentVoiceSessionMode,
  resolveIdleAgentVoiceSessionShellState,
  type AgentVoiceSessionShellState,
} from './chat-agent-voice-session';
import type { PendingAttachment } from '../turns/turn-input-attachments';
import { clearPendingAttachments } from '../turns/turn-input-attachments';

function resolveIsVoiceSessionForeground(): boolean {
  if (typeof document === 'undefined') {
    return true;
  }
  const visible = document.visibilityState !== 'hidden';
  const focused = typeof document.hasFocus === 'function'
    ? document.hasFocus()
    : true;
  return visible && focused;
}

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
  const agentAdapterAiConfig = useAppStore((state) => state.aiConfig);
  const textCapabilityProjection = useAppStore(
    (state) => state.conversationCapabilityProjectionByCapability['text.generate'] || null,
  );
  const imageCapabilityProjection = useAppStore(
    (state) => state.conversationCapabilityProjectionByCapability['image.generate'] || null,
  );
  const voiceCapabilityProjection = useAppStore(
    (state) => state.conversationCapabilityProjectionByCapability['audio.synthesize'] || null,
  );
  const transcribeCapabilityProjection = useAppStore(
    (state) => state.conversationCapabilityProjectionByCapability['audio.transcribe'] || null,
  );
  const [submittingThreadId, setSubmittingThreadId] = useState<string | null>(null);
  const [hostFeedback, setHostFeedback] = useState<InlineFeedbackState | null>(null);
  const [behaviorSettings, setBehaviorSettingsState] = useState<AgentChatExperienceSettings>(
    () => loadStoredAgentChatExperienceSettings(),
  );
  const schedulingJudgement = useSchedulingFeasibility();
  const [footerHostStateByThreadId, setFooterHostStateByThreadId] = useState<
    Record<string, {
      footerState: AgentHostFlowFooterState;
      lifecycle: AgentTurnLifecycleState;
    }>
  >({});
  const [voiceSessionState, setVoiceSessionState] = useState<AgentVoiceSessionShellState>(
    () => createInitialAgentVoiceSessionShellState(),
  );
  const [pendingAttachmentsByThreadId, setPendingAttachmentsByThreadId] = useState<Record<string, readonly PendingAttachment[]>>({});
  const [isVoiceSessionForeground, setIsVoiceSessionForeground] = useState<boolean>(
    () => resolveIsVoiceSessionForeground(),
  );
  const currentDraftTextRef = useRef('');
  const pendingAttachmentsByThreadRef = useRef<Record<string, readonly PendingAttachment[]>>({});
  const latestVoiceCaptureByThreadRef = useRef<Record<string, {
    bytes: Uint8Array;
    mimeType: string;
    transcriptText: string;
  } | undefined>>({});
  const voiceCaptureSessionRef = useRef<AgentVoiceCaptureSession | null>(null);
  const voiceTranscribeAbortRef = useRef<AbortController | null>(null);
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
    const message = toErrorMessage(error);
    logRendererEvent({
      level: 'error',
      area: 'agent-chat-shell',
      message: 'action:host-error',
      details: {
        error: message,
      },
    });
    setHostFeedback({
      kind: 'error',
      message,
    });
  }, []);
  const thinkingSupport = useMemo(
    () => resolveAgentThinkingSupportFromProjection(textCapabilityProjection),
    [textCapabilityProjection],
  );
  const setBehaviorSettings = useCallback((nextSettings: AgentChatExperienceSettings) => {
    persistStoredAgentChatExperienceSettings(nextSettings);
    setBehaviorSettingsState(nextSettings);
  }, []);
  useEffect(() => {
    pendingAttachmentsByThreadRef.current = pendingAttachmentsByThreadId;
  }, [pendingAttachmentsByThreadId]);
  useEffect(() => () => {
    for (const attachments of Object.values(pendingAttachmentsByThreadRef.current)) {
      clearPendingAttachments([...attachments], (url) => URL.revokeObjectURL(url));
    }
  }, []);
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

  useEffect(() => {
    const resetVoiceSession = () => {
      voiceTranscribeAbortRef.current?.abort();
      voiceTranscribeAbortRef.current = null;
      voiceCaptureSessionRef.current?.cancel();
      voiceCaptureSessionRef.current = null;
      setVoiceSessionState(createInitialAgentVoiceSessionShellState());
    };
    resetVoiceSession();
    return resetVoiceSession;
  }, [input.selection.agentId, input.selection.threadId]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }
    const syncForegroundState = () => {
      setIsVoiceSessionForeground(resolveIsVoiceSessionForeground());
    };
    syncForegroundState();
    document.addEventListener('visibilitychange', syncForegroundState);
    window.addEventListener('focus', syncForegroundState);
    window.addEventListener('blur', syncForegroundState);
    return () => {
      document.removeEventListener('visibilitychange', syncForegroundState);
      window.removeEventListener('focus', syncForegroundState);
      window.removeEventListener('blur', syncForegroundState);
    };
  }, []);

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
    bootstrapReady,
    textCapabilityProjection,
    imageCapabilityProjection,
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
    if (!bootstrapReady) {
      return createReadyConversationSetupState('agent');
    }
    return createReadyConversationSetupState('agent');
  }, [bootstrapReady, input.authStatus]);

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
    aiConfig: agentAiConfig,
    applyDriverEffects,
    bundle,
    currentDraftTextRef,
    draftText: bundle?.draft?.text,
    draftUpdatedAtMs: bundle?.draft?.updatedAtMs,
    latestVoiceCaptureByThreadRef,
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
          agentResolution: turnInput.agentResolution,
          textExecutionSnapshot: turnInput.textExecutionSnapshot,
          imageExecutionSnapshot: turnInput.imageExecutionSnapshot,
          voiceExecutionSnapshot: turnInput.voiceExecutionSnapshot,
          voiceWorkflowExecutionSnapshotByCapability: turnInput.voiceWorkflowExecutionSnapshotByCapability,
          latestVoiceCapture: turnInput.latestVoiceCapture,
          imageCapabilityParams: (
            agentAiConfig.capabilities.selectedParams['image.generate'] || null
          ) as Record<string, unknown> | null,
          runtimeConfigState: input.runtimeConfigState,
          runtimeFields: input.runtimeFields,
          reasoningPreference: behaviorSettings.thinkingPreference,
          resolvedBehavior: resolveAgentChatBehavior({
            userText: turnInput.userMessage.text,
            settings: behaviorSettings,
          }),
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
  const renderReasoningMessageContent = useMemo(
    () => createReasoningMessageContentRenderer(reasoningLabel),
    [reasoningLabel],
  );
  const renderMessageContent = useMemo(() => (
    (
      message: Parameters<NonNullable<typeof renderReasoningMessageContent>>[0],
      context: Parameters<NonNullable<typeof renderReasoningMessageContent>>[1],
    ) => {
      if (message.kind === 'image' || message.kind === 'image-pending') {
        return (
          <RuntimeImageMessageContent
            message={message}
            imageLabel={t('ChatTimeline.imageMessage', 'Image')}
            showCaptionLabel={t('ChatTimeline.showImagePrompt', 'Show prompt')}
            hideCaptionLabel={t('ChatTimeline.hideImagePrompt', 'Hide prompt')}
          />
        );
      }
      return renderReasoningMessageContent(message, context);
    }
  ), [renderReasoningMessageContent, t]);
  const currentFooterHostState = activeThreadId ? footerHostStateByThreadId[activeThreadId] || null : null;
  const activePendingAttachments = activeThreadId
    ? (pendingAttachmentsByThreadId[activeThreadId] || [])
    : [];
  const setPendingAttachmentsForThread = useCallback((threadId: string | null, nextAttachments: readonly PendingAttachment[]) => {
    const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : '';
    if (!normalizedThreadId) {
      return;
    }
    setPendingAttachmentsByThreadId((current) => {
      const existing = current[normalizedThreadId] || [];
      const nextUrlSet = new Set(nextAttachments.map((attachment) => attachment.previewUrl));
      for (const attachment of existing) {
        if (!nextUrlSet.has(attachment.previewUrl)) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      }
      if (nextAttachments.length === 0) {
        if (!(normalizedThreadId in current)) {
          return current;
        }
        const { [normalizedThreadId]: _removed, ...rest } = current;
        return rest;
      }
      return {
        ...current,
        [normalizedThreadId]: [...nextAttachments],
      };
    });
  }, []);
  const persistVoiceTranscriptDraft = useCallback(async (text: string) => {
    if (!activeThreadId) {
      throw new Error('Voice input is unavailable because no active thread is selected.');
    }
    const draft = await chatAgentStoreClient.putDraft({
      threadId: activeThreadId,
      text,
      updatedAtMs: Date.now(),
    });
    currentDraftTextRef.current = text;
    setBundleCache(
      activeThreadId,
      (current) => upsertBundleDraft(current, draft) || current,
    );
  }, [activeThreadId, currentDraftTextRef, setBundleCache]);
  useEffect(() => {
    if (!activeThreadId || !bundle?.messages?.length) {
      return undefined;
    }
    const pendingMessages = bundle.messages.filter((message) => {
      const metadata = parseAgentChatVoiceWorkflowMetadata(message.metadataJson);
      return metadata?.workflowStatus === 'submitted'
        || metadata?.workflowStatus === 'queued'
        || metadata?.workflowStatus === 'running';
    });
    if (pendingMessages.length === 0) {
      return undefined;
    }
    const voiceExecutionSnapshot = voiceCapabilityProjection?.supported && voiceCapabilityProjection.resolvedBinding
      ? createAISnapshot({
        config: agentAdapterAiConfig,
        capability: 'audio.synthesize',
        projection: voiceCapabilityProjection,
        agentResolution,
      })
      : null;
    let cancelled = false;
    const timerId = window.setTimeout(() => {
      void (async () => {
        for (const message of pendingMessages) {
          if (cancelled) {
            return;
          }
          const result = await reconcileAgentChatVoiceWorkflowMessage({
            message,
            voiceExecutionSnapshot,
          });
          if (!result.updatedMessage || cancelled) {
            continue;
          }
          setBundleCache(activeThreadId, (current) => {
            if (!current) {
              return current;
            }
            return {
              ...current,
              messages: current.messages.map((item) => (
                item.id === result.updatedMessage?.id
                  ? result.updatedMessage
                  : item
              )),
            };
          });
        }
      })().catch((error) => {
        reportHostError(error);
      });
    }, 2_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [
    activeThreadId,
    agentAdapterAiConfig,
    agentResolution,
    bundle?.messages,
    reportHostError,
    setBundleCache,
    voiceCapabilityProjection,
  ]);
  const resolveVoiceSessionUnavailableMessage = useCallback(() => {
    if (!activeTarget) {
      return t('Chat.voiceSessionTargetRequired', {
        defaultValue: 'Select an agent before starting voice input.',
      });
    }
    if (transcribeCapabilityProjection?.reasonCode === 'selection_missing' || transcribeCapabilityProjection?.reasonCode === 'selection_cleared') {
      return t('Chat.voiceSessionRouteRequired', {
        defaultValue: 'Voice input is unavailable because no transcribe route is configured.',
      });
    }
    if (transcribeCapabilityProjection?.reasonCode === 'route_unhealthy') {
      return t('Chat.voiceSessionRuntimeUnavailable', {
        defaultValue: 'Voice input is unavailable because the transcribe runtime is not ready.',
      });
    }
    if (transcribeCapabilityProjection?.reasonCode === 'metadata_missing' || transcribeCapabilityProjection?.reasonCode === 'binding_unresolved') {
      return t('Chat.voiceSessionRouteUnavailable', {
        defaultValue: 'Voice input is unavailable because the selected transcribe route cannot be resolved.',
      });
    }
    if (!transcribeCapabilityProjection?.supported || !transcribeCapabilityProjection?.resolvedBinding) {
      return t('Chat.voiceSessionUnavailable', {
        defaultValue: 'Voice input is unavailable for the current conversation.',
      });
    }
    return null;
  }, [activeTarget, t, transcribeCapabilityProjection]);
  const resetVoiceSessionToPushToTalk = useCallback(() => {
    voiceTranscribeAbortRef.current?.abort();
    voiceTranscribeAbortRef.current = null;
    voiceCaptureSessionRef.current?.cancel();
    voiceCaptureSessionRef.current = null;
    setVoiceSessionState(createInitialAgentVoiceSessionShellState());
  }, []);
  const beginVoiceCapture = useCallback(async (input: {
    mode: AgentVoiceSessionMode;
    interruptActiveStream?: boolean;
    degradeToPushToTalkOnFailure?: boolean;
    failureDefaultMessage: string;
  }) => {
    try {
      if (input.interruptActiveStream !== false && activeThreadId) {
        cancelStream(activeThreadId);
      }
      const captureSession = await startAgentVoiceCaptureSession(
        input.mode === 'hands-free'
          ? {
            autoStopMode: 'silence',
          }
          : undefined,
      );
      voiceCaptureSessionRef.current = captureSession;
      setVoiceSessionState({
        status: 'listening',
        mode: input.mode,
        message: null,
      });
      return true;
    } catch (error) {
      const message = toErrorMessage(error, input.failureDefaultMessage);
      reportHostError(new Error(message, { cause: error }));
      setVoiceSessionState(
        input.degradeToPushToTalkOnFailure
          ? {
            status: 'failed',
            mode: 'push-to-talk',
            message,
          }
          : {
            status: 'failed',
            mode: input.mode,
            message,
          },
      );
      return false;
    }
  }, [activeThreadId, reportHostError]);

  useEffect(() => {
    if (voiceSessionState.mode !== 'hands-free' || isVoiceSessionForeground) {
      return;
    }
    resetVoiceSessionToPushToTalk();
  }, [isVoiceSessionForeground, resetVoiceSessionToPushToTalk, voiceSessionState.mode]);

  const handleVoiceSessionToggle = useCallback(() => {
    void (async () => {
      if (voiceSessionState.status === 'transcribing') {
        return;
      }
      if (voiceSessionState.status === 'listening') {
        const captureSession = voiceCaptureSessionRef.current;
        if (!captureSession) {
          setVoiceSessionState(resolveIdleAgentVoiceSessionShellState(voiceSessionState.mode));
          return;
        }
        voiceCaptureSessionRef.current = null;
        const activeMode = voiceSessionState.mode;
        setVoiceSessionState({
          status: 'transcribing',
          mode: activeMode,
          message: null,
        });
        const abortController = new AbortController();
        voiceTranscribeAbortRef.current = abortController;
        try {
          const recording = await captureSession.stop();
          const transcribeExecutionSnapshot = transcribeCapabilityProjection
            ? createAISnapshot({
              config: agentAdapterAiConfig,
              capability: 'audio.transcribe',
              projection: transcribeCapabilityProjection,
              agentResolution,
            })
            : null;
          const result = await transcribeChatAgentVoiceRuntime({
            audioBytes: recording.bytes,
            mimeType: recording.mimeType,
            transcribeExecutionSnapshot,
            signal: abortController.signal,
          });
          if (activeThreadId) {
            latestVoiceCaptureByThreadRef.current[activeThreadId] = {
              bytes: recording.bytes,
              mimeType: recording.mimeType,
              transcriptText: result.text,
            };
          }
          await persistVoiceTranscriptDraft(result.text);
          if (activeMode === 'hands-free' && isVoiceSessionForeground) {
            const continued = await beginVoiceCapture({
              mode: 'hands-free',
              interruptActiveStream: false,
              degradeToPushToTalkOnFailure: true,
              failureDefaultMessage: 'Hands-free is unavailable for the current conversation.',
            });
            if (continued) {
              return;
            }
          }
          setVoiceSessionState(resolveIdleAgentVoiceSessionShellState(activeMode));
        } catch (error) {
          if ((error as Error | null)?.name === 'AbortError') {
            setVoiceSessionState(resolveIdleAgentVoiceSessionShellState(activeMode));
            return;
          }
          const runtimeError = toChatAgentRuntimeError(error);
          reportHostError(new Error(runtimeError.message, { cause: error }));
          setVoiceSessionState({
            status: 'failed',
            mode: activeMode,
            message: runtimeError.message,
          });
        } finally {
          if (voiceTranscribeAbortRef.current === abortController) {
            voiceTranscribeAbortRef.current = null;
          }
        }
        return;
      }
      if (voiceSessionState.status === 'failed') {
        setVoiceSessionState(resolveIdleAgentVoiceSessionShellState(voiceSessionState.mode));
        return;
      }
      const unavailableMessage = resolveVoiceSessionUnavailableMessage();
      if (unavailableMessage) {
        setVoiceSessionState({
          status: 'failed',
          mode: voiceSessionState.mode,
          message: unavailableMessage,
        });
        return;
      }
      await beginVoiceCapture({
        mode: voiceSessionState.mode,
        failureDefaultMessage: 'Voice input is unavailable for the current conversation.',
      });
    })();
  }, [
    agentAdapterAiConfig,
    agentResolution,
    beginVoiceCapture,
    isVoiceSessionForeground,
    persistVoiceTranscriptDraft,
    reportHostError,
    resolveVoiceSessionUnavailableMessage,
    transcribeCapabilityProjection,
    voiceSessionState.status,
    voiceSessionState.mode,
  ]);
  const handleVoiceSessionCancel = useCallback(() => {
    voiceTranscribeAbortRef.current?.abort();
    voiceTranscribeAbortRef.current = null;
    voiceCaptureSessionRef.current?.cancel();
    voiceCaptureSessionRef.current = null;
    setVoiceSessionState(resolveIdleAgentVoiceSessionShellState(voiceSessionState.mode));
  }, [voiceSessionState.mode]);
  const handleEnterHandsFreeVoiceSession = useCallback(() => {
    void (async () => {
      if (
        voiceSessionState.mode === 'hands-free'
        || voiceSessionState.status === 'transcribing'
        || voiceSessionState.status === 'listening'
      ) {
        return;
      }
      const unavailableMessage = resolveVoiceSessionUnavailableMessage();
      if (unavailableMessage) {
        setVoiceSessionState({
          status: 'failed',
          mode: 'push-to-talk',
          message: unavailableMessage,
        });
        return;
      }
      await beginVoiceCapture({
        mode: 'hands-free',
        degradeToPushToTalkOnFailure: true,
        failureDefaultMessage: 'Hands-free is unavailable for the current conversation.',
      });
    })();
  }, [
    beginVoiceCapture,
    reportHostError,
    resolveVoiceSessionUnavailableMessage,
    voiceSessionState.mode,
    voiceSessionState.status,
  ]);
  const handleExitHandsFreeVoiceSession = useCallback(() => {
    resetVoiceSessionToPushToTalk();
  }, [resetVoiceSessionToPushToTalk]);
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
    pendingAttachments: activePendingAttachments,
    onDismissHostFeedback: () => setHostFeedback(null),
    onAttachmentsChange: (nextAttachments) => setPendingAttachmentsForThread(activeThreadId, nextAttachments),
    onModelSelectionChange: handleModelSelectionChange,
    reasoningLabel,
    renderMessageContent,
    routeReady: !activeTarget || agentRouteReady,
    schedulingJudgement,
    selectedTargetId: activeTarget?.agentId || null,
    behaviorSettings,
    setBehaviorSettings,
    voiceSessionState,
    onVoiceSessionToggle: handleVoiceSessionToggle,
    onVoiceSessionCancel: handleVoiceSessionCancel,
    onEnterHandsFreeVoiceSession: handleEnterHandsFreeVoiceSession,
    onExitHandsFreeVoiceSession: handleExitHandsFreeVoiceSession,
    setupState,
    streamState,
    submittingThreadId,
    t,
    targetSummariesInput: { targets, threads },
    targetsPending: targetsQuery.isPending,
    thinkingPreference: behaviorSettings.thinkingPreference,
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
