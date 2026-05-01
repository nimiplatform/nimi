import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { asNimiError } from '@nimiplatform/sdk/runtime';
import {
  createReadyConversationSetupState,
} from '@nimiplatform/nimi-kit/features/chat';
import {
  type CanonicalMessageAccessorySlot,
  ConversationOrchestrationRegistry,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import type { AgentLocalThreadBundle } from '@renderer/bridge/runtime-bridge/types';
import { type RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { DesktopConversationModeHost } from './chat-shared-mode-host-types';
import {
  type AgentTurnLifecycleState,
} from './chat-agent-shell-lifecycle';
import {
  type AgentHostFlowFooterState,
} from './chat-agent-shell-host-flow';
import { createAgentLocalChatConversationProvider } from './chat-agent-orchestration';
import type { AgentConversationSelection } from './chat-shell-types';
import {
  RuntimeAgentDebugMessageAccessory,
  RuntimeImageMessageContent,
  RuntimeVoiceMessageContent,
  createReasoningMessageContentRenderer,
} from './chat-shared-runtime-stream-ui';
import {
  getChatThinkingUnsupportedCopy,
  resolveAgentThinkingSupportFromProjection,
} from './chat-shared-thinking';
import {
  createDefaultAgentChatExperienceSettings,
  normalizeAgentChatExperienceSettings,
  type AgentChatExperienceSettings,
} from './chat-settings-storage';
import {
  loadStoredPerformancePreferences,
  subscribeStoredPerformancePreferences,
} from '../settings/settings-storage';
import { resolveAgentChatBehavior } from './chat-agent-behavior-resolver';
import { type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import {
  bundleQueryKey,
  upsertBundleDraft,
  upsertThreadSummary,
  toErrorMessage,
} from './chat-agent-shell-core';
import { useAgentConversationPresentation } from './chat-agent-shell-presentation';
import { useAgentConversationEffects } from './chat-agent-shell-effects';
import { useAgentConversationCapabilityEffects } from './chat-agent-shell-capability-effects';
import { useSchedulingFeasibility } from './chat-shared-execution-scheduling-guard';
import { useAgentConversationHostActions } from './chat-agent-shell-host-actions';
import { logRendererEvent } from '@renderer/bridge/runtime-bridge/logging';
import type { PendingAttachment } from '../turns/turn-input-attachments';
import { clearPendingAttachments } from '../turns/turn-input-attachments';
import { ChatAgentHistoryPanel } from './chat-agent-history-panel';
import { useAgentConversationVoiceSession } from './chat-agent-shell-adapter-voice';
import { useAgentConversationShellState } from './chat-agent-shell-adapter-state';
import { useAgentConversationMessageMenu } from './chat-agent-shell-adapter-menu';
import { resolveAgentChatRequestedMaxOutputTokens } from './chat-nimi-route-view';
import {
  buildAgentThreadMetadataUpdate,
  mergeAgentTargetWithPresentationProfile,
} from './chat-agent-thread-model';
import { useAgentConversationRuntimeController } from './chat-agent-shell-adapter-runtime';
import { useAgentRuntimeSessionSnapshotHydration } from './chat-agent-shell-adapter-session-snapshot';

type UseAgentConversationModeHostInput = {
  authStatus: 'bootstrapping' | 'anonymous' | 'authenticated';
  diagnosticsVisible: boolean;
  onDiagnosticsVisibilityChange?: (visible: boolean) => void;
  onOpenAgentCenter?: () => void;
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  selection: AgentConversationSelection;
  lastSelectedThreadId: string | null;
  setSelection: (selection: AgentConversationSelection) => void;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function useAgentConversationModeHost(
  input: UseAgentConversationModeHostInput,
): DesktopConversationModeHost {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
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
    () => createDefaultAgentChatExperienceSettings(),
  );
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(
    () => loadStoredPerformancePreferences().developerMode === true,
  );
  const schedulingJudgement = useSchedulingFeasibility();
  const [footerHostStateByThreadId, setFooterHostStateByThreadId] = useState<
    Record<string, {
      footerState: AgentHostFlowFooterState;
      lifecycle: AgentTurnLifecycleState;
    }>
  >({});
  const [pendingAttachmentsByThreadId, setPendingAttachmentsByThreadId] = useState<Record<string, readonly PendingAttachment[]>>({});
  const currentDraftTextRef = useRef('');
  const pendingAttachmentsByThreadRef = useRef<Record<string, readonly PendingAttachment[]>>({});
  const registry = useMemo(() => {
    const nextRegistry = new ConversationOrchestrationRegistry();
    nextRegistry.register(createAgentLocalChatConversationProvider());
    return nextRegistry;
  }, []);
  const agentProvider = useMemo(
    () => registry.require('agent-local-chat-v1'),
    [registry],
  );
  const buildHostErrorDetails = useCallback((error: unknown, action?: string, extra?: Record<string, unknown>) => {
    const normalized = asNimiError(error, { source: 'runtime' });
    const causeMessage = error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : undefined;
    return {
      error: toErrorMessage(error),
      ...(action ? { action } : {}),
      ...(typeof normalized.reasonCode === 'string' && normalized.reasonCode.trim()
        ? { reasonCode: normalized.reasonCode.trim() }
        : {}),
      ...(typeof normalized.actionHint === 'string' && normalized.actionHint.trim()
        ? { actionHint: normalized.actionHint.trim() }
        : {}),
      ...(causeMessage ? { causeMessage } : {}),
      ...(extra || {}),
    };
  }, []);
  const reportHostError = useCallback((error: unknown, options?: { action?: string; extra?: Record<string, unknown> }) => {
    const details = buildHostErrorDetails(error, options?.action, options?.extra);
    const message = [
      String(details.error || '').trim(),
      typeof details.reasonCode === 'string' && details.reasonCode.trim()
        ? `[${details.reasonCode.trim()}]`
        : '',
    ].filter(Boolean).join(' ');
    logRendererEvent({
      level: 'error',
      area: 'agent-chat-shell',
      message: 'action:host-error',
      details,
    });
    setHostFeedback({
      kind: 'error',
      message,
    });
  }, [buildHostErrorDetails]);
  const thinkingSupport = useMemo(
    () => resolveAgentThinkingSupportFromProjection(textCapabilityProjection),
    [textCapabilityProjection],
  );
  const setBehaviorSettings = useCallback((nextSettings: AgentChatExperienceSettings) => {
    setBehaviorSettingsState(normalizeAgentChatExperienceSettings(nextSettings));
  }, []);
  useEffect(() => subscribeStoredPerformancePreferences((preferences) => {
    setDeveloperModeEnabled(preferences.developerMode === true);
  }), []);
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
  const {
    activeTarget: shellActiveTarget,
    activeThreadId,
    activeConversationAnchorId,
    agentResolution,
    agentRouteReady,
    bundle,
    bundleError,
    handleModelSelectionChange,
    initialModelSelection,
    isBundleLoading,
    messages,
    selectedThreadRecord,
    streamState,
    targetByAgentId,
    targets,
    targetsPending,
    targetsReady,
    textRouteModelProfile,
    threads,
    threadsReady,
  } = useAgentConversationShellState({
    aiConfig: agentAdapterAiConfig,
    authStatus: input.authStatus,
    bootstrapReady,
    lastSelectedThreadId: input.lastSelectedThreadId,
    selection: input.selection,
  });
  const {
    canonicalMemoryLoading,
    canonicalMemoryStatus,
    mutationPendingAction,
    recentRuntimeEvents,
    runtimeInspect,
    runtimeInspectLoading,
    runtimePresentationProfile,
    handleCancelPendingHook,
    handleClearDyadicContext,
    handleClearWorldContext,
    handleDisableAutonomy,
    handleEnableAutonomy,
    handleRefreshRuntimeInspect,
    handleUpdateAutonomyConfig,
    handleUpdateRuntimeState,
  } = useAgentConversationRuntimeController({
    activeTarget: shellActiveTarget,
    authStatus: input.authStatus,
    buildHostErrorDetails,
    diagnosticsVisible: input.diagnosticsVisible,
    reportHostError,
    setHostFeedback,
    t,
  });
  const activeTarget = useMemo(
    () => mergeAgentTargetWithPresentationProfile(shellActiveTarget, runtimePresentationProfile),
    [runtimePresentationProfile, shellActiveTarget],
  );

  useEffect(() => {
    const metadataUpdate = buildAgentThreadMetadataUpdate({
      thread: selectedThreadRecord,
      target: activeTarget,
    });
    if (!metadataUpdate) {
      return;
    }
    let cancelled = false;
    void chatAgentStoreClient.updateThreadMetadata(metadataUpdate)
      .then((updatedThread) => {
        if (cancelled) {
          return;
        }
        queryClient.setQueryData(['chat-agent-threads'], (current: typeof threads | undefined) => (
          upsertThreadSummary(current || [], updatedThread)
        ));
        queryClient.setQueryData(bundleQueryKey(updatedThread.id), (current: AgentLocalThreadBundle | undefined) => {
          if (!current || current.thread.id !== updatedThread.id) {
            return current;
          }
          return {
            ...current,
            thread: updatedThread,
          };
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        logRendererEvent({
          level: 'warn',
          area: 'agent-chat-shell',
          message: 'action:host-error',
          details: buildHostErrorDetails(error, 'sync-agent-thread-target-snapshot', {
            threadId: metadataUpdate.id,
            agentId: metadataUpdate.targetSnapshot.agentId,
          }),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [activeTarget, buildHostErrorDetails, queryClient, selectedThreadRecord, threads]);

  useAgentRuntimeSessionSnapshotHydration({
    activeAgentId: activeTarget?.agentId || null,
    activeConversationAnchorId,
    authStatus: input.authStatus,
    buildHostErrorDetails,
    bundleError,
    isBundleLoading,
    queryClient,
    selectedThreadRecord,
    submittingThreadId,
    threads,
  });

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
    return createReadyConversationSetupState('agent');
  }, [bootstrapReady, input.authStatus]);

  const composerReady = setupState.status === 'ready'
    && !isBundleLoading
    && !bundleError;

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

  const reasoningLabel = t('Chat.reasoningLabel', { defaultValue: 'Thought process' });
  const renderReasoningMessageContent = useMemo(
    () => createReasoningMessageContentRenderer(reasoningLabel),
    [reasoningLabel],
  );
  const [voicePlaybackState, setVoicePlaybackState] = useState<{
    conversationAnchorId: string;
    messageId: string;
    active: boolean;
    amplitude: number;
    visemeId: 'aa' | 'ee' | 'ih' | 'oh' | 'ou' | null;
  } | null>(null);
  const handleVoicePlaybackStateChange = useCallback((nextState: {
    conversationAnchorId: string;
    messageId: string;
    active: boolean;
    amplitude: number;
    visemeId: 'aa' | 'ee' | 'ih' | 'oh' | 'ou' | null;
  }) => {
    setVoicePlaybackState((current) => {
      if (nextState.active) {
        return nextState;
      }
      if (current?.messageId === nextState.messageId) {
        return null;
      }
      return current;
    });
  }, []);
  useEffect(() => {
    setVoicePlaybackState((current) => (
      current && activeConversationAnchorId && current.conversationAnchorId !== activeConversationAnchorId
        ? null
        : current
    ));
  }, [activeConversationAnchorId]);
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
      if (message.kind === 'voice') {
        return (
          <RuntimeVoiceMessageContent
            message={message}
            voiceLabel={t('Chat.voiceInspectTitle', { defaultValue: 'Voice inspect' })}
            transcriptLabel={t('Chat.voiceInspectTranscriptTitle', { defaultValue: 'Transcript' })}
            showTranscriptLabel={t('Chat.voiceTranscribe', { defaultValue: 'Transcribe voice' })}
            hideTranscriptLabel={t('Chat.voiceCollapseTranscript', { defaultValue: 'Collapse transcript' })}
            transcriptUnavailableLabel={t('Chat.voiceInspectTranscriptUnavailable', { defaultValue: 'No transcript available for this voice beat.' })}
            onPlaybackStateChange={handleVoicePlaybackStateChange}
          />
        );
      }
      return renderReasoningMessageContent(message, context);
    }
  ), [handleVoicePlaybackStateChange, renderReasoningMessageContent, t]);
  const renderMessageAccessory = useMemo<CanonicalMessageAccessorySlot>(() => (
    (message) => {
      if ((message.kind || 'text') !== 'text' || (message.role !== 'assistant' && message.role !== 'agent')) {
        return undefined;
      }
      return (
        <RuntimeAgentDebugMessageAccessory
          message={message}
          debugVisible={developerModeEnabled}
          summaryLabel={t('Chat.agentDebugSummary', { defaultValue: 'Show debug prompt / returned data' })}
          copyLabel={t('Chat.agentDebugCopyLabel', { defaultValue: 'Copy' })}
          copiedLabel={t('Chat.agentDebugCopiedLabel', { defaultValue: 'Copied' })}
          followUpLabel={t('Chat.agentDebugFollowUpLabel', { defaultValue: 'Auto follow-up' })}
          followUpInstructionLabel={t('Chat.agentDebugFollowUpInstructionLabel', { defaultValue: 'Follow-up instruction' })}
          promptLabel={t('Chat.agentDebugPromptLabel', { defaultValue: 'Prompt' })}
          systemPromptLabel={t('Chat.agentDebugSystemPromptLabel', { defaultValue: 'System Prompt' })}
          rawOutputLabel={t('Chat.agentDebugRawOutputLabel', { defaultValue: 'Raw Model Output' })}
          normalizedOutputLabel={t('Chat.agentDebugNormalizedOutputLabel', { defaultValue: 'Normalized Model Output' })}
        />
      );
    }
  ), [developerModeEnabled, t]);
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
  const persistVoiceTranscriptDraft = useCallback(async (input: { text: string; conversationAnchorId: string }) => {
    if (!activeThreadId || !activeConversationAnchorId || input.conversationAnchorId !== activeConversationAnchorId) {
      throw new Error('Voice input is unavailable because no active thread is selected.');
    }
    const draft = await chatAgentStoreClient.putDraft({
      threadId: activeThreadId,
      text: input.text,
      updatedAtMs: Date.now(),
    });
    currentDraftTextRef.current = input.text;
    setBundleCache(
      activeThreadId,
      (current) => upsertBundleDraft(current, draft) || current,
    );
  }, [activeConversationAnchorId, activeThreadId, currentDraftTextRef, setBundleCache]);
  const {
    clearLatestVoiceCaptureForThread,
    handsFreeState,
    latestVoiceCaptureByThreadRef,
    onVoiceSessionCancel,
    onVoiceSessionToggle,
    voiceCaptureState,
    voiceSessionState,
  } = useAgentConversationVoiceSession({
    activeTarget,
    activeConversationAnchorId,
    activeThreadId,
    aiConfig: agentAdapterAiConfig,
    agentResolution,
    bundleMessages: bundle?.messages,
    persistVoiceTranscriptDraft,
    reportHostError,
    setBundleCache,
    submittingThreadId,
    t,
    transcribeCapabilityProjection,
    voiceCapabilityProjection,
  });
  const agentAiConfig = useAppStore((state) => state.aiConfig);
  const { handleDeleteMessage, handleDeleteThread, handleSelectAgent, handleSelectThread, handleSubmit } = useAgentConversationHostActions({
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
          conversationAnchorId: turnInput.conversationAnchorId,
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
          textModelContextTokens: textRouteModelProfile?.maxContextTokens ?? null,
          textMaxOutputTokensRequested: resolveAgentChatRequestedMaxOutputTokens(textRouteModelProfile, behaviorSettings.maxOutputTokensOverride),
          resolvedBehavior: resolveAgentChatBehavior({
            userText: turnInput.userMessage.text,
            hasUserAttachments: turnInput.userMessage.attachments.length > 0,
            settings: behaviorSettings,
          }),
        },
      },
    }),
    selectedAgentId: input.selection.agentId,
    selectedThreadRecord,
    setBundleCache,
    setFooterHostState,
    setSelectionForAgent: (agentId) => setSelection({
      threadId: null,
      agentId,
      targetId: agentId,
    }),
    setSubmittingThreadId,
    setThreadsCache,
    clearSelectedTarget: () => setSelectedTargetForSource('agent', null),
    submittingThreadId,
    syncSelectionToThread,
    t,
    targetByAgentId,
    targetsReady,
    threads,
    threadsReady,
    textModelContextTokens: textRouteModelProfile?.maxContextTokens ?? null,
    textMaxOutputTokensRequested: resolveAgentChatRequestedMaxOutputTokens(textRouteModelProfile, behaviorSettings.maxOutputTokensOverride),
  });
  const {
    auxiliaryOverlayContent,
    clearMessageContextMenu,
    onMessageContextMenu,
  } = useAgentConversationMessageMenu({
    onDeleteMessage: (messageId) => {
      void handleDeleteMessage(messageId).catch(reportHostError);
    },
    submittingThreadId,
    t,
  });
  const handleDeleteCurrentThread = useCallback((threadId: string) => {
    clearMessageContextMenu();
    setPendingAttachmentsForThread(threadId, []);
    clearLatestVoiceCaptureForThread(threadId);
    void handleDeleteThread(threadId).catch(reportHostError);
  }, [clearLatestVoiceCaptureForThread, clearMessageContextMenu, handleDeleteThread, reportHostError, setPendingAttachmentsForThread]);

  const cognitionContent = useMemo(() => (
    activeTarget ? (
      <ChatAgentHistoryPanel
        targetTitle={activeTarget.displayName}
        disabled={Boolean(submittingThreadId)}
        memoryStatus={canonicalMemoryStatus}
        memoryLoading={canonicalMemoryLoading}
        allowMemoryUpgrade={false}
      />
    ) : null
  ), [
    activeTarget,
    canonicalMemoryLoading,
    canonicalMemoryStatus,
    submittingThreadId,
  ]);

  const presentation = useAgentConversationPresentation({
    activeTarget,
    accountId: input.runtimeFields.targetAccountId
      || normalizeText((useAppStore.getState().auth.user as Record<string, unknown> | null)?.id)
      || 'local_account',
    activeThreadId,
    activeConversationAnchorId,
    bundle,
    bundleError,
    composerReady,
    currentDraftTextRef,
    currentFooterHostState,
    mutationPendingAction,
    onCancelPendingHook: handleCancelPendingHook,
    onClearDyadicContext: handleClearDyadicContext,
    onClearWorldContext: handleClearWorldContext,
    onDisableAutonomy: handleDisableAutonomy,
    onEnableAutonomy: handleEnableAutonomy,
    onRefreshInspect: handleRefreshRuntimeInspect,
    onUpdateRuntimeState: handleUpdateRuntimeState,
    onUpdateAutonomyConfig: handleUpdateAutonomyConfig,
    recentRuntimeEvents,
    handleSubmit,
    hostFeedback,
    initialModelSelection,
    inputSelectionAgentId: input.selection.agentId,
    isBundleLoading,
    messages,
    pendingAttachments: activePendingAttachments,
    onDismissHostFeedback: () => setHostFeedback(null),
    onAttachmentsChange: (nextAttachments) => setPendingAttachmentsForThread(activeThreadId, nextAttachments),
    onMessageContextMenu,
    onModelSelectionChange: handleModelSelectionChange,
    reasoningLabel,
    renderMessageAccessory,
    renderMessageContent,
    routeReady: !activeTarget || agentRouteReady,
    runtimeInspect,
    runtimeInspectLoading,
    schedulingJudgement,
    selectedTargetId: activeTarget?.agentId || null,
    behaviorSettings,
    setBehaviorSettings,
    cognitionContent,
    onDiagnosticsVisibilityChange: input.onDiagnosticsVisibilityChange,
    onOpenAgentCenter: input.onOpenAgentCenter,
    voiceSessionState,
    voiceCaptureState,
    voicePlaybackState,
    onVoiceSessionToggle,
    onVoiceSessionCancel,
    onEnterHandsFreeVoiceSession: handsFreeState.onEnter,
    onExitHandsFreeVoiceSession: handsFreeState.onExit,
    setupState,
    streamState,
    submittingThreadId,
    t,
    targetSummariesInput: { targets, threads },
    targetsPending,
    thinkingPreference: behaviorSettings.thinkingPreference,
    thinkingSupported: thinkingSupport.supported,
    thinkingUnsupportedReason,
    agentRouteReady,
    clearChatsTargetName: activeTarget?.displayName ?? null,
    clearChatsDisabled: Boolean(submittingThreadId) || !activeThreadId,
    onClearAgentHistory: activeThreadId ? () => handleDeleteCurrentThread(activeThreadId) : undefined,
  });

  return useMemo<DesktopConversationModeHost>(() => ({
    ...presentation,
    auxiliaryOverlayContent,
    handsFreeState,
    onSelectTarget: handleSelectAgent,
    onSelectThread: handleSelectThread,
  }), [auxiliaryOverlayContent, handleSelectAgent, handleSelectThread, handsFreeState, presentation]);
}
