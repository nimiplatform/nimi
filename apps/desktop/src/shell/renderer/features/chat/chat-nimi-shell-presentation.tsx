import { Suspense, lazy, useMemo, type ReactNode } from 'react';
import { CanonicalComposer } from '@nimiplatform/kit/features/chat/components/canonical-composer';
import type { ChatComposerSubmitInput } from '@nimiplatform/kit/features/chat/headless';
import type {
  CanonicalMessageContentSlot,
  ConversationMessageViewModel,
  ConversationSetupState,
} from '@nimiplatform/kit/features/chat/headless';
import { useTranslation } from 'react-i18next';
import type {
  ChatAiThreadBundle,
  ChatAiThreadSummary,
} from '../../bridge/runtime-bridge/types';
import type { DesktopConversationModeHost } from './chat-shared-mode-host-types';
import { CHAT_CONTENT_WIDTH_CLASS, CHAT_CONTENT_POSITION_CLASS, CHAT_TRANSCRIPT_BOTTOM_RESERVE_CLASS, CHAT_TRANSCRIPT_SCROLL_POSITION_CLASS, CHAT_TRANSCRIPT_SCROLL_VIEWPORT_CLASS } from './chat-shared-content-layout';
import {
  RuntimeInspectCard,
} from './chat-runtime-inspect-content';
import { toConversationThreadSummary } from './chat-nimi-thread-model';
import type { ChatThinkingPreference } from './chat-shared-thinking';
import { InlineFeedback, type InlineFeedbackState } from '../../ui/feedback/inline-feedback';

const ChatSettingsPanel = lazy(async () => {
  const mod = await import('./chat-shared-settings-panel');
  return { default: mod.ChatSettingsPanel };
});

type UseAiConversationPresentationInput = {
  activeThreadId: string | null;
  aiCharacterData: DesktopConversationModeHost['characterData'];
  bundle: ChatAiThreadBundle | null;
  bundleError: unknown;
  canonicalMessages: NonNullable<DesktopConversationModeHost['messages']>;
  composerReady: boolean;
  currentDraftTextRef: { current: string };
  footerContent: ReactNode;
  handleCreateThread: () => Promise<void>;
  handleSelectThread: (threadId: string) => void;
  handleSubmit: (text: string) => Promise<void>;
  hostFeedback: InlineFeedbackState | null;
  isBundleLoading: boolean;
  messages: readonly ConversationMessageViewModel[];
  onDismissHostFeedback: () => void;
  pendingFirstBeat: boolean;
  renderMessageContent: CanonicalMessageContentSlot;
  intentSummary: {
    label: string;
    detail: string | null;
  };
  setChatThinkingPreference: (value: ChatThinkingPreference) => void;
  setupPending: boolean;
  setupState: ConversationSetupState;
  submittingThreadId: string | null;
  syntheticTarget: NonNullable<DesktopConversationModeHost['targets']>[number];
  t: ReturnType<typeof useTranslation>['t'];
  thinkingPreference: ChatThinkingPreference;
  thinkingSupported: boolean;
  thinkingUnsupportedReason: string | null;
  threads: readonly ChatAiThreadSummary[];
  userDisplayName: string | null;
};

