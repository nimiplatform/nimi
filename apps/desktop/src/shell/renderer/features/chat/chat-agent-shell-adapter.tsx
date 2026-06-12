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
} from '@nimiplatform/kit/features/chat/headless';
import {
  type CanonicalMessageAccessorySlot,
  ConversationOrchestrationRegistry,
} from '@nimiplatform/kit/features/chat/headless';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { exportDesktopAgentMemory } from '@renderer/infra/runtime-agent-memory-export';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import type { DesktopConversationModeHost } from './chat-shared-mode-host-types';
import {
  type AgentTurnLifecycleState,
} from './chat-agent-shell-lifecycle';
import {
  type AgentHostFlowFooterState,
} from './chat-agent-shell-host-flow';
import { createRuntimeAgentChatConversationProvider } from './chat-agent-runtime-provider';
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
import { useAgentConversationPresentation } from './chat-agent-shell-presentation';
import { useAgentConversationEffects } from './chat-agent-shell-effects';
import { useAgentConversationCapabilityEffects } from './chat-agent-shell-capability-effects';
import { useSchedulingFeasibility } from './chat-shared-execution-scheduling-guard';
import { useAgentConversationHostActions } from './chat-agent-shell-host-actions';
import { ChatAgentCognitionPanel } from './chat-agent-cognition-panel';
import { useAgentConversationVoiceSession } from './chat-agent-shell-adapter-voice';
import { useAgentConversationShellState } from './chat-agent-shell-adapter-state';
import { resolveAgentChatRequestedMaxOutputTokens } from './chat-nimi-route-view';
import {
  mergeAgentTargetWithPresentationProfile,
} from './chat-agent-thread-model';
import { useAgentConversationRuntimeController } from './chat-agent-shell-adapter-runtime';
import { useAgentRuntimeSessionSnapshotHydration } from './chat-agent-shell-adapter-session-snapshot';
import { RUNTIME_AGENT_CHAT_MODE_ID } from './chat-agent-runtime-mode';
import { useAgentConversationHostFeedback } from './chat-agent-shell-adapter-host-feedback';
import { useAgentConversationPendingAttachments } from './chat-agent-shell-adapter-attachments';

