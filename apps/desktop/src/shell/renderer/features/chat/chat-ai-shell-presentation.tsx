import { useMemo, type ReactNode } from 'react';
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
  ChatAiThreadBundle,
  ChatAiThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import type { DesktopConversationModeHost } from './chat-mode-host-types';
import { ChatSettingsPanel } from './chat-settings-panel';
import {
  RuntimeInspectCard,
} from './chat-runtime-inspect-content';
import { toConversationThreadSummary } from './chat-ai-thread-model';
import type { ChatThinkingPreference } from './chat-thinking';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import type { RouteModelPickerSelection } from '@nimiplatform/nimi-kit/features/model-picker';
import type { AISchedulingJudgement } from '@nimiplatform/sdk/mod';
import { resolveExecutionSchedulingGuardDecision } from './chat-execution-scheduling-guard';

type UseAiConversationPresentationInput = {
  activeThreadId: string | null;
  aiCharacterData: DesktopConversationModeHost['characterData'];
  bundle: ChatAiThreadBundle | null;
  bundleError: unknown;
  canonicalMessages: NonNullable<DesktopConversationModeHost['messages']>;
  composerReady: boolean;
  currentDraftTextRef: { current: string };
  footerContent: ReactNode;
  handleArchiveThread: (threadId: string) => Promise<void>;
  handleCreateThread: () => Promise<void>;
  handleRenameThread: (threadId: string, title: string) => void;
  handleSelectThread: (threadId: string) => void;
  handleSubmit: (text: string) => Promise<void>;
  hostFeedback: InlineFeedbackState | null;
  initialModelSelection?: Partial<RouteModelPickerSelection>;
  isBundleLoading: boolean;
  messages: readonly ConversationMessageViewModel[];
  onDismissHostFeedback: () => void;
  onModelSelectionChange: (selection: RouteModelPickerSelection) => void;
  pendingFirstBeat: boolean;
  renderMessageContent: CanonicalMessageContentSlot;
  routeSummary: {
    label: string;
    detail: string | null;
  };
  schedulingJudgement: AISchedulingJudgement | null;
  setChatThinkingPreference: (value: ChatThinkingPreference) => void;
  setupState: ConversationSetupState;
  submittingThreadId: string | null;
  syntheticTarget: NonNullable<DesktopConversationModeHost['targets']>[number];
  t: ReturnType<typeof useTranslation>['t'];
  thinkingPreference: ChatThinkingPreference;
  thinkingSupported: boolean;
  thinkingUnsupportedReason: string | null;
  threads: readonly ChatAiThreadSummary[];
};

