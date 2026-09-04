import { useCallback, useMemo } from 'react';
import {
  type ChatComposerSubmitInput,
} from '@nimiplatform/kit/features/chat/headless';
import type { DesktopConversationModeHost } from './chat-shared-mode-host-types';
import { RuntimeStreamFooter } from './chat-shared-runtime-stream-ui';
import { useStreamController } from '../turns/stream-controller-context.js';
import { createInitialAgentTurnLifecycleState } from './chat-agent-shell-lifecycle';
import { resolveLatestAgentStatusCue } from './chat-agent-shell-presentation-status';
import {
  isAgentStreamCancelReady,
  resolveAgentFooterViewState,
} from './chat-agent-shell-footer-state';
import { resolveAgentConversationSurfaceState } from './chat-agent-shell-visible-state';
import { resolveAgentConversationHostView } from './chat-agent-shell-host-view';
import { resolveAgentConversationHostSnapshot } from './chat-agent-shell-host-snapshot';
import {
  resolveAgentCanonicalMessages,
  resolveAgentCharacterProfilePreviewTarget,
  resolveAgentSelectedTargetId,
  resolveAgentTargetSummaries,
} from './chat-agent-shell-view-model';
import { InlineFeedback } from '../../ui/feedback/inline-feedback';
import { ChevronRight } from 'lucide-react';
import { AgentCanonicalComposer } from './chat-agent-canonical-composer';
import { AgentEmptyCharacterVoiceButton } from './chat-agent-empty-character-voice.js';
import { AgentConversationSettingsContent } from './chat-agent-shell-presentation-settings';
import { useAgentConversationLocalAvatarControls } from './chat-agent-shell-local-avatar-controls';
import { ChatComposerLeadingAvatar } from './chat-shared-composer-leading-avatar';
import { CHAT_CONTENT_POSITION_CLASS, CHAT_CONTENT_WIDTH_CLASS, CHAT_TRANSCRIPT_BOTTOM_RESERVE_CLASS } from './chat-shared-content-layout';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';
import type { PendingAttachment } from '../turns/turn-input-attachments';
import { resolveAgentComposerVoiceState } from './chat-agent-voice-session.js';

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
  const streamController = useStreamController();
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
  const surfaceState = useMemo(() => resolveAgentConversationSurfaceState({
    composerReady: input.composerReady,
    activeTarget: input.activeTarget,
    activeThreadId: input.activeThreadId,
    activeConversationAnchorId: input.activeConversationAnchorId,
    submittingThreadId: input.submittingThreadId,
    voiceCaptureState: input.voiceInput.captureState,
    voicePlaybackState: null,
    voiceSessionState: input.voiceInput.state,
    latestStatusCue,
    runtimeCommittedStatus: input.runtimeCommittedStatus,
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
  }), [footerViewState, input.activeConversationAnchorId, input.activeTarget, input.activeThreadId, input.composerReady, input.runtimeCommittedStatus, input.submittingThreadId, input.t, input.voiceInput.captureState, input.voiceInput.state, latestStatusCue]);
  const localAvatar = useAgentConversationLocalAvatarControls(input);
  const characterData = useMemo(() => ({
    ...surfaceState.character,
    theme: {
      roomSurface: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.94))',
      roomAura: 'linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,255,255,0.90))',
      ...(localAvatar.backdropImageUrl ? { appBackdropImageUrl: localAvatar.backdropImageUrl } : {}),
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
  const characterProfilePreviewTarget = useMemo(
    () => resolveAgentCharacterProfilePreviewTarget(input.activeTarget),
    [input.activeTarget],
  );
  const canonicalMessages = useMemo(
    () => resolveAgentCanonicalMessages({
      messages: input.messages,
      activeThreadId: input.activeThreadId,
      activeConversationAnchorId: input.activeConversationAnchorId,
      activeTargetId: input.activeTarget?.agentHandle || null,
      character: {
        name: characterData.name || 'Agent',
        avatarUrl: characterData.avatarUrl || null,
        handle: characterData.handle || null,
      },
    }),
    [characterData.avatarUrl, characterData.handle, characterData.name, input.activeConversationAnchorId, input.activeTarget?.agentHandle, input.activeThreadId, input.messages],
  );
  const selectedTargetId = resolveAgentSelectedTargetId({
    selectionAgentHandle: input.inputSelectionAgentHandle,
    activeTargetId: input.selectedTargetId,
  });
  const stopGeneratingReady = isAgentStreamCancelReady(input.streamState);
  const handleStopGenerating = useCallback(() => {
    if (input.activeThreadId && stopGeneratingReady) {
      streamController.cancelStream(input.activeThreadId);
    }
  }, [input.activeThreadId, stopGeneratingReady, streamController]);
  const emptyStateAgent = useMemo(() => {
    const presence = input.emptyStateCharacterPresence;
    if (presence && (presence.referenceImageUrl || presence.greeting || presence.voiceSampleUrl)) {
      return null;
    }
    return {
      displayName: resolvedAgentDisplayName,
      avatarUrl: characterData.avatarUrl || null,
    };
  }, [characterData.avatarUrl, input.emptyStateCharacterPresence, resolvedAgentDisplayName]);
  const emptyStateSuggestions = useMemo(() => {
    const onPrefillRequest = input.onComposerPrefillRequest;
    if (!input.activeTarget || !surfaceState.composer || surfaceState.composer.disabled || !onPrefillRequest) {
      return null;
    }
    const presence = input.emptyStateCharacterPresence ?? null;
    const suggestions = presence && presence.questions.length > 0
      ? presence.questions
      : [
        input.t('Chat.agentEmptySuggestionIntroduce', { defaultValue: 'Introduce yourself' }),
        input.t('Chat.agentEmptySuggestionCasual', { defaultValue: 'Chat with me for a while' }),
        input.t('Chat.agentEmptySuggestionStory', { defaultValue: 'Tell me an interesting story' }),
      ];
    const suggestionChips = (
      <div className="flex flex-wrap items-center justify-center gap-2.5" data-agent-empty-suggestions="true">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onPrefillRequest(suggestion)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_72%,transparent)] pl-4 pr-3 text-sm font-medium text-[var(--nimi-text-secondary)] transition-[background-color,border-color,color,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_35%,transparent)] hover:bg-[var(--nimi-surface-card)] hover:text-[var(--nimi-text-primary)] active:scale-[var(--nimi-motion-pressed-scale)]"
          >
            {suggestion}
            <ChevronRight aria-hidden className="h-[14px] w-[14px] opacity-50" strokeWidth={2.2} />
          </button>
        ))}
      </div>
    );
    const hasPresenceMedia = Boolean(
      presence && (presence.referenceImageUrl || presence.greeting || presence.voiceSampleUrl),
    );
    if (!presence || !hasPresenceMedia) {
      return suggestionChips;
    }
    return (
      <div className="flex w-full flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-1.5" data-agent-empty-character-header="true">
          <h2 className="text-[length:var(--nimi-type-hero-title-size)] font-[var(--nimi-type-hero-title-weight)] leading-tight tracking-tight text-[var(--nimi-text-primary)]">
            {resolvedAgentDisplayName}
          </h2>
          {presence.heroSubtitle ? (
            <p className="text-sm text-[var(--nimi-text-muted)]">{presence.heroSubtitle}</p>
          ) : null}
        </div>
        <div className="relative flex w-full max-w-[420px] flex-col" data-agent-empty-character-media="true">
          <div
            aria-hidden="true"
            className="absolute -inset-8 -z-10 rounded-[40px] bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent),transparent)] blur-2xl"
          />
          {presence.referenceImageUrl ? (
            <div
              data-agent-empty-character-image="true"
              className="relative aspect-square w-full overflow-hidden rounded-[24px] bg-[var(--nimi-surface-panel)] shadow-[0_24px_56px_-20px_rgba(15,23,42,0.30)] ring-1 ring-black/5"
            >
              <img
                src={presence.referenceImageUrl}
                alt=""
                className="h-full w-full object-cover object-top"
              />
              {presence.voiceSampleUrl ? (
                <div className="absolute right-3.5 top-3.5">
                  <AgentEmptyCharacterVoiceButton
                    src={presence.voiceSampleUrl}
                    durationSec={presence.voiceSampleDurationSec}
                    autoPlay
                    variant="overlay"
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          {presence.greeting ? (
            <p
              data-agent-empty-character-greeting="true"
              className={`${presence.referenceImageUrl ? 'mt-5 ' : ''}w-full text-center text-[15px] leading-7 text-[var(--nimi-text-primary)]`}
            >
              {presence.greeting}
            </p>
          ) : null}
          {!presence.referenceImageUrl && presence.voiceSampleUrl ? (
            <div className="mt-2.5 flex justify-center">
              <AgentEmptyCharacterVoiceButton
                src={presence.voiceSampleUrl}
                durationSec={presence.voiceSampleDurationSec}
                autoPlay
              />
            </div>
          ) : null}
        </div>
        {suggestionChips}
      </div>
    );
  }, [input.activeTarget, input.emptyStateCharacterPresence, input.onComposerPrefillRequest, input.t, resolvedAgentDisplayName, surfaceState.composer]);
  const emptyStateHeaderLabels = useMemo(() => {
    const presence = input.emptyStateCharacterPresence;
    const hasPresenceMedia = Boolean(
      presence && (presence.referenceImageUrl || presence.greeting || presence.voiceSampleUrl),
    );
    return {
      emptyEyebrow: hasPresenceMedia ? '' : resolvedAgentDisplayName,
      emptyTitle: hasPresenceMedia
        ? ''
        : input.t('Chat.agentTranscriptEmptyTitle', {
          defaultValue: 'Start a conversation',
        }),
      emptyDescription: hasPresenceMedia
        ? ''
        : input.t('Chat.agentTranscriptEmpty', {
          defaultValue: 'Ask a question, share an idea, or tell this agent what you want to explore.',
        }),
    };
  }, [input.emptyStateCharacterPresence, input.t, resolvedAgentDisplayName]);
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
          waitingWarningLabel={input.t(
            'ChatTimeline.firstContentWaitingWarning',
            'The response is taking longer than usual. Still waiting...',
          )}
          showStreamingText={false}
        />
      )
      : null,
    labels: {
      ...emptyStateHeaderLabels,
      loadingLabel: input.t('Chat.agentTranscriptLoading', { defaultValue: 'Loading local agent conversation…' }),
      pendingAgentRoleLabel: input.t('Chat.agentTranscriptPendingRole', { defaultValue: 'Agent is replying' }),
      pendingThinkingLabel: input.t('Chat.agentTranscriptThinking', { defaultValue: 'Thinking...' }),
      pendingStopLabel: input.t('Chat.agentTranscriptStopGenerating', { defaultValue: 'Stop generating' }),
      todayLabel: input.t('Chat.today', { defaultValue: 'Today' }),
      yesterdayLabel: input.t('Chat.yesterday', { defaultValue: 'Yesterday' }),
    },
    emptyStateAgent,
    emptyStateContent: emptyStateSuggestions,
    transcriptWidthClassName: CHAT_CONTENT_WIDTH_CLASS,
    transcriptWidthPositionClassName: CHAT_CONTENT_POSITION_CLASS,
    transcriptContentPaddingBottomClassName: CHAT_TRANSCRIPT_BOTTOM_RESERVE_CLASS,
    renderMessageContent: input.renderMessageContent,
    renderMessageAccessory: input.renderMessageAccessory,
    onStopGenerating: stopGeneratingReady ? handleStopGenerating : undefined,
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
    stopGeneratingReady,
    selectedTargetId,
    surfaceState.footer,
    targetSummaries,
    resolvedAgentDisplayName,
    emptyStateAgent,
    emptyStateHeaderLabels,
    emptyStateSuggestions,
  ]);
  const hostSnapshot = useMemo(() => resolveAgentConversationHostSnapshot({
    activeThreadId: input.activeThreadId,
    targets: targetSummaries,
    selectedTargetId: hostView.selectedTargetId ?? null,
    messages: canonicalMessages,
    characterData,
    hostView,
  }), [canonicalMessages, characterData, hostView, input.activeThreadId, targetSummaries]);
  const hostFeedbackNode = input.hostFeedback ? (
    <InlineFeedback feedback={input.hostFeedback} onDismiss={input.onDismissHostFeedback} />
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
        submit: (composerInput: ChatComposerSubmitInput<unknown>) => input.handleSubmit({
          text: composerInput.text,
          attachments: composerInput.attachments as readonly PendingAttachment[],
        }),
        disabled: surfaceState.composer.disabled,
        disabledReason: surfaceState.composer.disabledReason,
        placeholder: surfaceState.composer.placeholder,
      }
      : null,
  }), [input.bundle, input.handleSubmit, input.messages, input.setupState, surfaceState.composer]);
  return useMemo(() => ({
    ...hostSnapshot,
    adapter,
    stagePanelProps: undefined,
    topContent: undefined,
    settingsContent: (
      <AgentConversationSettingsContent input={input} />
    ),
    settingsDrawerTitle: input.t('Chat.agentCenterTitle', { defaultValue: 'Agent Center' }),
    settingsDrawerSubtitle: resolvedAgentDisplayName,
    settingsDrawerWorld: input.activeTarget?.worldName || null,
    composerContent: (
      adapter.composerAdapter ? (
        <div className="space-y-3">
          {hostFeedbackNode}
          <AgentCanonicalComposer
            composerKey={`${input.activeThreadId || 'none'}:${input.composerPrefillRequestId ?? 0}`}
            initialText={input.currentComposerTextRef.current}
            disabled={Boolean(surfaceState.composer?.disabled)}
            runtimeHint={surfaceState.composer?.disabledReason && !input.submittingThreadId
              ? surfaceState.composer.disabledReason
              : null}
            pendingAttachments={input.pendingAttachments}
            onAttachmentsChange={input.onAttachmentsChange}
            onSubmit={input.handleSubmit}
            voiceState={input.voiceInput.available
              ? resolveAgentComposerVoiceState({
                state: input.voiceInput.state,
                onToggle: input.voiceInput.onToggle,
                onCancel: input.voiceInput.onCancel,
                transcript: input.voiceInput.transcript,
              })
              : undefined}
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
            leadingSlot={(
              <ChatComposerLeadingAvatar
                kind="agent"
                name={resolvedAgentDisplayName}
                imageUrl={characterData.avatarUrl || null}
                fallbackLabel={characterData.avatarFallback || resolvedAgentDisplayName}
                preview={characterProfilePreviewTarget}
              />
            )}
            avatarAction={{
              state: localAvatar.avatarComposerActionState,
              onConfigure: input.onOpenAgentCenter,
              onActivate: localAvatar.handleComposerAvatarAction,
            }}
            agentCenterOpen={input.agentCenterOpen}
            onOpenAgentCenter={input.runtimeAgentCenterAdapter
              ? (input.agentCenterOpen && input.onCloseAgentCenter
                ? input.onCloseAgentCenter
                : input.onOpenAgentCenter)
              : undefined}
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
    setupDescription: input.t('Chat.agentSetupDescription', {
      defaultValue: 'Sign in to your Nimi account to start chatting with your partners.',
    }),
    setupEyebrow: input.t('Chat.mode.agent', { defaultValue: 'Partner' }),
    setupTitle: input.t('Chat.agentSetupTitle', { defaultValue: 'Sign in to chat with partners' }),
    setupActionLabel: input.t('Chat.agentSetupAction', { defaultValue: 'Sign in' }),
    setupDiagnosticsLabel: input.t('Chat.settingsTechnicalDetails', { defaultValue: 'Technical details' }),
  }), [
    adapter,
    hostFeedbackNode,
    hostSnapshot,
    characterData.name,
    characterData.avatarUrl,
    characterData.avatarFallback,
    localAvatar,
    input.activeTarget,
    input.activeConversationAnchorId,
    input.activeThreadId,
    input.composerPrefillRequestId,
    input.behaviorSettings,
    input.currentComposerTextRef,
    input.handleSubmit,
    input.onAttachmentsChange,
    input.onDismissHostFeedback,
    input.setBehaviorSettings,
    input.submittingThreadId,
    input.t,
    input.thinkingPreference,
    input.thinkingSupported,
    input.thinkingUnsupportedReason,
    input.pendingAttachments,
    input.voiceInput,
    selectedTargetId,
    surfaceState.composer,
    resolvedAgentDisplayName,
    input.onOpenAgentCenter,
    input.onCloseAgentCenter,
    input.agentCenterOpen,
    characterProfilePreviewTarget,
  ]);
}
