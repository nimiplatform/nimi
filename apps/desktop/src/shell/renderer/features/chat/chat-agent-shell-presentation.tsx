import { useCallback, useMemo, useState } from 'react';
import {
  type ChatComposerSubmitInput,
} from '@nimiplatform/kit/features/chat/headless';
import type { DesktopConversationModeHost } from './chat-shared-mode-host-types';
import { RuntimeStreamFooter } from './chat-shared-runtime-stream-ui';
import { cancelStream } from '../turns/stream-controller';
import { createInitialAgentTurnLifecycleState } from './chat-agent-shell-lifecycle';
import { resolveLatestAgentStatusCue } from './chat-agent-shell-presentation-status';
import { resolveAgentFooterViewState } from './chat-agent-shell-footer-state';
import { resolveAgentConversationSurfaceState } from './chat-agent-shell-visible-state';
import type { RuntimeCommittedStatusProjection } from './chat-agent-shell-visible-state';
import { resolveAgentConversationHostView } from './chat-agent-shell-host-view';
import { resolveAgentConversationHostSnapshot } from './chat-agent-shell-host-snapshot';
import {
  resolveAgentCanonicalMessages,
  resolveAgentSelectedTargetId,
  resolveAgentTargetSummaries,
} from './chat-agent-shell-view-model';
import { InlineFeedback } from '@renderer/ui/feedback/inline-feedback';
import { resolveExecutionSchedulingGuardDecision } from './chat-shared-execution-scheduling-guard';
import {
  resolveAgentComposerVoiceState,
} from './chat-agent-voice-session';
import { AgentCanonicalComposer } from './chat-agent-canonical-composer';
import { AgentConversationDiagnosticsContent, AgentConversationSettingsContent } from './chat-agent-shell-presentation-settings';
import { useAgentConversationLocalAvatarControls } from './chat-agent-shell-local-avatar-controls';
import { ChatComposerLeadingAvatar } from './chat-shared-composer-leading-avatar';
import { CHAT_CONTENT_POSITION_CLASS, CHAT_CONTENT_WIDTH_CLASS } from './chat-shared-content-layout';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';
import type { PendingAttachment } from '../turns/turn-input-attachments';


const AGENT_TRANSCRIPT_BOTTOM_RESERVE_CLASS = 'pb-[clamp(140px,16vh,200px)]';

export function useAgentConversationPresentation(
  input: UseAgentConversationPresentationInput,
): Pick<
  DesktopConversationModeHost,
  | 'adapter'
  | 'activeThreadId'
  | 'availability'
  | 'characterData'
  | 'composerContent'
  | 'messages'
  | 'mode'
  | 'onThinkingToggle'
  | 'selectedTargetId'
  | 'settingsContent'
  | 'settingsDrawerTitle'
  | 'settingsDrawerSubtitle'
  | 'setupDescription'
  | 'stagePanelProps'
  | 'targets'
  | 'thinkingState'
  | 'transcriptProps'
