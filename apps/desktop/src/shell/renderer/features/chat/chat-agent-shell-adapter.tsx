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
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import {
  useAppStore,
  useAppStoreApi,
  type AuthStatus,
} from '../../app-shell/providers/app-store';
import type { RuntimeFieldMap } from '../../app-shell/providers/store-types';
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
  resolveAgentChatThinkingSupport,
} from './chat-shared-thinking';
import {
  createDefaultAgentChatExperienceSettings,
  normalizeAgentChatExperienceSettings,
  type AgentChatExperienceSettings,
} from './chat-settings-storage';
import { useDesktopRendererBindings } from '../../renderer/binding-context';
import { useAgentConversationPresentation } from './chat-agent-shell-presentation';
import { useAgentConversationEffects } from './chat-agent-shell-effects';
import { useAgentConversationHostActions } from './chat-agent-shell-host-actions';
import { useAgentConversationShellState } from './chat-agent-shell-adapter-state';
import {
  mergeAgentTargetWithPresentationProfile,
} from './chat-agent-thread-model';
import { useAgentConversationRuntimeController } from './chat-agent-shell-adapter-runtime';
import { useAgentRuntimeSessionSnapshotHydration } from './chat-agent-shell-adapter-session-snapshot';
import { RUNTIME_AGENT_CHAT_MODE_ID } from './chat-agent-runtime-mode';
import { useAgentConversationHostFeedback } from './chat-agent-shell-adapter-host-feedback';
import { useAgentConversationPendingAttachments } from './chat-agent-shell-adapter-attachments';
import { useStreamController } from '../turns/stream-controller-context.js';
import { useAgentConversationVoiceInput } from './chat-agent-voice-input.js';
import { chatRuntimeReasonCodeMessage } from './chat-runtime-error-message';
import {
  isDesktopAgentSessionBindingError,
  resolveDesktopAgentSessionRebind,
} from './chat-agent-session-rebind.js';
import type { ReportAgentConversationHostError } from './chat-agent-shell-adapter-host-feedback.js';