export function useAiConversationPresentation(
  input: UseAiConversationPresentationInput,
): DesktopConversationModeHost {
  const schedulingGuard = useMemo(
    () => resolveExecutionSchedulingGuardDecision({
      judgement: input.schedulingJudgement,
      t: input.t,
    }),
    [input.schedulingJudgement, input.t],
  );
  const diagnosticsContent = useMemo(() => (
    <RuntimeInspectCard
      label={input.t('Chat.diagnosticsRuntimeLabel', { defaultValue: 'Runtime' })}
      value={input.setupState.status === 'ready'
        ? input.t('Chat.settingsRuntimeReady', { defaultValue: 'Runtime ready' })
        : input.t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' })}
      detail={input.routeSummary.detail}
    />
  ), [
    input.routeSummary.detail,
    input.setupState.status,
    input.t,
  ]);

  const hostFeedbackNode = input.hostFeedback ? (
    <InlineFeedback feedback={input.hostFeedback} onDismiss={input.onDismissHostFeedback} />
  ) : null;
  const schedulingFeedbackNode = schedulingGuard.feedback ? (
    <InlineFeedback feedback={schedulingGuard.feedback} />
  ) : null;

  const adapter = useMemo(() => ({
    mode: 'ai' as const,
    setupState: input.setupState,
    threadAdapter: {
      listThreads: () => input.threads.map((thread) => toConversationThreadSummary(thread)),
      listMessages: (threadId: string) => (
        input.bundle && input.bundle.thread.id === threadId
          ? input.messages
          : []
      ),
    },
    composerAdapter: input.composerReady
      ? {
        submit: async (composerInput: ChatComposerSubmitInput<unknown>) => {
          await input.handleSubmit(composerInput.text);
        },
        disabled: Boolean(input.submittingThreadId) || schedulingGuard.disabled,
        disabledReason: input.submittingThreadId
          ? input.t('Chat.aiSending', { defaultValue: 'Generating response…' })
          : schedulingGuard.disabledReason,
        placeholder: input.setupState.status === 'ready'
          ? input.t('Chat.aiComposerPlaceholder', { defaultValue: 'Ask anything…' })
          : input.t('Chat.aiComposerSetupPlaceholder', { defaultValue: 'Set up a model to start chatting…' }),
      }
      : null,
  }), [input.bundle, input.composerReady, input.handleSubmit, input.messages, input.setupState, input.submittingThreadId, input.t, input.threads, schedulingGuard.disabled, schedulingGuard.disabledReason]);

  return useMemo(() => ({
    mode: 'ai' as const,
    availability: {
      mode: 'ai',
      label: 'AI',
      enabled: true,
      badge: input.threads.length > 0 ? input.threads.length : null,
      disabledReason: null,
    },
    adapter,
    activeThreadId: input.activeThreadId,
    targets: [input.syntheticTarget],
    selectedTargetId: 'ai:assistant',
    onSelectTarget: () => undefined,
    messages: input.canonicalMessages,
    characterData: input.aiCharacterData,
    settingsContent: (
      <ChatSettingsPanel
        onModelSelectionChange={input.onModelSelectionChange}
        initialModelSelection={input.initialModelSelection}
        diagnosticsContent={diagnosticsContent}
      />
    ),
    settingsDrawerTitle: input.t('Chat.settingsTitle', { defaultValue: 'Settings' }),
    settingsDrawerSubtitle: input.t('Chat.settingsSubtitle', { defaultValue: 'Global interaction preferences' }),
    topContent: schedulingFeedbackNode,
    transcriptProps: {
      loading: input.isBundleLoading,
      error: input.bundleError instanceof Error ? input.bundleError.message : input.bundleError ? String(input.bundleError) : null,
      emptyEyebrow: 'AI',
      emptyTitle: input.t('Chat.aiTranscriptEmptyTitle', { defaultValue: 'Start the AI conversation' }),
      emptyDescription: input.t('Chat.aiTranscriptEmpty', { defaultValue: 'Send a message to start this conversation.' }),
      loadingLabel: input.t('Chat.aiTranscriptLoading', { defaultValue: 'Loading conversation…' }),
      footerContent: input.footerContent,
      renderMessageContent: input.renderMessageContent,
      pendingFirstBeat: input.pendingFirstBeat,
    },
    stagePanelProps: {
      footerContent: input.footerContent,
      renderMessageContent: input.renderMessageContent,
      pendingFirstBeat: input.pendingFirstBeat,
    },
    composerContent: (
      adapter.composerAdapter ? (
        <div className="space-y-3">
          {hostFeedbackNode}
          <CanonicalComposer
            key={`${input.activeThreadId || 'none'}:${input.bundle?.draft?.updatedAtMs || 0}`}
            adapter={adapter.composerAdapter}
            initialText={input.bundle?.draft?.text || ''}
            disabled={Boolean(input.submittingThreadId) || schedulingGuard.disabled}
            placeholder={input.t('Chat.aiComposerPlaceholder', { defaultValue: 'Ask anything…' })}
            onInputCaptureText={(text) => {
              input.currentDraftTextRef.current = text;
            }}
          />
        </div>
      ) : null
    ),
    setupDescription: input.t('Chat.aiRouteRequired', {
      defaultValue: 'Configure a local chat route or a healthy cloud connector before AI mode can open a conversation.',
    }),
    thinkingState: input.thinkingSupported
      ? (input.thinkingPreference === 'on' ? 'on' : 'off')
      : 'unsupported',
    onThinkingToggle: () => input.setChatThinkingPreference(input.thinkingPreference === 'on' ? 'off' : 'on'),
    onSelectThread: input.handleSelectThread,
    onCreateThread: input.handleCreateThread,
    onArchiveThread: input.handleArchiveThread,
    onRenameThread: input.handleRenameThread,
  }), [
    adapter,
    diagnosticsContent,
    hostFeedbackNode,
    schedulingFeedbackNode,
    input.activeThreadId,
    input.aiCharacterData,
    input.bundle?.draft?.text,
    input.bundle?.draft?.updatedAtMs,
    input.bundleError,
    input.canonicalMessages,
    input.currentDraftTextRef,
    input.footerContent,
    input.isBundleLoading,
    input.handleArchiveThread,
    input.handleCreateThread,
    input.handleRenameThread,
    input.handleSelectThread,
    input.messages,
    input.onDismissHostFeedback,
    input.pendingFirstBeat,
    input.renderMessageContent,
    input.setChatThinkingPreference,
    input.setupState,
    input.submittingThreadId,
    input.syntheticTarget,
    input.t,
    input.thinkingPreference,
    input.thinkingSupported,
    input.thinkingUnsupportedReason,
    input.threads.length,
    input.initialModelSelection,
    input.onModelSelectionChange,
    schedulingGuard.disabled,
  ]);
}