type UseAgentConversationModeHostInput = {
  authStatus: 'bootstrapping' | 'anonymous' | 'authenticated';
  diagnosticsVisible: boolean;
  onDiagnosticsVisibilityChange?: (visible: boolean) => void;
  onOpenAgentCenter?: () => void;
  runtimeFields: RuntimeFieldMap;
  selection: AgentConversationSelection;
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
  const transcribeCapabilityProjection = useAppStore(
    (state) => state.conversationCapabilityProjectionByCapability['audio.transcribe'] || null,
  );
  const [submittingThreadId, setSubmittingThreadId] = useState<string | null>(null);
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
  const currentComposerTextRef = useRef('');
  const registry = useMemo(() => {
    const nextRegistry = new ConversationOrchestrationRegistry();
    nextRegistry.register(createRuntimeAgentChatConversationProvider());
    return nextRegistry;
  }, []);
  const agentProvider = useMemo(
    () => registry.require(RUNTIME_AGENT_CHAT_MODE_ID),
    [registry],
  );
  const {
    buildHostErrorDetails,
    hostFeedback,
    reportHostError,
    setHostFeedback,
  } = useAgentConversationHostFeedback();
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
  const thinkingUnsupportedReason = useMemo(() => {
    if (thinkingSupport.supported || !thinkingSupport.reason) {
      return null;
    }
    const copy = getChatThinkingUnsupportedCopy(thinkingSupport.reason);
    return t(copy.key, { defaultValue: copy.defaultValue });
  }, [t, thinkingSupport]);

  const setSelection = useCallback((selection: AgentConversationSelection) => {
    if (
      input.selection.localAgentRef === selection.localAgentRef
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
    runtimeConversationSummaries,
    selectedThreadRecord,
    streamState,
    targetByLocalAgentRef,
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
    handleUpgradeStandardMemory,
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

  useAgentRuntimeSessionSnapshotHydration({
    activeLocalAgentRef: activeTarget?.localAgentRef || null,
    activeConversationAnchorId,
    authStatus: input.authStatus,
    buildHostErrorDetails,
    bundleError,
    isBundleLoading,
    queryClient,
    selectedThreadRecord,
    submittingThreadId,
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
    syncSelectionToThread,
  } = useAgentConversationEffects({
    currentComposerTextRef,
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
  const { activePendingAttachments, setPendingAttachmentsForThread } = useAgentConversationPendingAttachments(activeThreadId);
  const applyVoiceTranscriptComposerText = useCallback(async (input: { text: string; conversationAnchorId: string }) => {
    if (!activeThreadId || !activeConversationAnchorId || input.conversationAnchorId !== activeConversationAnchorId) {
      throw new Error('Voice input is unavailable because no active thread is selected.');
    }
    currentComposerTextRef.current = input.text;
  }, [activeConversationAnchorId, activeThreadId, currentComposerTextRef]);
  const {
    handsFreeState,
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
    applyVoiceTranscriptComposerText,
    reportHostError,
    setBundleCache,
    submittingThreadId,
    t,
    transcribeCapabilityProjection,
  });
  const agentAiConfig = useAppStore((state) => state.aiConfig);
  const { handleSelectAgent, handleSubmit } = useAgentConversationHostActions({
    activeTarget,
    activeThreadId,
    aiConfig: agentAiConfig,
    applyDriverEffects,
    bundle,
    currentComposerTextRef,
    queryClient,
    reportHostError,
    runAgentTurn: (turnInput) => agentProvider.runTurn({
      modeId: RUNTIME_AGENT_CHAT_MODE_ID,
      threadId: turnInput.threadId,
      turnId: turnInput.turnId,
      userMessage: turnInput.userMessage,
      history: [],
      signal: turnInput.signal,
      metadata: {
        ownerUserId: turnInput.target.ownerUserId,
        realmAgentId: turnInput.target.realmAgentId,
        localAgentRef: turnInput.target.localAgentRef,
        conversationAnchorId: turnInput.conversationAnchorId,
        textExecutionSnapshot: turnInput.textExecutionSnapshot,
        reasoningPreference: behaviorSettings.thinkingPreference,
        textMaxOutputTokensRequested: resolveAgentChatRequestedMaxOutputTokens(textRouteModelProfile, behaviorSettings.maxOutputTokensOverride),
      },
    }),
    selectedLocalAgentRef: input.selection.localAgentRef,
    selectedThreadRecord,
    setBundleCache,
    setFooterHostState,
    setSelectionForLocalAgentRef: (localAgentRef) => setSelection({
      localAgentRef,
      targetId: localAgentRef,
    }),
    setSubmittingThreadId,
    clearSelectedTarget: () => setSelectedTargetForSource('agent', null),
    submittingThreadId,
    syncSelectionToThread,
    t,
    targetByLocalAgentRef,
    targetsReady,
    threads,
    threadsReady,
    textModelContextTokens: textRouteModelProfile?.maxContextTokens ?? null,
    textMaxOutputTokensRequested: resolveAgentChatRequestedMaxOutputTokens(textRouteModelProfile, behaviorSettings.maxOutputTokensOverride),
  });
  const cognitionContent = useMemo(() => (
    activeTarget ? (
      <ChatAgentCognitionPanel
        targetTitle={activeTarget.displayName}
        disabled={Boolean(submittingThreadId)}
        memoryStatus={canonicalMemoryStatus}
        memoryLoading={canonicalMemoryLoading}
        onUpgradeStandardMemory={handleUpgradeStandardMemory}
        allowMemoryUpgrade
        recentMemories={runtimeInspect?.recentCanonicalMemories ?? null}
        onExportMemory={() => exportDesktopAgentMemory(activeTarget.localAgentRef)}
      />
    ) : null
  ), [
    activeTarget,
    canonicalMemoryLoading,
    canonicalMemoryStatus,
    handleUpgradeStandardMemory,
    runtimeInspect,
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
    currentComposerTextRef,
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
    inputSelectionLocalAgentRef: input.selection.localAgentRef,
    isBundleLoading,
    messages,
    pendingAttachments: activePendingAttachments,
    onDismissHostFeedback: () => setHostFeedback(null),
    onAttachmentsChange: (nextAttachments) => setPendingAttachmentsForThread(activeThreadId, nextAttachments),
    onModelSelectionChange: handleModelSelectionChange,
    reasoningLabel,
    renderMessageAccessory,
    renderMessageContent,
    routeReady: !activeTarget || agentRouteReady,
    runtimeInspect,
    runtimeInspectLoading,
    schedulingJudgement,
    selectedTargetId: activeTarget?.localAgentRef || null,
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
    targetSummariesInput: { targets, threads, runtimeConversationSummaries },
    targetsPending,
    thinkingPreference: behaviorSettings.thinkingPreference,
    thinkingSupported: thinkingSupport.supported,
    thinkingUnsupportedReason,
    agentRouteReady,
  });

  return useMemo<DesktopConversationModeHost>(() => ({
    ...presentation,
    handsFreeState,
    onSelectTarget: handleSelectAgent,
  }), [handleSelectAgent, handsFreeState, presentation]);
}