type UseAgentConversationModeHostInput = {
  authStatus: AuthStatus;
  diagnosticsVisible: boolean;
  onDiagnosticsVisibilityChange?: (visible: boolean) => void;
  onOpenAgentCenter?: () => void;
  onCloseAgentCenter?: () => void;
  agentCenterOpen?: boolean;
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
  const streamController = useStreamController();
  const bindings = useDesktopRendererBindings();
  const queryClient = useQueryClient();
  const appStore = useAppStoreApi();
  const authUserId = useAppStore((state) => normalizeText(state.auth.user?.id));
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const setAgentConversationTargetSnapshot = useAppStore(
    (state) => state.setAgentConversationTargetSnapshot,
  );
  const pendingAgentComposerPrefill = useAppStore((state) => state.pendingAgentComposerPrefill);
  const clearPendingAgentComposerPrefill = useAppStore((state) => state.clearPendingAgentComposerPrefill);
  const [submittingThreadId, setSubmittingThreadId] = useState<string | null>(null);
  const [behaviorSettings, setBehaviorSettingsState] = useState<AgentChatExperienceSettings>(
    () => createDefaultAgentChatExperienceSettings(),
  );
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(
    () => bindings.app.projection.developerModeEnabled(),
  );
  const [footerHostStateByThreadId, setFooterHostStateByThreadId] = useState<
    Record<string, {
      footerState: AgentHostFlowFooterState;
      lifecycle: AgentTurnLifecycleState;
    }>
  >({});
  const currentComposerTextRef = useRef('');
  const [composerPrefillRequestId, setComposerPrefillRequestId] = useState<number | null>(null);
  const [pendingImageRetry, setPendingImageRetry] = useState<{
    agentHandle: string;
    prompt: string;
  } | null>(null);
  const agentSessionRebindRef = useRef<{
    readonly staleAgentHandle: string;
    readonly task: Promise<void>;
  } | null>(null);
  const registry = useMemo(() => {
    const nextRegistry = new ConversationOrchestrationRegistry();
    nextRegistry.register(createRuntimeAgentChatConversationProvider({
      streamController,
      t,
      sdk: bindings.sdk,
      now: bindings.clock.now,
    }));
    return nextRegistry;
  }, [bindings.sdk, streamController, t]);
  const agentProvider = useMemo(
    () => {
      const provider = registry.resolve(RUNTIME_AGENT_CHAT_MODE_ID);
      if (!provider) throw new Error('RUNTIME_AGENT_CONVERSATION_PROVIDER_MISSING');
      return provider;
    },
    [registry],
  );
  const {
    buildHostErrorDetails,
    hostFeedback,
    reportHostError,
    setHostFeedback,
  } = useAgentConversationHostFeedback();
  const thinkingSupport = useMemo(
    () => resolveAgentChatThinkingSupport(),
    [],
  );
  const setBehaviorSettings = useCallback((nextSettings: AgentChatExperienceSettings) => {
    setBehaviorSettingsState(normalizeAgentChatExperienceSettings(nextSettings));
  }, []);
  useEffect(
    () => bindings.app.events.subscribeDeveloperMode(setDeveloperModeEnabled),
    [bindings],
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
      input.selection.agentHandle === selection.agentHandle
      && input.selection.conversationAnchorId === selection.conversationAnchorId
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
    bundle,
    bundleError,
    isBundleLoading,
    messages,
    selectedThreadRecord,
    streamState,
    targetByAgentHandle,
    targets,
    targetsPending,
    targetsReady,
    threads,
    threadsReady,
  } = useAgentConversationShellState({
    authStatus: input.authStatus,
    selection: input.selection,
  });
  const shellActiveTargetRef = useRef(shellActiveTarget);
  shellActiveTargetRef.current = shellActiveTarget;
  const recoverDesktopAgentSessionBinding = useCallback((error: unknown) => {
    if (!isDesktopAgentSessionBindingError(error)) return;
    const staleTarget = shellActiveTargetRef.current;
    const staleAgentHandle = normalizeText(staleTarget?.agentHandle);
    const conversationAnchorId = normalizeText(staleTarget?.conversationAnchorId);
    const accountId = normalizeText(appStore.getState().auth.user?.id);
    if (!staleTarget || !staleAgentHandle || !conversationAnchorId
      || !accountId || agentSessionRebindRef.current) {
      return;
    }

    const task = (async () => {
      try {
        const rebound = await resolveDesktopAgentSessionRebind(staleTarget, {
          agents: bindings.sdk.appProduct().agents,
          conversation: bindings.sdk.conversation(),
        });
        const latestTarget = shellActiveTargetRef.current;
        const latestState = appStore.getState();
        const latestSelection = latestState.agentConversationSelection;
        if (rebound
          && latestState.auth.status === 'authenticated'
          && normalizeText(latestState.auth.user?.id) === accountId
          && normalizeText(latestSelection.agentHandle) === staleAgentHandle
          && normalizeText(latestSelection.conversationAnchorId) === conversationAnchorId
          && normalizeText(
            latestState.agentConversationTargetByHandle[staleAgentHandle]?.conversationAnchorId,
          ) === conversationAnchorId
          && normalizeText(latestTarget?.agentHandle) === staleAgentHandle
          && normalizeText(latestTarget?.conversationAnchorId) === conversationAnchorId) {
          setAgentConversationTargetSnapshot(rebound);
        }
        await queryClient.invalidateQueries({
          queryKey: ['desktop-local-app-agent-references'],
        });
      } catch (rebindError) {
        logRendererEvent({
          level: 'warn',
          area: 'agent-chat-shell',
          message: 'action:current-app-session-agent-rebind:failed',
          details: {
            error: rebindError instanceof Error
              ? rebindError.message
              : String(rebindError || ''),
          },
        });
      }
    })();
    agentSessionRebindRef.current = { staleAgentHandle, task };
    void task.finally(() => {
      if (agentSessionRebindRef.current?.task === task) {
        agentSessionRebindRef.current = null;
      }
    });
  }, [appStore, bindings.sdk, queryClient, setAgentConversationTargetSnapshot]);
  const reportRuntimeProductError = useCallback<ReportAgentConversationHostError>((error, options) => {
    reportHostError(error, options);
    recoverDesktopAgentSessionBinding(error);
  }, [recoverDesktopAgentSessionBinding, reportHostError]);
  const {
    runtimeAgentCenterAdapter,
    runtimeCommittedStatus,
    runtimePresentationProfile,
  } = useAgentConversationRuntimeController({
    activeTarget: shellActiveTarget,
    authStatus: input.authStatus,
    reportHostError: reportRuntimeProductError,
  });
  const accountId = input.runtimeFields.targetAccountId
    || authUserId
    || 'local_account';
  const activeTarget = useMemo(
    () => mergeAgentTargetWithPresentationProfile(shellActiveTarget, runtimePresentationProfile),
    [runtimePresentationProfile, shellActiveTarget],
  );

  useEffect(() => {
    if (!activeTarget?.agentHandle || !pendingAgentComposerPrefill) {
      return;
    }
    if (pendingAgentComposerPrefill.agentHandle !== activeTarget.agentHandle) {
      return;
    }
    currentComposerTextRef.current = pendingAgentComposerPrefill.text;
    setComposerPrefillRequestId(pendingAgentComposerPrefill.requestId);
    clearPendingAgentComposerPrefill(pendingAgentComposerPrefill.requestId);
  }, [
    activeTarget?.agentHandle,
    clearPendingAgentComposerPrefill,
    pendingAgentComposerPrefill,
  ]);

  useAgentRuntimeSessionSnapshotHydration({
    activeAgentHandle: activeTarget?.agentHandle || null,
    activeConversationAnchorId,
    authStatus: input.authStatus,
    buildHostErrorDetails,
    bundleError,
    isBundleLoading,
    queryClient,
    onRuntimeError: recoverDesktopAgentSessionBinding,
    selectedThreadRecord,
    submittingThreadId,
  });

  const setupState = useMemo(() => {
    if (input.authStatus !== 'authenticated') {
      return {
        mode: 'agent' as const,
        status: 'setup-required' as const,
        issues: [{ code: 'agent-contract-unavailable' as const, detail: null }],
        primaryAction: {
          kind: 'sign-in' as const,
          returnToMode: 'agent' as const,
        },
      };
    }
    return createReadyConversationSetupState('agent');
  }, [input.authStatus]);

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
  const renderMessageContent = useMemo(() => (
    (
      message: Parameters<NonNullable<typeof renderReasoningMessageContent>>[0],
      context: Parameters<NonNullable<typeof renderReasoningMessageContent>>[1],
    ) => {
      if (message.kind === 'image' || message.kind === 'image-pending') {
        const metadata = (message.metadata as Record<string, unknown> | undefined) || {};
        const retryPrompt = normalizeText(metadata.retryPrompt);
        const reasonCode = normalizeText(metadata.imageFailureReasonCode);
        return (
          <RuntimeImageMessageContent
            message={message}
            imageLabel={t('ChatTimeline.imageMessage', 'Image')}
            showCaptionLabel={t('ChatTimeline.showImagePrompt', 'Show prompt')}
            hideCaptionLabel={t('ChatTimeline.hideImagePrompt', 'Hide prompt')}
            failureMessage={
              (reasonCode ? chatRuntimeReasonCodeMessage(reasonCode, t) : null)
              || t('Chat.imageGenerationFailed', { defaultValue: 'Image generation failed.' })
            }
            retryLabel={t('Chat.retryImageGeneration', { defaultValue: 'Retry image generation' })}
            onRetry={retryPrompt && activeTarget?.agentHandle ? () => {
              setPendingImageRetry({
                agentHandle: activeTarget.agentHandle!,
                prompt: retryPrompt,
              });
            } : null}
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
          />
        );
      }
      return renderReasoningMessageContent(message, context);
    }
  ), [activeTarget?.agentHandle, renderReasoningMessageContent, t]);
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
          rawOutputLabel={t('Chat.agentDebugRawRuntimeOutputLabel', { defaultValue: 'Raw Runtime Output' })}
          normalizedOutputLabel={t('Chat.agentDebugNormalizedRuntimeOutputLabel', { defaultValue: 'Normalized Runtime Output' })}
        />
      );
    }
  ), [developerModeEnabled, t]);
  const currentFooterHostState = activeThreadId ? footerHostStateByThreadId[activeThreadId] || null : null;
  const { activePendingAttachments, setPendingAttachmentsForThread } = useAgentConversationPendingAttachments(activeThreadId);
  const textMaxOutputTokensRequested = behaviorSettings.maxOutputTokensOverride;
  const { ensureConversationAnchor, handleSelectAgent, handleSubmit } = useAgentConversationHostActions({
    now: bindings.clock.now,
    sdk: bindings.sdk,
    subjectUserId: accountId,
    streamController,
    activeTarget,
    activeThreadId,
    applyDriverEffects,
    bundle,
    currentComposerTextRef,
    queryClient,
    reportHostError: reportRuntimeProductError,
    runAgentTurn: (turnInput) => agentProvider.runTurn({
      modeId: RUNTIME_AGENT_CHAT_MODE_ID,
      threadId: turnInput.threadId,
      turnId: turnInput.turnId,
      userMessage: turnInput.userMessage,
      history: [],
      signal: turnInput.signal,
      metadata: {
        agentHandle: turnInput.target.agentHandle || '',
        conversationAnchorId: turnInput.conversationAnchorId,
        runtimeThreadId: turnInput.runtimeThreadId,
        reasoningPreference: behaviorSettings.thinkingPreference,
        textMaxOutputTokensRequested,
      },
    }),
    selectedAgentHandle: input.selection.agentHandle,
    selectedThreadRecord,
    setBundleCache,
    setFooterHostState,
    setSelectionForAgentHandle: (agentHandle, conversationAnchorId) => setSelection({
      agentHandle,
      conversationAnchorId,
      targetId: agentHandle,
    }),
    setSubmittingThreadId,
    clearSelectedTarget: () => setSelectedTargetForSource('agent', null),
    submittingThreadId,
    syncSelectionToThread,
    t,
    targetByAgentHandle,
    targetsReady,
    threads,
    threadsReady,
    textModelContextTokens: null,
    textMaxOutputTokensRequested,
  });
  useEffect(() => {
    if (!pendingImageRetry || !activeTarget?.agentHandle || submittingThreadId) {
      return;
    }
    if (pendingImageRetry.agentHandle !== activeTarget.agentHandle) {
      setPendingImageRetry(null);
      return;
    }
    const retry = pendingImageRetry;
    setPendingImageRetry(null);
    currentComposerTextRef.current = '';
    void handleSubmit({ text: retry.prompt, attachments: [] }).catch(reportRuntimeProductError);
  }, [
    activeTarget?.agentHandle,
    handleSubmit,
    pendingImageRetry,
    reportRuntimeProductError,
    submittingThreadId,
  ]);
  const voiceInput = useAgentConversationVoiceInput({
    enabled: composerReady && Boolean(activeTarget) && !submittingThreadId,
    target: activeTarget,
    voiceCapture: bindings.app.commands.voiceCapture,
    runtime: bindings.sdk,
    ensureConversationAnchor,
    getCurrentConversationAnchorId: () => normalizeText(activeTarget?.conversationAnchorId) || null,
    handleSubmit,
    reportError: reportRuntimeProductError,
    failureMessage: t('Chat.voiceInputFailed', {
      defaultValue: 'Voice input failed. Check microphone access and the selected speech configuration.',
    }),
  });
  const presentation = useAgentConversationPresentation({
    activeTarget,
    accountId,
    activeThreadId,
    activeConversationAnchorId,
    bundle,
    bundleError,
    composerPrefillRequestId,
    composerReady,
    currentComposerTextRef,
    currentFooterHostState,
    handleSubmit,
    hostFeedback,
    inputSelectionAgentHandle: input.selection.agentHandle,
    isBundleLoading,
    messages,
    pendingAttachments: activePendingAttachments,
    onDismissHostFeedback: () => setHostFeedback(null),
    onAttachmentsChange: (nextAttachments) => setPendingAttachmentsForThread(activeThreadId, nextAttachments),
    reasoningLabel,
    renderMessageAccessory,
    renderMessageContent,
    runtimeAgentCenterAdapter,
    runtimeCommittedStatus,
    selectedTargetId: activeTarget?.agentHandle || null,
    behaviorSettings,
    setBehaviorSettings,
    developerModeEnabled,
    onDiagnosticsVisibilityChange: input.onDiagnosticsVisibilityChange,
    onOpenAgentCenter: input.onOpenAgentCenter,
    onCloseAgentCenter: input.onCloseAgentCenter,
    agentCenterOpen: input.agentCenterOpen,
    setupState,
    streamState,
    submittingThreadId,
    t,
    targetSummariesInput: { targets, threads },
    targetsPending,
    thinkingPreference: behaviorSettings.thinkingPreference,
    thinkingSupported: thinkingSupport.supported,
    thinkingUnsupportedReason,
    voiceInput,
  });

  return useMemo<DesktopConversationModeHost>(() => ({
    ...presentation,
    onSelectTarget: handleSelectAgent,
  }), [handleSelectAgent, presentation]);
}
