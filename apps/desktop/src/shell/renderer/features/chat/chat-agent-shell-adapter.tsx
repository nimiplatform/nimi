import { LocalAppConversationMediaStopButton, } from '@nimiplatform/kit/features/chat/ui';
import { localAgentReplyFailureMessage } from './chat-agent-runtime';
import { AgentManualVoicePlaybackButton } from './chat-agent-manual-voice-playback-button';
import { useHomeChatPosition } from '../../app-shell/providers/home-chat-position.js';
import { useActiveAgentConversationSourceRef } from '../agents/agent-conversation-source-resolution.js';
import { characterSourceRefKey } from '../realm-source/realm-source-identity.js';
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
import type { AgentConversationSelection } from './chat-shell-types';
import {
  RuntimeAgentDebugMessageAccessory,
  RuntimeImageMessageContent,
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
import { useAgentConversationHostFeedback } from './chat-agent-shell-adapter-host-feedback';
import { useAgentConversationPendingAttachments } from './chat-agent-shell-adapter-attachments';
import { useStreamController } from '../turns/stream-controller-context.js';
import { useAgentConversationVoiceInput } from './chat-agent-voice-input.js';
import { chatRuntimeReasonCodeMessage, localAgentConfigurationFailure } from './chat-runtime-error-message';
import {
  isDesktopAgentSessionBindingError,
  resolveDesktopAgentSessionRebind,
} from './chat-agent-session-rebind.js';
import type { ReportAgentConversationHostError } from './chat-agent-shell-adapter-host-feedback.js';
import { useAgentIntroduction } from '@nimiplatform/kit/features/chat/runtime';
import type { NimiLocalAppAgentIntroductionClient } from '@nimiplatform/sdk/app';
import { createAgentComposerDraftRef } from './chat-agent-composer-draft.js';
import { useAgentComposerPersistence } from '@nimiplatform/kit/features/chat/headless';
import { Button } from '@nimiplatform/kit/ui';
import { AgentFollowUpControl } from './chat-agent-follow-up-control.js';
import { AgentSubmissionRecovery } from './chat-agent-submission-recovery.js';
import { CHAT_COMPOSER_RAIL_RESERVE_CLASS, CHAT_CONTENT_POSITION_CLASS, CHAT_CONTENT_WIDTH_CLASS } from './chat-shared-content-layout.js';

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
  const homeChat = useHomeChatPosition();
  const { t } = useTranslation();
  const streamController = useStreamController();
  const bindings = useDesktopRendererBindings();
  const queryClient = useQueryClient();
  const appStore = useAppStoreApi();
  const authUserId = useAppStore((state) => normalizeText(state.auth.user?.id));
  const openChatTarget = homeChat.openTarget;
  const setAgentConversationTargetSnapshot = useAppStore(
    (state) => state.setAgentConversationTargetSnapshot,
  );
  const pendingAgentComposerPrefill = useAppStore((state) => state.pendingAgentComposerPrefill);
  const clearPendingAgentComposerPrefill = useAppStore((state) => state.clearPendingAgentComposerPrefill);
  const setPendingAgentComposerPrefill = useAppStore((state) => state.setPendingAgentComposerPrefill);
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
  const [composerPrefillRequestId, setComposerPrefillRequestId] = useState<number | null>(null);
  const regenerateTurnRef = useRef<(turnId: string, inputTurnId: string) => void>(() => {});
  const [pendingImageRetry, setPendingImageRetry] = useState<{
    agentHandle: string;
    prompt: string;
  } | null>(null);
  const agentSessionRebindRef = useRef<{
    readonly staleAgentHandle: string;
    readonly task: Promise<void>;
  } | null>(null);
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
    messages,
    selectedThreadRecord,
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
  const draftAgentHandle = normalizeText(shellActiveTarget?.agentHandle);
  const currentComposerTextRef = useMemo(
    () => createAgentComposerDraftRef(appStore, authUserId, draftAgentHandle),
    [appStore, authUserId, draftAgentHandle],
  );
  const draftClient = useCallback(() => bindings.sdk.appProduct(), [bindings.sdk, authUserId]);
  const draftPersistence = useAgentComposerPersistence({
    scopeKey: `${input.authStatus}:${authUserId}:${draftAgentHandle}`,
    agentHandle: draftAgentHandle,
    agentBinding: shellActiveTarget?.agentBinding,
    client: draftClient,
    draft: currentComposerTextRef,
    isCurrent: () => appStore.getState().auth.status === 'authenticated'
      && normalizeText(appStore.getState().auth.user?.id) === authUserId
      && normalizeText(shellActiveTargetRef.current?.agentHandle) === draftAgentHandle,
    subscribe: (onChange) => appStore.subscribe(onChange),
    onRestored: () => setComposerPrefillRequestId(value => (value || 0) + 1),
  });
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
        const latestSelection = appStore.navigation.getSnapshot().current.destination.chat;
        if (rebound
          && latestState.auth.status === 'authenticated'
          && normalizeText(latestState.auth.user?.id) === accountId
          && latestSelection?.mode === 'agent'
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
  const readIntroduction = useCallback<NimiLocalAppAgentIntroductionClient['getIntroduction']>(
    request => bindings.sdk.appProduct().agents.getIntroduction(request), [bindings.sdk],
  );
  const { introduction: emptyStateCharacterPresence, unavailable: introductionUnavailable, retry: onRetryIntroduction } = useAgentIntroduction({
    agentHandle: input.authStatus === 'authenticated' ? activeTarget?.agentHandle : null,
    getIntroduction: readIntroduction,
  });
  // Source-page prefill intent retains its owner navigation correlation;
  // introduction data above uses only the formal App handle.
  const prefillSourceRef = useActiveAgentConversationSourceRef({
    activeTarget: pendingAgentComposerPrefill?.sourceKey && !pendingAgentComposerPrefill.agentHandle ? activeTarget : null,
    authStatus: input.authStatus,
  });
  const activeTargetSourceKey = prefillSourceRef ? characterSourceRefKey(prefillSourceRef) : null;

  useEffect(() => {
    if (!activeTarget?.agentHandle || !pendingAgentComposerPrefill) {
      return;
    }
    const handleMatches = pendingAgentComposerPrefill.agentHandle
      ? pendingAgentComposerPrefill.agentHandle === activeTarget.agentHandle
      : false;
    const sourceMatches = pendingAgentComposerPrefill.sourceKey
      ? pendingAgentComposerPrefill.sourceKey === activeTargetSourceKey
      : false;
    if (!handleMatches && !sourceMatches) {
      return;
    }
    currentComposerTextRef.current = pendingAgentComposerPrefill.text;
    setComposerPrefillRequestId(pendingAgentComposerPrefill.requestId);
    clearPendingAgentComposerPrefill(pendingAgentComposerPrefill.requestId);
  }, [
    activeTarget?.agentHandle,
    activeTargetSourceKey,
    clearPendingAgentComposerPrefill,
    currentComposerTextRef,
    pendingAgentComposerPrefill,
  ]);
  const handleComposerPrefillRequest = useCallback((text: string) => {
    const agentHandle = activeTarget?.agentHandle;
    if (!agentHandle || !text.trim()) {
      return;
    }
    setPendingAgentComposerPrefill({ agentHandle, text });
  }, [activeTarget?.agentHandle, setPendingAgentComposerPrefill]);

  const history = useAgentRuntimeSessionSnapshotHydration({
    activeAgentHandle: activeTarget?.agentHandle || null,
    activeConversationAnchorId,
    authStatus: input.authStatus,
    buildHostErrorDetails,
    queryClient,
    onRuntimeError: recoverDesktopAgentSessionBinding,
    selectedThreadRecord,
  });
  // Unread history is loading, not a first meeting; a visible projection may
  // show while the authoritative read catches up.
  const isBundleLoading = history.loading && !bundle;
  const bundleError = history.error;

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
              (reasonCode ? chatRuntimeReasonCodeMessage(reasonCode, t, { localAgent: true }) : null)
              || t('Chat.imageGenerationFailed', { defaultValue: 'Image generation failed.' })
            }
            technicalDetailsLabel={t('Feedback.technicalDetails', { defaultValue: 'Technical details' })}
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
      const metadata = (message.metadata as Record<string, unknown> | undefined) || {};
      if (metadata.canonicalPartial === true && message.status !== 'pending' && !message.text?.trim()) {
        const reasonCode = normalizeText(metadata.canonicalFailureReasonCode);
        return <p role="status">{localAgentReplyFailureMessage(reasonCode, normalizeText(metadata.canonicalTerminalReason), t)}</p>;
      }
      return renderReasoningMessageContent(message, context);
    }
  ), [activeTarget?.agentHandle, renderReasoningMessageContent, t]);
  const renderMessageAccessory = useMemo<CanonicalMessageAccessorySlot>(() => (
    (message) => {
      if ((message.kind || 'text') !== 'text' || (message.role !== 'assistant' && message.role !== 'agent')) {
        return undefined;
      }
      const metadata = (message.metadata as Record<string, unknown> | undefined) || {};
      const reasonCode = normalizeText(metadata.canonicalFailureReasonCode);
      const incomplete = metadata.canonicalPartial === true && message.status !== 'pending';
      return (<>
        {metadata.canonicalMediaRunning === true && activeTarget?.agentHandle && activeConversationAnchorId ? <LocalAppConversationMediaStopButton
          agentHandle={activeTarget.agentHandle} conversationAnchorId={activeConversationAnchorId}
          turnId={String(metadata.canonicalTurnId)} conversation={() => bindings.sdk.conversation()}
          label={t('Chat.agentStopReplyMedia')} errorLabel={t('Chat.agentStopMediaUnconfirmed')}
          onError={reportRuntimeProductError} /> : null}
        {incomplete && message.text?.trim() ? <p role="status" className="text-xs text-neutral-500">{metadata.canonicalTerminalReason === 'user_cancel' ? t('Chat.agentReplyStoppedWithContent') : <>{t('Chat.agentPartialReplyKept')} {localAgentReplyFailureMessage(reasonCode, normalizeText(metadata.canonicalTerminalReason), t)}</>}</p> : null}
        {incomplete && reasonCode ? <details className="text-xs text-neutral-500"><summary>{t('Feedback.technicalDetails')}</summary><code>{reasonCode}</code></details> : null}
        {incomplete && reasonCode.startsWith('AI_REALTIME_') ? <p role="status" className="text-sm text-[var(--nimi-text-secondary)]">{t('Chat.agentRealtimeRestartHint')}</p> : null}
        {incomplete && localAgentConfigurationFailure(reasonCode) && input.onOpenAgentCenter ? <Button tone="ghost" size="sm" onClick={input.onOpenAgentCenter}>{t('Chat.agentOpenConfiguration')}</Button> : null}
        {metadata.canonicalCanRegenerate === true && !submittingThreadId ? <Button tone="ghost" size="sm" onClick={() => regenerateTurnRef.current(String(metadata.canonicalTurnId || ''), String(metadata.canonicalInputTurnId || ''))}>{t('Chat.agentRegenerateText')}</Button> : null}
        <AgentManualVoicePlaybackButton
          message={message}
          activeTarget={activeTarget}
          activeConversationAnchorId={activeConversationAnchorId}
          playLabel={t('Chat.agentVoiceManualPlay')}
          stopLabel={t('Chat.agentVoiceManualStop')}
          renderingLabel={t('Chat.agentVoiceManualRendering')}
          unavailableLabel={t('Chat.agentVoiceManualUnavailable')}
          errorLabel={t('Chat.agentVoiceManualError')}
          retryLabel={t('Chat.agentVoiceManualRetry')}
          pauseLabel={t('Chat.agentVoiceManualPause')}
          resumeLabel={t('Chat.agentVoiceManualResume')}
          progressLabel={t('Chat.agentVoiceManualProgress')}
          settingsLabel={t('Chat.agentVoiceOpenSettings')}
          settingsHint={t('Chat.agentVoiceSettingsHint')}
          onOpenSettings={input.onOpenAgentCenter}
          reportHostError={reportRuntimeProductError}
        />
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
      </>);
    }
  ), [activeTarget, activeConversationAnchorId, bindings.sdk, reportRuntimeProductError, developerModeEnabled, input.onOpenAgentCenter, submittingThreadId, t]);
  const currentFooterHostState = activeThreadId ? footerHostStateByThreadId[activeThreadId] || null : null;
  const { activePendingAttachments, setPendingAttachmentsForThread, bindAttachments, acknowledgeAttachments } = useAgentConversationPendingAttachments(accountId, activeThreadId);
  const textMaxOutputTokensRequested = behaviorSettings.maxOutputTokensOverride;
  const { ensureConversationAnchor, handleSelectAgent, handleSubmit } = useAgentConversationHostActions({
    now: bindings.clock.now,
    sdk: bindings.sdk,
    subjectUserId: accountId,
    streamController,
    activeTarget,
    activeThreadId,
    bundle,
    currentComposerTextRef,
    pendingAttachments: activePendingAttachments,
    bindAttachments,
    acknowledgeAttachments,
    queryClient,
    reportHostError: reportRuntimeProductError,
    submissionPersistence: draftPersistence,
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
    clearSelectedTarget: () => openChatTarget('agent', null),
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
  regenerateTurnRef.current = (turnId, inputTurnId) => {
    if (!turnId || submittingThreadId) return;
    const original = bundle?.messages.find(message => message.role === 'user' && message.metadataJson?.canonicalTurnId === inputTurnId);
    void handleSubmit({ text: original?.contentText || '', attachments: [], retryOfTurnId: turnId, parentMessageId: original?.id, canUpdateDraft: () => false }).catch(reportRuntimeProductError);
  };
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
    void handleSubmit({ text: retry.prompt, attachments: [] }).catch(reportRuntimeProductError);
  }, [
    activeTarget?.agentHandle,
    currentComposerTextRef,
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
    onRetryBundle: history.retry,
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
    onComposerPrefillRequest: handleComposerPrefillRequest,
    emptyStateCharacterPresence,
    introductionUnavailable,
    onRetryIntroduction,
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
    streamState: null,
    submittingThreadId: submittingThreadId || (history.controlState?.textTurnId ? activeThreadId : null),
    onStopGenerating: () => {
      const textTurnId = history.controlState?.textTurnId;
      if (activeTarget?.agentHandle && activeConversationAnchorId && textTurnId) void bindings.sdk.conversation().interruptTurn({agentHandle: activeTarget.agentHandle as Parameters<ReturnType<typeof bindings.sdk.conversation>['interruptTurn']>[0]['agentHandle'],conversationAnchorId:activeConversationAnchorId,expectedTurnId:textTurnId}).catch(reportRuntimeProductError);
    },
    t,
    targetSummariesInput: { targets, threads },
    targetsPending,
    thinkingPreference: behaviorSettings.thinkingPreference,
    thinkingSupported: thinkingSupport.supported,
    thinkingUnsupportedReason,
    voiceInput,
  });

  // The recovery and follow-up controls can resize the floating input area.
  // Reserve its actual height so the last reply and its actions remain reachable.
  const [composerInset, setComposerInset] = useState<number>();
  const measureComposer = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const update = () => setComposerInset(Math.ceil(element.getBoundingClientRect().height) + 16);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return useMemo<DesktopConversationModeHost>(() => ({
    ...presentation,
    transcriptProps: { ...presentation.transcriptProps, contentBottomInsetPx: composerInset,
      bannerContent: history.mediaReadError ? <>{presentation.transcriptProps?.bannerContent}
        <div role="status" className="rounded-lg bg-[var(--nimi-surface-card)] px-3 py-2 text-sm">
          {t('Chat.agentImageLoadFailed')}{' '}
          <Button tone="ghost" size="sm" disabled={history.mediaReadError === 'retrying'} onClick={history.retryMedia}>
            {t(history.mediaReadError === 'retrying' ? 'Chat.agentImageReloading' : 'Chat.agentReloadImages')}
          </Button>
        </div>
      </> : presentation.transcriptProps?.bannerContent,
    },
    onSelectTarget: handleSelectAgent,
    composerContent: <div ref={measureComposer}>
      {presentation.composerContent}
      <div className={CHAT_COMPOSER_RAIL_RESERVE_CLASS}>
      <div className={`${CHAT_CONTENT_POSITION_CLASS} ${CHAT_CONTENT_WIDTH_CLASS}`}>
      {activeTarget?.agentHandle && activeConversationAnchorId ? <AgentFollowUpControl key={`${authUserId}:${activeTarget.agentHandle}:${activeConversationAnchorId}`} agentHandle={activeTarget.agentHandle} conversationAnchorId={activeConversationAnchorId} state={history.controlState} conversation={() => bindings.sdk.conversation()} refresh={history.retry} onOpenAgentCenter={input.onOpenAgentCenter} /> : null}
      {draftPersistence.submission && !submittingThreadId && draftAgentHandle && input.authStatus === 'authenticated' ? <AgentSubmissionRecovery
        key={`${authUserId}:${draftAgentHandle}:${draftPersistence.submission.requestId}`}
        submission={draftPersistence.submission}
        agentHandle={draftAgentHandle}
        conversation={() => bindings.sdk.conversation()}
        acknowledge={draftPersistence.acknowledge}
        onAdmitted={submission => acknowledgeAttachments(submission.requestId)}
        onResolved={history.retry}
        onOpenAgentCenter={input.onOpenAgentCenter}
        onRestore={text => {
          const previous = currentComposerTextRef.current;
          if (text && previous !== text) currentComposerTextRef.current = previous ? `${previous}\n\n${text}` : text;
          setComposerPrefillRequestId(value => (value || 0) + 1);
        }}
      /> : null}
      {draftAgentHandle && input.authStatus === 'authenticated' ? (
        <div role="status" className="flex min-h-6 items-center justify-end gap-2 px-3 text-xs text-neutral-500">
          {draftPersistence.status === 'unsaved'
            ? t('Chat.agentDraftUnsaved', { defaultValue: 'Draft not saved. Your text is still available to copy.' })
            : draftPersistence.status === 'loading'
              ? t('Chat.agentDraftLoading', { defaultValue: 'Restoring draft…' })
              : draftPersistence.status === 'saving'
                ? t('Chat.agentDraftSaving', { defaultValue: 'Saving draft…' })
                : currentComposerTextRef.current ? t('Chat.agentDraftSaved', { defaultValue: 'Draft saved' }) : null}
          {draftPersistence.status === 'unsaved' ? <Button tone="ghost" size="sm" onClick={draftPersistence.retry}>{t('Common.retry', { defaultValue: 'Retry' })}</Button> : null}
        </div>
      ) : null}
      </div>
      </div>
    </div>,
  }), [composerInset, measureComposer, handleSelectAgent, presentation, draftAgentHandle, input.authStatus, draftPersistence.status, draftPersistence.retry, draftPersistence.submission, draftPersistence.acknowledge, acknowledgeAttachments, currentComposerTextRef, submittingThreadId, authUserId, bindings.sdk, history.retry, history.retryMedia, history.mediaReadError, history.controlState, activeTarget?.agentHandle, activeConversationAnchorId, t]);
}
