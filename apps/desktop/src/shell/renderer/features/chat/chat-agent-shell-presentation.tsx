import { useCallback, useMemo, useState, type MouseEvent } from 'react';
import { Avatar, Tooltip } from '@nimiplatform/nimi-kit/ui';
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
import type { DesktopConversationModeHost } from './chat-mode-host-types';
import { ChatSettingsPanel } from './chat-settings-panel';
import { RuntimeStreamFooter } from './chat-runtime-stream-ui';
import { ChatAgentAvatarBindingSettings } from './chat-agent-avatar-binding-settings';
import { cancelStream } from '../turns/stream-controller';
import type { AgentConversationSelection } from './chat-shell-types';
import type { AgentHostFlowFooterState } from './chat-agent-shell-host-flow';
import { createInitialAgentTurnLifecycleState, type AgentTurnLifecycleState } from './chat-agent-shell-lifecycle';
import { resolveAgentFooterViewState } from './chat-agent-shell-footer-state';
import { resolveAgentConversationSurfaceState } from './chat-agent-shell-visible-state';
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
import type { ChatThinkingPreference } from './chat-thinking';
import type { StreamState } from '../turns/stream-controller';
import type { RouteModelPickerSelection } from '@nimiplatform/nimi-kit/features/model-picker';
import type { AISchedulingJudgement } from '@nimiplatform/sdk/mod';
import { resolveExecutionSchedulingGuardDecision } from './chat-execution-scheduling-guard';
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

type UseAgentConversationPresentationInput = {
  activeTarget: AgentLocalTargetSnapshot | null;
  activeThreadId: string | null;
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
  onUpdateAutonomyConfig: (input: { dailyTokenBudget: string; maxTokensPerHook: string }) => void;
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
    threadId: string;
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
};

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
  const surfaceState = useMemo(() => resolveAgentConversationSurfaceState({
    composerReady: input.composerReady,
    activeTarget: input.activeTarget,
    activeThreadId: input.activeThreadId,
    submittingThreadId: input.submittingThreadId,
    voiceCaptureState: input.voiceCaptureState,
    voicePlaybackState: input.voicePlaybackState,
    voiceSessionState: input.voiceSessionState,
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
  }), [footerViewState, input.activeTarget, input.activeThreadId, input.composerReady, input.submittingThreadId, input.t, input.voiceCaptureState, input.voicePlaybackState, input.voiceSessionState]);
  const characterData = useMemo(() => ({
    ...surfaceState.character,
    theme: {
      roomSurface: 'linear-gradient(180deg, rgba(250,252,252,0.98), rgba(244,247,248,0.96))',
      roomAura: 'linear-gradient(135deg,rgba(255,255,255,0.9),rgba(236,253,245,0.78))',
      accentSoft: 'rgba(16,185,129,0.20)',
      accentStrong: '#10b981',
      border: 'rgba(16,185,129,0.34)',
      text: '#065f46',
    },
  }), [surfaceState.character]);
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
      activeTargetId: input.activeTarget?.agentId || null,
      character: {
        name: characterData.name || 'Agent',
        avatarUrl: characterData.avatarUrl || null,
        handle: characterData.handle || null,
      },
    }),
    [characterData.avatarUrl, characterData.handle, characterData.name, input.activeTarget?.agentId, input.activeThreadId, input.messages],
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
    settingsContent: (
      <div className="space-y-4">
        <ChatSettingsPanel
          onDiagnosticsVisibilityChange={input.onDiagnosticsVisibilityChange}
          onModelSelectionChange={input.onModelSelectionChange}
          initialModelSelection={input.initialModelSelection}
          diagnosticsContent={diagnosticsContent}
          presenceContent={(
            <ChatAgentAvatarBindingSettings
              agentId={selectedTargetId || input.activeTarget?.agentId || null}
              agentName={characterData.name || input.activeTarget?.displayName || null}
            />
          )}
        />
      </div>
    ),
    topContent: schedulingFeedbackNode,
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
            leadingSlot={(
              <div
                data-chat-agent-identity-chip="true"
                className="relative flex h-11 w-11 shrink-0 items-center justify-center"
              >
                <Tooltip
                  placement="top"
                  content={(
                    <div className="flex flex-col gap-1 px-1 py-0.5 text-left">
                      <span className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                        {resolvedAgentDisplayName}
                      </span>
                      {characterData.handle ? (
                        <span className="text-[11px] leading-4 text-[var(--nimi-text-secondary)]">
                          {characterData.handle}
                        </span>
                      ) : null}
                    </div>
                  )}
                >
                  <Avatar
                    src={characterData.avatarUrl || null}
                    alt={resolvedAgentDisplayName}
                    className="h-11 w-11 text-sm"
                  />
                </Tooltip>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-0.5 right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white"
                />
              </div>
            )}
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
    input.activeTarget,
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
    schedulingGuard.disabled,
    resolvedAgentDisplayName,
  ]);
}