> {
  const schedulingGuard = useMemo(
    () => resolveExecutionSchedulingGuardDecision({
      judgement: input.schedulingJudgement,
      t: input.t,
    }),
    [input.schedulingJudgement, input.t],
  );
  const targetSummaries = useMemo(
    () => resolveAgentTargetSummaries(input.targetSummariesInput),
    [input.targetSummariesInput],
  );
  const footerViewState = useMemo(() => resolveAgentFooterViewState({
    streamState: input.streamState,
    lifecycle: input.currentFooterHostState?.lifecycle || createInitialAgentTurnLifecycleState(),
    currentHostFooterState: input.currentFooterHostState?.footerState || 'hidden',
    isSubmitting: input.submittingThreadId === input.activeThreadId,
  }), [input.activeThreadId, input.currentFooterHostState?.footerState, input.currentFooterHostState?.lifecycle, input.streamState, input.submittingThreadId]);
  const latestStatusCue = useMemo(() => {
    return resolveLatestAgentStatusCue(input.bundle?.messages);
  }, [input.bundle]);
  const runtimeCommittedStatus = useMemo<RuntimeCommittedStatusProjection | null>(() => {
    if (!input.runtimeInspect) {
      return null;
    }
    return {
      lifecycleStatus: input.runtimeInspect.lifecycleStatus,
      executionState: input.runtimeInspect.executionState,
      statusText: input.runtimeInspect.statusText,
    };
  }, [input.runtimeInspect]);
  const surfaceState = useMemo(() => resolveAgentConversationSurfaceState({
    composerReady: input.composerReady,
    activeTarget: input.activeTarget,
    activeThreadId: input.activeThreadId,
    activeConversationAnchorId: input.activeConversationAnchorId,
    submittingThreadId: input.submittingThreadId,
    voiceCaptureState: input.voiceCaptureState,
    voicePlaybackState: input.voicePlaybackState,
    voiceSessionState: input.voiceSessionState,
    latestStatusCue,
    runtimeCommittedStatus,
    footerViewState,
    labels: {
      title: input.t('Chat.agentTitle', { defaultValue: 'Agent Chat' }),
      sendingDisabledReason: input.t('Chat.agentSending', { defaultValue: 'The agent is replying…' }),
      composerPlaceholderWithTarget: input.t('Chat.agentComposerPlaceholder', {
        defaultValue: 'Talk to {{name}}…',
        name: input.activeTarget?.displayName || 'this agent',
      }),
      composerPlaceholderWithoutTarget: input.t('Chat.agentComposerNoTargetPlaceholder', {
        defaultValue: 'Select an agent to start chatting…',
      }),
      voiceSpeakingLabel: input.t('Chat.voiceSessionSpeaking', {
        defaultValue: 'Speaking…',
      }),
      voiceHandsFreeLabel: input.t('Chat.voiceSessionHandsFreeActive', {
        defaultValue: 'Hands-free on (foreground only)',
      }),
      voiceListeningLabel: input.t('Chat.voiceSessionListening', {
        defaultValue: 'Listening',
      }),
      voiceTranscribingLabel: input.t('Chat.voiceSessionTranscribing', {
        defaultValue: 'Transcribing…',
      }),
    },
  }), [footerViewState, input.activeTarget, input.activeThreadId, input.composerReady, input.submittingThreadId, input.t, input.voiceCaptureState, input.voicePlaybackState, input.voiceSessionState, latestStatusCue, runtimeCommittedStatus]);
  const localAvatar = useAgentConversationLocalAvatarControls(input);
  const characterData = useMemo(() => ({
    ...surfaceState.character,
    theme: {
      roomSurface: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.94))',
      roomAura: 'linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,255,255,0.90))',
      appBackdropImageUrl: localAvatar.backdropImageUrl,
      accentSoft: 'rgba(148,163,184,0.12)',
      accentStrong: '#475569',
      border: 'rgba(148,163,184,0.20)',
      text: '#0f172a',
    },
  }), [localAvatar.backdropImageUrl, surfaceState.character]);
  const resolvedAgentDisplayName = useMemo(
    () =>
      characterData.name
      || input.activeTarget?.displayName
      || input.t('Chat.agentGenericIdentity', { defaultValue: 'Agent' }),
    [characterData.name, input.activeTarget?.displayName, input.t],
  );
  const canonicalMessages = useMemo(
    () => resolveAgentCanonicalMessages({
      messages: input.messages,
      activeThreadId: input.activeThreadId,
      activeConversationAnchorId: input.activeConversationAnchorId,
      activeTargetId: input.activeTarget?.localAgentRef || null,
      character: {
        name: characterData.name || 'Agent',
        avatarUrl: characterData.avatarUrl || null,
        handle: characterData.handle || null,
      },
    }),
    [characterData.avatarUrl, characterData.handle, characterData.name, input.activeConversationAnchorId, input.activeTarget?.localAgentRef, input.activeThreadId, input.messages],
  );
  const selectedTargetId = resolveAgentSelectedTargetId({
    selectionLocalAgentRef: input.inputSelectionLocalAgentRef,
    activeTargetId: input.selectedTargetId,
  });
  const handleStopGenerating = useCallback(() => {
    if (input.activeThreadId) {
      cancelStream(input.activeThreadId);
    }
  }, [input.activeThreadId]);
  const hostView = useMemo(() => resolveAgentConversationHostView({
    threads: targetSummaries,
    selectedTargetId,
    loading: input.isBundleLoading,
    error: input.bundleError instanceof Error ? input.bundleError.message : input.bundleError ? String(input.bundleError) : null,
    footerViewState: surfaceState.footer,
    footerContent: input.activeThreadId && surfaceState.footer.shouldRender
      ? (
        <RuntimeStreamFooter
          chatId={input.activeThreadId}
          assistantName={characterData.name}
          assistantAvatarUrl={characterData.avatarUrl || null}
          assistantKind="agent"
          streamState={input.streamState}
          optimisticWaiting={footerViewState.displayState === 'streaming'
            && footerViewState.pendingFirstBeat
            && (!input.streamState || input.streamState.phase === 'idle')}
          stopLabel={input.t('ChatTimeline.stopGenerating', 'Stop generating')}
          interruptedLabel={input.t('ChatTimeline.streamInterrupted', 'Response interrupted')}
          reasoningLabel={input.reasoningLabel}
          waitingLabel={input.t('Chat.agentSending', {
            defaultValue: 'The agent is replying...',
          })}
          showStreamingText={false}
        />
      )
      : null,
    labels: {
      emptyEyebrow: resolvedAgentDisplayName,
      emptyTitle: input.t('Chat.agentTranscriptEmptyTitle', {
        defaultValue: 'Start a conversation',
      }),
      emptyDescription: input.t('Chat.agentTranscriptEmpty', {
        defaultValue: 'Ask a question, share an idea, or tell this agent what you want to explore.',
      }),
      loadingLabel: input.t('Chat.agentTranscriptLoading', { defaultValue: 'Loading local agent conversation…' }),
    },
    transcriptWidthClassName: CHAT_CONTENT_WIDTH_CLASS,
    transcriptWidthPositionClassName: CHAT_CONTENT_POSITION_CLASS,
    transcriptContentPaddingBottomClassName: AGENT_TRANSCRIPT_BOTTOM_RESERVE_CLASS,
    renderMessageContent: input.renderMessageContent,
    renderMessageAccessory: input.renderMessageAccessory,
    onStopGenerating: handleStopGenerating,
  }), [
    characterData.avatarUrl,
    characterData.name,
    input.activeThreadId,
    input.bundleError,
    input.isBundleLoading,
    input.reasoningLabel,
    input.renderMessageAccessory,
    input.renderMessageContent,
    input.streamState,
    input.t,
    handleStopGenerating,
    selectedTargetId,
    surfaceState.footer,
    targetSummaries,
    resolvedAgentDisplayName,
  ]);
  const hostSnapshot = useMemo(() => resolveAgentConversationHostSnapshot({
    activeThreadId: input.activeThreadId,
    targets: targetSummaries,
    selectedTargetId: hostView.selectedTargetId ?? null,
    messages: canonicalMessages,
    characterData,
    hostView,
  }), [canonicalMessages, characterData, hostView, input.activeThreadId, targetSummaries]);
  const diagnosticsContent = <AgentConversationDiagnosticsContent input={input} />;
  const hostFeedbackNode = input.hostFeedback ? (
    <InlineFeedback feedback={input.hostFeedback} onDismiss={input.onDismissHostFeedback} />
  ) : null;
  const [schedulingDismissed, setSchedulingDismissed] = useState<string | null>(null);
  const schedulingKey = schedulingGuard.feedback?.message ?? null;
  const onDismissScheduling = useCallback(() => {
    setSchedulingDismissed(schedulingKey);
  }, [schedulingKey]);
  const schedulingFeedbackNode = schedulingGuard.feedback && schedulingKey !== schedulingDismissed ? (
    <InlineFeedback feedback={schedulingGuard.feedback} onDismiss={onDismissScheduling} />
  ) : null;
  const adapter = useMemo(() => ({
    mode: 'agent' as const,
    setupState: input.setupState,
    threadAdapter: {
      listThreads: () => [],
      listMessages: (threadId: string) => (
        input.bundle && input.bundle.thread.id === threadId
          ? input.messages
          : []
      ),
    },
    composerAdapter: surfaceState.composer
      ? {
        submit: (composerInput: ChatComposerSubmitInput<unknown>) => {
          void input.handleSubmit({
            text: composerInput.text,
            attachments: composerInput.attachments as readonly PendingAttachment[],
          });
        },
        disabled: surfaceState.composer.disabled || schedulingGuard.disabled,
        disabledReason: schedulingGuard.disabledReason || surfaceState.composer.disabledReason,
        placeholder: surfaceState.composer.placeholder,
      }
      : null,
  }), [input.bundle, input.handleSubmit, input.messages, input.setupState, schedulingGuard.disabled, schedulingGuard.disabledReason, surfaceState.composer]);
  return useMemo(() => ({
    ...hostSnapshot,
    adapter,
    stagePanelProps: undefined,
    topContent: schedulingFeedbackNode,
    settingsContent: (
      <AgentConversationSettingsContent
        input={input}
        diagnosticsContent={diagnosticsContent}
        avatarAssetValid={localAvatar.avatarAssetValid}
        backgroundValid={localAvatar.backgroundValid}
        avatarAssetChecking={localAvatar.avatarAssetChecking}
        avatarAssetConfig={localAvatar.avatarAssetConfig}
        avatarAssetValidationPresentation={localAvatar.avatarAssetValidationPresentation}
        avatarConfigMutation={localAvatar.avatarConfigMutation}
        avatarAssetImportMutation={localAvatar.avatarAssetImportMutation}
        avatarAssetLibraryQuery={localAvatar.avatarAssetLibraryQuery}
        avatarAssetSelectMutation={localAvatar.avatarAssetSelectMutation}
        avatarImportDisabled={localAvatar.avatarImportDisabled}
        avatarImportError={localAvatar.avatarImportError}
        clearAvatarAssetMutation={localAvatar.clearAvatarAssetMutation}
        live2dAdapterManifestImportMutation={localAvatar.live2dAdapterManifestImportMutation}
        selectedBackgroundAssetId={localAvatar.selectedBackgroundAssetId}
        backgroundAssetQuery={localAvatar.backgroundAssetQuery}
        backgroundValidation={localAvatar.backgroundValidation}
        backgroundImportError={localAvatar.backgroundImportError}
        clearBackgroundMutation={localAvatar.clearBackgroundMutation}
        backgroundImportDisabled={localAvatar.backgroundImportDisabled}
        backgroundImportMutation={localAvatar.backgroundImportMutation}
      />
    ),
    settingsDrawerTitle: input.t('Chat.agentCenterTitle', { defaultValue: 'Agent Center' }),
    settingsDrawerSubtitle: resolvedAgentDisplayName,
    settingsDrawerWorld: input.activeTarget?.worldName || null,
    composerContent: (
      adapter.composerAdapter ? (
        <div className="space-y-3">
          {hostFeedbackNode}
          <AgentCanonicalComposer
            composerKey={input.activeThreadId || 'none'}
            initialText={input.currentComposerTextRef.current}
            disabled={Boolean(input.submittingThreadId) || schedulingGuard.disabled}
            pendingAttachments={input.pendingAttachments}
            onAttachmentsChange={input.onAttachmentsChange}
            onSubmit={input.handleSubmit}
            voiceState={resolveAgentComposerVoiceState({
              state: input.voiceSessionState,
              onToggle: input.onVoiceSessionToggle,
              onCancel: input.onVoiceSessionCancel,
            })}
            placeholder={input.t('Chat.agentComposerPlaceholder', { defaultValue: 'Talk to this agent…' })}
            onInputCaptureText={(text) => {
              input.currentComposerTextRef.current = text;
            }}
            thinkingState={input.thinkingSupported
              ? (input.thinkingPreference === 'on' ? 'on' : 'off')
              : 'unsupported'}
            onThinkingToggle={() => input.setBehaviorSettings({
              ...input.behaviorSettings,
              thinkingPreference: input.thinkingPreference === 'on' ? 'off' : 'on',
            })}
            handsFreeState={{
              mode: input.voiceSessionState.mode,
              status: input.voiceSessionState.status,
              disabled: Boolean(input.submittingThreadId)
                || input.voiceSessionState.status === 'transcribing'
                || input.voiceSessionState.status === 'listening',
              onEnter: input.onEnterHandsFreeVoiceSession,
              onExit: input.onExitHandsFreeVoiceSession,
            }}
            leadingSlot={(
              <ChatComposerLeadingAvatar
                kind="agent"
                name={resolvedAgentDisplayName}
                imageUrl={characterData.avatarUrl || null}
                fallbackLabel={characterData.avatarFallback || resolvedAgentDisplayName}
                preview={input.activeTarget?.localAgentRef ? {
                  targetId: input.activeTarget.localAgentRef,
                  handle: characterData.handle || null,
                  worldName: input.activeTarget.worldName || null,
                } : null}
              />
            )}
            avatarAction={{
              state: localAvatar.avatarComposerActionState,
              onConfigure: input.onOpenAgentCenter,
              onActivate: localAvatar.handleComposerAvatarAction,
            }}
            widthClassName={CHAT_CONTENT_WIDTH_CLASS}
            widthPositionClassName={CHAT_CONTENT_POSITION_CLASS}
          />
        </div>
      ) : null
    ),
    thinkingState: input.thinkingSupported
      ? (input.thinkingPreference === 'on' ? 'on' : 'off')
      : 'unsupported',
    onThinkingToggle: () => input.setBehaviorSettings({
      ...input.behaviorSettings,
      thinkingPreference: input.thinkingPreference === 'on' ? 'off' : 'on',
    }),
    setupDescription: input.t('Chat.agentRouteRequired', {
      defaultValue: 'Agent mode requires a local or cloud runtime route. Configure one in runtime settings.',
    }),
  }), [
    adapter,
    diagnosticsContent,
    hostFeedbackNode,
    schedulingFeedbackNode,
    hostSnapshot,
    characterData.name,
    characterData.avatarUrl,
    characterData.avatarFallback,
    localAvatar,
    input.activeTarget,
    input.activeConversationAnchorId,
    input.activeThreadId,
    input.agentRouteReady,
    input.mutationPendingAction,
    input.behaviorSettings,
    input.currentComposerTextRef,
    input.handleSubmit,
    input.onAttachmentsChange,
    input.onDismissHostFeedback,
    input.onEnableAutonomy,
    input.onDisableAutonomy,
    input.onUpdateAutonomyConfig,
    input.onEnterHandsFreeVoiceSession,
    input.onExitHandsFreeVoiceSession,
    input.setBehaviorSettings,
    input.submittingThreadId,
    input.t,
    input.thinkingPreference,
    input.thinkingSupported,
    input.thinkingUnsupportedReason,
    input.voiceSessionState,
    input.onVoiceSessionToggle,
    input.onVoiceSessionCancel,
    input.initialModelSelection,
    input.onModelSelectionChange,
    input.pendingAttachments,
    selectedTargetId,
    schedulingGuard.disabled,
    resolvedAgentDisplayName,
    input.cognitionContent,
    input.onOpenAgentCenter,
  ]);
}
