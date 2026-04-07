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
import { ConversationCapabilitySettingsSection } from './chat-conversation-capability-settings';
import { ChatSettingsPanel } from './chat-settings-panel';
import {
  RuntimeInspectCard,
} from './chat-runtime-inspect-content';
import { toConversationThreadSummary } from './chat-ai-thread-model';
import type { ChatThinkingPreference } from './chat-thinking';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import type { RouteModelPickerSelection } from '@nimiplatform/nimi-kit/features/model-picker';

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
  const diagnosticsContent = useMemo(() => (
    <RuntimeInspectCard
      label={input.t('Chat.diagnosticsTitle', { defaultValue: 'Diagnostics' })}
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

  const chatRouteConfigContent = useMemo(() => (
    <RuntimeInspectCard
      label={input.t('Chat.aiCurrentRoute', { defaultValue: 'Current route' })}
      value={input.routeSummary.label}
      detail={input.routeSummary.detail}
    />
  ), [input.routeSummary.detail, input.routeSummary.label, input.t]);

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
        submit: async (composerInput: ChatComposerSubmitInput<unknown>) => {
          await input.handleSubmit(composerInput.text);
        },
        disabled: Boolean(input.submittingThreadId),
        disabledReason: input.submittingThreadId
          ? input.t('Chat.aiSending', { defaultValue: 'Generating response…' })
          : null,
        placeholder: input.setupState.status === 'ready'
          ? input.t('Chat.aiComposerPlaceholder', { defaultValue: 'Ask anything…' })
          : input.t('Chat.aiComposerSetupPlaceholder', { defaultValue: 'Set up a model to start chatting…' }),
      }
      : null,
  }), [input.bundle, input.composerReady, input.handleSubmit, input.messages, input.setupState, input.submittingThreadId, input.t, input.threads]);

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
        thinkingPreference={input.thinkingPreference}
        thinkingSupported={input.thinkingSupported}
        thinkingUnsupportedReason={input.thinkingUnsupportedReason}
        onThinkingPreferenceChange={input.setChatThinkingPreference}
        chatRouteConfigContent={chatRouteConfigContent}
        voiceRouteConfigContent={<ConversationCapabilitySettingsSection section="voice" />}
        mediaRouteConfigContent={<ConversationCapabilitySettingsSection section="visual" />}
        diagnosticsContent={diagnosticsContent}
        presenceContent={<DisabledPresenceNote label={input.t('Chat.settingsAllowProactiveContactHint', {
          defaultValue: 'Unavailable until runtime inspect is connected for this source.',
        })} />}
      />
    ),
    settingsDrawerTitle: input.t('Chat.settingsTitle', { defaultValue: 'Settings' }),
    settingsDrawerSubtitle: input.t('Chat.settingsSubtitle', { defaultValue: 'Global interaction preferences' }),
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
            disabled={Boolean(input.submittingThreadId)}
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
    onSelectThread: input.handleSelectThread,
    onCreateThread: input.handleCreateThread,
    onArchiveThread: input.handleArchiveThread,
    onRenameThread: input.handleRenameThread,
  }), [
    adapter,
    chatRouteConfigContent,
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
  ]);
}

function DisabledPresenceNote(props: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-4 text-center text-[11px] text-gray-500">
      {props.label}
    </div>
  );
}
