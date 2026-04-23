import { useCallback, useMemo, useState, type ReactNode } from 'react';
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
import type { DesktopConversationModeHost } from './chat-shared-mode-host-types';
import { CHAT_CONTENT_WIDTH_CLASS, CHAT_CONTENT_POSITION_CLASS } from './chat-shared-content-layout';
import { ChatSettingsPanel } from './chat-shared-settings-panel';
import {
  RuntimeInspectCard,
} from './chat-runtime-inspect-content';
import { toConversationThreadSummary } from './chat-nimi-thread-model';
import type { ChatThinkingPreference } from './chat-shared-thinking';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import type { RouteModelPickerSelection } from '@nimiplatform/nimi-kit/features/model-picker';
import type { AISchedulingJudgement } from '@nimiplatform/sdk/mod';
import { resolveExecutionSchedulingGuardDecision } from './chat-shared-execution-scheduling-guard';

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
  routeReady: boolean;
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
      value={input.routeReady
        ? input.t('Chat.settingsRuntimeReady', { defaultValue: 'Runtime ready' })
        : input.t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' })}
      detail={input.routeSummary.detail}
    />
  ), [
    input.routeReady,
    input.routeSummary.detail,
    input.t,
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
        submit: (composerInput: ChatComposerSubmitInput<unknown>) => {
          void input.handleSubmit(composerInput.text).catch(() => undefined);
          return Promise.resolve();
        },
        disabled: Boolean(input.submittingThreadId) || schedulingGuard.disabled,
        disabledReason: input.submittingThreadId
          ? input.t('Chat.nimiSending', { defaultValue: 'Generating response…' })
          : schedulingGuard.disabledReason,
        placeholder: input.setupState.status === 'ready'
          ? input.t('Chat.nimiComposerPlaceholder', { defaultValue: 'Ask Nimi anything…' })
          : input.t('Chat.nimiComposerSetupPlaceholder', { defaultValue: 'Set up a model to start chatting with Nimi…' }),
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
      emptyEyebrow: 'Nimi',
      emptyTitle: input.t('Chat.nimiTranscriptEmptyTitle', { defaultValue: 'Start a Nimi Chat' }),
      emptyDescription: input.t('Chat.nimiTranscriptEmpty', { defaultValue: 'Send a message to start this conversation.' }),
      loadingLabel: input.t('Chat.nimiTranscriptLoading', { defaultValue: 'Loading conversation…' }),
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
            placeholder={input.t('Chat.nimiComposerPlaceholder', { defaultValue: 'Ask Nimi anything…' })}
            layout="stacked"
            widthClassName={CHAT_CONTENT_WIDTH_CLASS}
            widthPositionClassName={CHAT_CONTENT_POSITION_CLASS}
            onInputCaptureText={(text) => {
              input.currentDraftTextRef.current = text;
            }}
          />
        </div>
      ) : null
    ),
    setupDescription: input.t('Chat.nimiRouteRequired', {
      defaultValue: 'Configure a local chat route or a healthy cloud connector before Nimi Chat can open a conversation.',
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
