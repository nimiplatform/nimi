import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import { type RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { DesktopConversationModeHost } from './chat-mode-host-types';
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
  createReasoningMessageContentRenderer,
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
import {
  loadStoredPerformancePreferences,
  subscribeStoredPerformancePreferences,
} from '../settings/settings-storage';
import { resolveAgentChatBehavior } from './chat-agent-behavior-resolver';
import { type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import { upsertBundleDraft, toErrorMessage } from './chat-agent-shell-core';
import { useAgentConversationPresentation } from './chat-agent-shell-presentation';
import { useAgentConversationEffects } from './chat-agent-shell-effects';
import { useAgentConversationCapabilityEffects } from './chat-agent-shell-capability-effects';
import { useSchedulingFeasibility } from './chat-execution-scheduling-guard';
import { useAgentConversationHostActions } from './chat-agent-shell-host-actions';
import { logRendererEvent } from '@renderer/bridge/runtime-bridge/logging';
import type { PendingAttachment } from '../turns/turn-input-attachments';
import { clearPendingAttachments } from '../turns/turn-input-attachments';
import { ChatAgentHistoryPanel } from './chat-agent-history-panel';
import { useAgentConversationVoiceSession } from './chat-agent-shell-adapter-voice';
import { useAgentConversationShellState } from './chat-agent-shell-adapter-state';
import { useAgentConversationMessageMenu } from './chat-agent-shell-adapter-menu';

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
    () => loadStoredAgentChatExperienceSettings(),
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
    activeTarget,
    activeThreadId,
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
  const {
    clearLatestVoiceCaptureForThread,
    handsFreeState,
    latestVoiceCaptureByThreadRef,
    onVoiceSessionCancel,
    onVoiceSessionToggle,
    voiceSessionState,
  } = useAgentConversationVoiceSession({
    activeTarget,
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
          textMaxOutputTokensRequested: textRouteModelProfile?.maxOutputTokens ?? null,
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
    textMaxOutputTokensRequested: textRouteModelProfile?.maxOutputTokens ?? null,
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
  const presentation = useAgentConversationPresentation({
    activeTarget,
    activeThreadId,
    bundle,
    bundleError,
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
    onMessageContextMenu,
    onModelSelectionChange: handleModelSelectionChange,
    reasoningLabel,
    renderMessageAccessory,
    renderMessageContent,
    routeReady: !activeTarget || agentRouteReady,
    schedulingJudgement,
    selectedTargetId: activeTarget?.agentId || null,
    behaviorSettings,
    setBehaviorSettings,
    voiceSessionState,
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
  });

  const handleDeleteCurrentThread = useCallback((threadId: string) => {
    clearMessageContextMenu();
    setPendingAttachmentsForThread(threadId, []);
    clearLatestVoiceCaptureForThread(threadId);
    void handleDeleteThread(threadId).catch(reportHostError);
  }, [clearLatestVoiceCaptureForThread, clearMessageContextMenu, handleDeleteThread, reportHostError, setPendingAttachmentsForThread]);

  const settingsContent = useMemo(() => (
    <div className="space-y-4">
      {presentation.settingsContent}
      {activeTarget ? (
        <ChatAgentHistoryPanel
          targetTitle={activeTarget.displayName}
          activeThreadId={activeThreadId}
          disabled={Boolean(submittingThreadId)}
          onClearAgentHistory={handleDeleteCurrentThread}
        />
      ) : null}
    </div>
  ), [activeTarget, activeThreadId, handleDeleteCurrentThread, presentation.settingsContent, submittingThreadId]);

  return useMemo<DesktopConversationModeHost>(() => ({
    ...presentation,
    auxiliaryOverlayContent,
    handsFreeState,
    settingsContent,
    onSelectTarget: handleSelectAgent,
    onSelectThread: handleSelectThread,
  }), [auxiliaryOverlayContent, handleSelectAgent, handleSelectThread, handsFreeState, presentation, settingsContent]);
}
