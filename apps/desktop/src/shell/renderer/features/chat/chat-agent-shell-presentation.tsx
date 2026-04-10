import { useCallback, useMemo } from 'react';
import {
  CanonicalComposer,
  type ChatComposerSubmitInput,
} from '@nimiplatform/nimi-kit/features/chat';
import type {
  CanonicalMessageContentSlot,
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
import {
  RuntimeInspectCard,
} from './chat-runtime-inspect-content';
import { RuntimeStreamFooter } from './chat-runtime-stream-ui';
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
import {
  resolveAgentComposerVoiceState,
  type AgentVoiceSessionShellState,
} from './chat-agent-voice-session';

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
  handleSubmit: (text: string) => Promise<void>;
  hostFeedback: InlineFeedbackState | null;
  initialModelSelection?: Partial<RouteModelPickerSelection>;
  inputSelectionAgentId: AgentConversationSelection['agentId'];
  isBundleLoading: boolean;
  messages: readonly ConversationMessageViewModel[];
  onDismissHostFeedback: () => void;
  onModelSelectionChange: (selection: RouteModelPickerSelection) => void;
  reasoningLabel: string;
  renderMessageContent: CanonicalMessageContentSlot;
  routeReady: boolean;
  schedulingJudgement: AISchedulingJudgement | null;
  selectedTargetId: string | null;
  behaviorSettings: AgentChatExperienceSettings;
  setBehaviorSettings: (value: AgentChatExperienceSettings) => void;
  voiceSessionState: AgentVoiceSessionShellState;
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
  | 'selectedTargetId'
  | 'settingsContent'
  | 'setupDescription'
  | 'stagePanelProps'
  | 'targets'
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
  }), [input.currentFooterHostState?.footerState, input.currentFooterHostState?.lifecycle, input.streamState]);
  const surfaceState = useMemo(() => resolveAgentConversationSurfaceState({
    composerReady: input.composerReady,
    activeTarget: input.activeTarget,
    submittingThreadId: input.submittingThreadId,
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
  }), [footerViewState, input.activeTarget, input.composerReady, input.submittingThreadId, input.t, input.voiceSessionState]);
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
      emptyEyebrow: 'Agent',
      emptyTitle: input.t('Chat.agentTranscriptEmptyTitle', { defaultValue: 'Start the local agent conversation' }),
      emptyDescription: input.t('Chat.agentTranscriptEmpty', {
        defaultValue: 'Send a message to start the local agent conversation.',
      }),
      loadingLabel: input.t('Chat.agentTranscriptLoading', { defaultValue: 'Loading local agent conversation…' }),
    },
    renderMessageContent: input.renderMessageContent,
    onStopGenerating: handleStopGenerating,
  }), [
    characterData.avatarUrl,
    characterData.name,
    input.activeThreadId,
    input.bundleError,
    input.isBundleLoading,
    input.reasoningLabel,
    input.renderMessageContent,
    input.streamState,
    input.t,
    handleStopGenerating,
    selectedTargetId,
    surfaceState.footer,
    targetSummaries,
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
    <RuntimeInspectCard
      label={input.t('Chat.diagnosticsRuntimeLabel', { defaultValue: 'Runtime' })}
      value={input.targetsPending
        ? input.t('Chat.settingsLoading', { defaultValue: 'Loading models...' })
        : input.routeReady
          ? input.t('Chat.settingsRuntimeReady', { defaultValue: 'Runtime ready' })
          : input.t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' })}
      detail={input.activeTarget?.ownershipType || input.activeTarget?.worldName || input.t('Chat.agentRouteRequired', {
        defaultValue: 'Agent mode requires a local or cloud runtime route. Configure one in runtime settings.',
      })}
    />
  ), [input.activeTarget?.ownershipType, input.activeTarget?.worldName, input.routeReady, input.t, input.targetsPending]);
  const hostFeedbackNode = input.hostFeedback ? (
    <InlineFeedback feedback={input.hostFeedback} onDismiss={input.onDismissHostFeedback} />
  ) : null;
  const schedulingFeedbackNode = schedulingGuard.feedback ? (
    <InlineFeedback feedback={schedulingGuard.feedback} />
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
          void input.handleSubmit(composerInput.text);
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
          onModelSelectionChange={input.onModelSelectionChange}
          initialModelSelection={input.initialModelSelection}
          diagnosticsContent={diagnosticsContent}
        />
      </div>
    ),
    topContent: schedulingFeedbackNode,
    composerContent: (
      adapter.composerAdapter ? (
        <div className="space-y-3">
          {hostFeedbackNode}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800">
            <span>
              {input.voiceSessionState.mode === 'hands-free'
                ? input.t('Chat.voiceSessionHandsFreeActive', {
                  defaultValue: 'Hands-free on (foreground only)',
                })
                : input.t('Chat.voiceSessionHandsFreeHint', {
                  defaultValue: 'Foreground hands-free stays inside this thread only.',
                })}
            </span>
            {input.voiceSessionState.mode === 'hands-free' ? (
              <button
                type="button"
                onClick={input.onExitHandsFreeVoiceSession}
                className="rounded-xl border border-emerald-200 bg-white px-3 py-1.5 font-medium text-emerald-800 transition-colors hover:bg-emerald-50"
              >
                {input.t('Chat.voiceSessionHandsFreeExit', {
                  defaultValue: 'Exit hands-free',
                })}
              </button>
            ) : (
              <button
                type="button"
                onClick={input.onEnterHandsFreeVoiceSession}
                disabled={
                  Boolean(input.submittingThreadId)
                  || input.voiceSessionState.status === 'transcribing'
                  || input.voiceSessionState.status === 'listening'
                }
                className="rounded-xl border border-emerald-200 bg-white px-3 py-1.5 font-medium text-emerald-800 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {input.t('Chat.voiceSessionHandsFreeEnter', {
                  defaultValue: 'Enter hands-free',
                })}
              </button>
            )}
          </div>
          <CanonicalComposer
            key={`${input.activeThreadId || 'none'}:${input.bundle?.draft?.updatedAtMs || 0}`}
            adapter={adapter.composerAdapter}
            initialText={input.bundle?.draft?.text || ''}
            disabled={Boolean(input.submittingThreadId) || schedulingGuard.disabled}
            voiceState={resolveAgentComposerVoiceState({
              state: input.voiceSessionState,
              onToggle: input.onVoiceSessionToggle,
              onCancel: input.onVoiceSessionCancel,
            })}
            placeholder={input.t('Chat.agentComposerPlaceholder', { defaultValue: 'Talk to this agent…' })}
            onInputCaptureText={(text) => {
              input.currentDraftTextRef.current = text;
            }}
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
    schedulingGuard.disabled,
  ]);
}