export function useAiConversationPresentation(
  input: UseAiConversationPresentationInput,
): DesktopConversationModeHost {
  const diagnosticsContent = useMemo(() => (
    <RuntimeInspectCard
      label={input.t('Chat.diagnosticsRuntimeLabel', { defaultValue: 'Runtime' })}
      value={input.t('Chat.settingsRuntimeExecutionOwned', {
        defaultValue: 'Execution checked by Runtime on submit',
      })}
      detail={input.intentSummary.detail}
    />
  ), [input.intentSummary.detail, input.t]);

  const hostFeedbackNode = input.hostFeedback ? (
    <InlineFeedback feedback={input.hostFeedback} onDismiss={input.onDismissHostFeedback} />
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
        disabled: Boolean(input.submittingThreadId),
        disabledReason: input.submittingThreadId
          ? input.t('Chat.nimiSending', { defaultValue: 'Generating response…' })
          : null,
        placeholder: input.setupState.status === 'ready'
          ? input.t('Chat.nimiComposerPlaceholder', { defaultValue: 'Ask Nimi anything…' })
          : input.t('Chat.nimiComposerIntentPlaceholder', { defaultValue: 'Configure text generation intent to start chatting with Nimi…' }),
      }
      : null,
  }), [input.bundle, input.composerReady, input.handleSubmit, input.messages, input.setupState, input.submittingThreadId, input.t, input.threads]);

  return useMemo(() => {
    const centerComposer = Boolean(
      adapter.composerAdapter
        && !input.isBundleLoading
        && !input.bundleError
        && input.canonicalMessages.length === 0,
    );
    const composerNode = adapter.composerAdapter ? (
      <div className="space-y-3">
        {hostFeedbackNode}
        <CanonicalComposer
          key={`${input.activeThreadId || 'none'}:${input.bundle?.draft?.updatedAtMs || 0}`}
          adapter={adapter.composerAdapter}
          initialText={input.bundle?.draft?.text || ''}
          disabled={Boolean(input.submittingThreadId)}
          placeholder={input.t('Chat.nimiComposerPlaceholder', { defaultValue: 'Ask Nimi anything…' })}
          layout="stacked"
          className={centerComposer ? 'px-0 pb-0' : undefined}
          widthClassName={CHAT_CONTENT_WIDTH_CLASS}
          widthPositionClassName={CHAT_CONTENT_POSITION_CLASS}
          onInputCaptureText={(text) => {
            input.currentDraftTextRef.current = text;
          }}
        />
      </div>
    ) : null;
    const emptyTitle = input.userDisplayName
      ? input.t('Chat.nimiEmptyGreetingNamed', {
        name: input.userDisplayName,
        defaultValue: 'Hi, {{name}}! Where would you like to start?',
      })
      : input.t('Chat.nimiEmptyGreeting', { defaultValue: 'Hi! Where would you like to start?' });
    return {
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
      <Suspense fallback={null}>
        <ChatSettingsPanel diagnosticsContent={diagnosticsContent} />
      </Suspense>
    ),
    settingsDrawerTitle: input.t('Chat.settingsTitle', { defaultValue: 'Settings' }),
    settingsDrawerSubtitle: input.t('Chat.settingsSubtitle', { defaultValue: 'Global interaction preferences' }),
    transcriptProps: {
      loading: input.isBundleLoading,
      error: input.bundleError instanceof Error ? input.bundleError.message : input.bundleError ? String(input.bundleError) : null,
      emptyEyebrow: '',
      emptyTitle,
      emptyDescription: '',
      emptyStateContent: centerComposer ? composerNode : null,
      loadingLabel: input.t('Chat.nimiTranscriptLoading', { defaultValue: 'Loading conversation…' }),
      footerContent: input.footerContent,
      renderMessageContent: input.renderMessageContent,
      pendingFirstBeat: input.pendingFirstBeat,
      disableRpContent: true,
      widthClassName: CHAT_CONTENT_WIDTH_CLASS,
      widthPositionClassName: CHAT_CONTENT_POSITION_CLASS,
      scrollViewportWidthClassName: CHAT_TRANSCRIPT_SCROLL_VIEWPORT_CLASS,
      scrollViewportPositionClassName: CHAT_TRANSCRIPT_SCROLL_POSITION_CLASS,
      contentPaddingBottomClassName: CHAT_TRANSCRIPT_BOTTOM_RESERVE_CLASS,
    },
    stagePanelProps: {
      footerContent: input.footerContent,
      renderMessageContent: input.renderMessageContent,
      pendingFirstBeat: input.pendingFirstBeat,
      disableRpContent: true,
    },
    composerContent: centerComposer ? null : composerNode,
    setupDescription: input.setupPending
      ? null
      : input.t('Chat.nimiIntentRequired', {
        defaultValue: 'Nimi can chat with you through an on-device or cloud model. Choose one to start chatting.',
      }),
    setupEyebrow: input.t('Chat.nimiSetupEyebrow', { defaultValue: 'Nimi Chat' }),
    setupTitle: input.setupPending
      ? input.t('Chat.nimiSetupLoadingTitle', { defaultValue: 'Preparing Nimi Chat…' })
      : input.t('Chat.nimiSetupTitle', { defaultValue: 'Choose a model for Nimi' }),
    setupActionLabel: input.t('Chat.nimiSetupAction', { defaultValue: 'Choose a model' }),
    setupDiagnosticsLabel: input.t('Chat.settingsTechnicalDetails', { defaultValue: 'Technical details' }),
    thinkingState: input.thinkingSupported
      ? (input.thinkingPreference === 'on' ? 'on' : 'off')
      : 'unsupported',
    onThinkingToggle: () => input.setChatThinkingPreference(input.thinkingPreference === 'on' ? 'off' : 'on'),
    onSelectThread: input.handleSelectThread,
    onCreateThread: input.handleCreateThread,
    };
  }, [
    adapter,
    diagnosticsContent,
    hostFeedbackNode,
    input.activeThreadId,
    input.aiCharacterData,
    input.bundle?.draft?.text,
    input.bundle?.draft?.updatedAtMs,
    input.bundleError,
    input.canonicalMessages,
    input.currentDraftTextRef,
    input.footerContent,
    input.isBundleLoading,
    input.handleCreateThread,
    input.handleSelectThread,
    input.messages,
    input.onDismissHostFeedback,
    input.pendingFirstBeat,
    input.renderMessageContent,
    input.setChatThinkingPreference,
    input.setupPending,
    input.setupState,
    input.submittingThreadId,
    input.syntheticTarget,
    input.t,
    input.thinkingPreference,
    input.thinkingSupported,
    input.thinkingUnsupportedReason,
    input.threads.length,
    input.userDisplayName,
  ]);
}
