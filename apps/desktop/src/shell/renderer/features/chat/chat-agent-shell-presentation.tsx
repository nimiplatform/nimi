import { useCallback, useMemo, useState, type MouseEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  type ChatComposerSubmitInput,
} from '@nimiplatform/nimi-kit/features/chat';
import type {
  CanonicalMessageAccessorySlot,
  CanonicalMessageContentSlot,
  ConversationCanonicalMessage,
  ConversationMessageViewModel,
  ConversationSetupState,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import { useTranslation } from 'react-i18next';
import type {
  AgentLocalTargetSnapshot,
  AgentLocalThreadBundle,
  AgentLocalThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import type { DesktopConversationModeHost } from './chat-shared-mode-host-types';
import { ChatSettingsPanel } from './chat-shared-settings-panel';
import { RuntimeStreamFooter } from './chat-shared-runtime-stream-ui';
import { ChatAgentAvatarSettingsPanel } from './chat-agent-avatar-settings-panel';
import {
  desktopAgentBackdropBindingQueryKey,
  getDesktopAgentBackdropBinding,
} from '@renderer/bridge/runtime-bridge/chat-agent-backdrop-store';
import { cancelStream } from '../turns/stream-controller';
import type { AgentConversationSelection } from './chat-shell-types';
import type { AgentHostFlowFooterState } from './chat-agent-shell-host-flow';
import { createInitialAgentTurnLifecycleState, type AgentTurnLifecycleState } from './chat-agent-shell-lifecycle';
import { parseAgentTextTurnDebugMetadata } from './chat-agent-debug-metadata';
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
import { toConversationThreadSummary } from './chat-agent-thread-model';
import type { InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import { InlineFeedback } from '@renderer/ui/feedback/inline-feedback';
import type { ChatThinkingPreference } from './chat-shared-thinking';
import type { StreamState } from '../turns/stream-controller';
import type { RouteModelPickerSelection } from '@nimiplatform/nimi-kit/features/model-picker';
import type { AISchedulingJudgement } from '@nimiplatform/sdk/mod';
import { resolveExecutionSchedulingGuardDecision } from './chat-shared-execution-scheduling-guard';
import type { AgentChatExperienceSettings } from './chat-settings-storage';
import type {
  RuntimeAgentInspectEventSummary,
  RuntimeAgentInspectSnapshot,
} from '@renderer/infra/runtime-agent-inspect';
import {
  resolveAgentComposerVoiceState,
  type AgentVoiceSessionShellState,
} from './chat-agent-voice-session';
import type { PendingAttachment } from '../turns/turn-input-attachments';
import { AgentCanonicalComposer } from './chat-agent-canonical-composer';
import { AgentDiagnosticsPanel } from './chat-agent-diagnostics';
import { ChatComposerLeadingAvatar } from './chat-shared-composer-leading-avatar';
import { CHAT_CONTENT_POSITION_CLASS } from './chat-shared-content-layout';

type UseAgentConversationPresentationInput = {
  activeTarget: AgentLocalTargetSnapshot | null;
  activeThreadId: string | null;
  activeConversationAnchorId: string | null;
  bundle: AgentLocalThreadBundle | null;
  bundleError: unknown;
  composerReady: boolean;
  currentDraftTextRef: { current: string };
  currentFooterHostState: {
    footerState: AgentHostFlowFooterState;
    lifecycle: AgentTurnLifecycleState;
  } | null;
  mutationPendingAction: string | null;
  onCancelPendingHook: (hookId: string) => void;
  onClearDyadicContext: () => void;
  onClearWorldContext: () => void;
  onDisableAutonomy: () => void;
  onEnableAutonomy: () => void;
  onRefreshInspect: () => void;
  onUpdateRuntimeState: (input: { statusText: string; worldId: string; userId: string }) => void;
  onUpdateAutonomyConfig: (input: { mode: string; dailyTokenBudget: string; maxTokensPerHook: string }) => void;
  recentRuntimeEvents: readonly RuntimeAgentInspectEventSummary[];
  handleSubmit: (input: { text: string; attachments: readonly PendingAttachment[] }) => Promise<void>;
  hostFeedback: InlineFeedbackState | null;
  initialModelSelection?: Partial<RouteModelPickerSelection>;
  inputSelectionAgentId: AgentConversationSelection['agentId'];
  isBundleLoading: boolean;
  messages: readonly ConversationMessageViewModel[];
  pendingAttachments: readonly PendingAttachment[];
  onDismissHostFeedback: () => void;
  onAttachmentsChange: (attachments: readonly PendingAttachment[]) => void;
  onMessageContextMenu?: (message: ConversationCanonicalMessage, event: MouseEvent<HTMLDivElement>) => void;
  onModelSelectionChange: (selection: RouteModelPickerSelection) => void;
  reasoningLabel: string;
  renderMessageAccessory?: CanonicalMessageAccessorySlot;
  renderMessageContent: CanonicalMessageContentSlot;
  routeReady: boolean;
  runtimeInspect: RuntimeAgentInspectSnapshot | null;
  runtimeInspectLoading: boolean;
  schedulingJudgement: AISchedulingJudgement | null;
  selectedTargetId: string | null;
  behaviorSettings: AgentChatExperienceSettings;
  setBehaviorSettings: (value: AgentChatExperienceSettings) => void;
  onDiagnosticsVisibilityChange?: (visible: boolean) => void;
  voiceSessionState: AgentVoiceSessionShellState;
  voiceCaptureState: {
    active: boolean;
    amplitude: number;
  } | null;
  voicePlaybackState: {
    conversationAnchorId: string;
    messageId: string;
    active: boolean;
    amplitude: number;
    visemeId: 'aa' | 'ee' | 'ih' | 'oh' | 'ou' | null;
  } | null;
  onVoiceSessionToggle: () => void;
  onVoiceSessionCancel: () => void;
  onEnterHandsFreeVoiceSession: () => void;
  onExitHandsFreeVoiceSession: () => void;
  setupState: ConversationSetupState;
  streamState: StreamState | null;
  submittingThreadId: string | null;
  t: ReturnType<typeof useTranslation>['t'];
  targetSummariesInput: {
    targets: readonly AgentLocalTargetSnapshot[];
    threads: readonly AgentLocalThreadSummary[];
  };
  targetsPending: boolean;
  thinkingPreference: ChatThinkingPreference;
  thinkingSupported: boolean;
  thinkingUnsupportedReason: string | null;
  agentRouteReady: boolean;
  clearChatsTargetName?: string | null;
  clearChatsDisabled?: boolean;
  onClearAgentHistory?: () => Promise<void> | void;
};

const AGENT_TRANSCRIPT_WIDTH_CLASS = 'max-w-[min(680px,calc(100vw-680px))]';
const AGENT_TRANSCRIPT_POSITION_CLASS = CHAT_CONTENT_POSITION_CLASS;
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
    const messages = input.bundle?.messages || [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || message.role !== 'assistant' || message.kind !== 'text' || message.status !== 'complete') {
        continue;
      }
      const metadata = parseAgentTextTurnDebugMetadata(message.metadataJson);
      if (metadata?.statusCue) {
        return metadata.statusCue;
      }
    }
    return null;
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
  const backdropBindingQuery = useQuery({
    queryKey: input.activeTarget?.agentId
      ? desktopAgentBackdropBindingQueryKey(input.activeTarget.agentId)
      : ['desktop-agent-backdrop-binding', 'none'],
    queryFn: async () => (
      input.activeTarget?.agentId
        ? getDesktopAgentBackdropBinding(input.activeTarget.agentId)
        : null
    ),
    enabled: Boolean(input.activeTarget?.agentId),
    staleTime: 30_000,
  });
  // Rust store returns a `file://` URL; Tauri 2 webview cannot load `file://`
  // assets directly under CSP. Convert to the allowed `asset://localhost/...`
  // protocol (scope registered in tauri.conf.json).
  const rawBackdropFileUrl = backdropBindingQuery.data?.fileUrl;
  const backdropImageUrl = rawBackdropFileUrl
    ? rawBackdropFileUrl.startsWith('file://')
      ? rawBackdropFileUrl.replace(/^file:\/\//, 'asset://localhost')
      : rawBackdropFileUrl
    : undefined;
  const characterData = useMemo(() => ({
    ...surfaceState.character,
    theme: {
      roomSurface: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.94))',
      roomAura: 'linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,255,255,0.90))',
      appBackdropImageUrl: backdropImageUrl,
      accentSoft: 'rgba(148,163,184,0.12)',
      accentStrong: '#475569',
      border: 'rgba(148,163,184,0.20)',
      text: '#0f172a',
    },
  }), [backdropImageUrl, surfaceState.character]);
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
      activeTargetId: input.activeTarget?.agentId || null,
      character: {
        name: characterData.name || 'Agent',
        avatarUrl: characterData.avatarUrl || null,
        handle: characterData.handle || null,
      },
    }),
    [characterData.avatarUrl, characterData.handle, characterData.name, input.activeConversationAnchorId, input.activeTarget?.agentId, input.activeThreadId, input.messages],
  );
  const selectedTargetId = resolveAgentSelectedTargetId({
    selectionAgentId: input.inputSelectionAgentId,
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
        defaultValue: 'Say hello when you are ready',
      }),
      emptyDescription: input.t('Chat.agentTranscriptEmpty', {
        defaultValue: 'Say hello, ask a question, or start with whatever is on your mind.',
      }),
      loadingLabel: input.t('Chat.agentTranscriptLoading', { defaultValue: 'Loading local agent conversation…' }),
    },
    transcriptWidthClassName: AGENT_TRANSCRIPT_WIDTH_CLASS,
    transcriptWidthPositionClassName: AGENT_TRANSCRIPT_POSITION_CLASS,
    transcriptScrollViewportWidthClassName: AGENT_TRANSCRIPT_WIDTH_CLASS,
    transcriptScrollViewportPositionClassName: AGENT_TRANSCRIPT_POSITION_CLASS,
    transcriptContentPaddingBottomClassName: AGENT_TRANSCRIPT_BOTTOM_RESERVE_CLASS,
    renderMessageContent: input.renderMessageContent,
    renderMessageAccessory: input.renderMessageAccessory,
    onMessageContextMenu: input.onMessageContextMenu,
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
    input.onMessageContextMenu,
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
  const diagnosticsContent = useMemo(() => (
    <AgentDiagnosticsPanel
      activeTarget={input.activeTarget}
      lifecycle={input.currentFooterHostState?.lifecycle || null}
      mutationPendingAction={input.mutationPendingAction}
      onCancelHook={input.onCancelPendingHook}
      onClearDyadicContext={input.onClearDyadicContext}
      onClearWorldContext={input.onClearWorldContext}
      onDisableAutonomy={input.onDisableAutonomy}
      onEnableAutonomy={input.onEnableAutonomy}
      onRefreshInspect={input.onRefreshInspect}
      onUpdateRuntimeState={input.onUpdateRuntimeState}
      onUpdateAutonomyConfig={input.onUpdateAutonomyConfig}
      recentRuntimeEvents={input.recentRuntimeEvents}
      routeReady={input.routeReady}
      runtimeInspect={input.runtimeInspect}
      runtimeInspectLoading={input.runtimeInspectLoading}
      t={input.t}
      targetsPending={input.targetsPending}
    />
  ), [
    input.activeTarget,
    input.currentFooterHostState?.lifecycle,
    input.mutationPendingAction,
    input.onCancelPendingHook,
    input.onClearDyadicContext,
    input.onClearWorldContext,
    input.onDisableAutonomy,
    input.onEnableAutonomy,
    input.onRefreshInspect,
    input.onUpdateRuntimeState,
    input.onUpdateAutonomyConfig,
    input.recentRuntimeEvents,
    input.routeReady,
    input.runtimeInspect,
    input.runtimeInspectLoading,
    input.t,
    input.targetsPending,
  ]);
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
      listThreads: () => input.targetSummariesInput.threads.map((thread) => toConversationThreadSummary(thread)),
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
  }), [input.bundle, input.handleSubmit, input.messages, input.setupState, input.targetSummariesInput.threads, schedulingGuard.disabled, schedulingGuard.disabledReason, surfaceState.composer]);
  return useMemo(() => ({
    ...hostSnapshot,
    adapter,
    stagePanelProps: undefined,
    topContent: schedulingFeedbackNode,
    settingsContent: (
      <ChatSettingsPanel
        onDiagnosticsVisibilityChange={input.onDiagnosticsVisibilityChange}
        onModelSelectionChange={input.onModelSelectionChange}
        initialModelSelection={input.initialModelSelection}
        diagnosticsContent={diagnosticsContent}
        presenceContent={(
          <ChatAgentAvatarSettingsPanel
            selectedTarget={input.activeTarget
              ? {
                id: input.activeTarget.agentId,
                title: input.activeTarget.displayName || resolvedAgentDisplayName,
              }
              : null}
            activeThreadId={input.activeThreadId}
            activeConversationAnchorId={input.activeConversationAnchorId}
            presentationProfile={input.runtimeInspect?.presentationProfile || input.activeTarget?.presentationProfile || null}
            onRefreshInspect={input.onRefreshInspect}
          />
        )}
        clearChatsTargetName={input.clearChatsTargetName}
        clearChatsDisabled={input.clearChatsDisabled}
        onClearAgentHistory={input.onClearAgentHistory}
      />
    ),
    composerContent: (
      adapter.composerAdapter ? (
        <div className="space-y-3">
          {hostFeedbackNode}
          <AgentCanonicalComposer
            composerKey={`${input.activeThreadId || 'none'}:${input.bundle?.draft?.updatedAtMs || 0}`}
            initialText={input.bundle?.draft?.text || ''}
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
              input.currentDraftTextRef.current = text;
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
              />
            )}
            widthClassName={AGENT_TRANSCRIPT_WIDTH_CLASS}
            widthPositionClassName={AGENT_TRANSCRIPT_POSITION_CLASS}
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
    input.activeTarget,
    input.activeConversationAnchorId,
    input.activeThreadId,
    input.agentRouteReady,
    input.behaviorSettings,
    input.bundle?.draft?.text,
    input.bundle?.draft?.updatedAtMs,
    input.currentDraftTextRef,
    input.handleSubmit,
    input.onAttachmentsChange,
    input.onDismissHostFeedback,
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
    input.clearChatsTargetName,
    input.clearChatsDisabled,
    input.onClearAgentHistory,
  ]);
}
