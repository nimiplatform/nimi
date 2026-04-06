import { useMemo, type ReactNode } from 'react';
import {
  CanonicalComposer,
  CanonicalDrawerSection,
  type CanonicalRuntimeInspectSectionData,
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
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { DesktopConversationModeHost } from './chat-mode-host-types';
import { ChatSettingsPanel } from './chat-settings-panel';
import {
  RuntimeInspectCard,
  RuntimeInspectUnsupportedNote,
} from './chat-runtime-inspect-content';
import {
  getAiRouteDisplaySummary,
  isAiRouteSnapshotEqual,
  toConversationThreadSummary,
} from './chat-ai-thread-model';
import type { AiConversationRouteSnapshot } from './chat-shell-types';
import type { ChatThinkingPreference } from './chat-thinking';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';

type UseAiConversationPresentationInput = {
  activeThreadId: string | null;
  aiCharacterData: DesktopConversationModeHost['characterData'];
  availableRouteSnapshots: readonly AiConversationRouteSnapshot[];
  bundle: ChatAiThreadBundle | null;
  bundleError: unknown;
  canonicalMessages: NonNullable<DesktopConversationModeHost['messages']>;
  composerReady: boolean;
  currentDraftTextRef: { current: string };
  currentRouteSnapshot: AiConversationRouteSnapshot | null;
  footerContent: ReactNode;
  handleArchiveThread: (threadId: string) => Promise<void>;
  handleCreateThread: () => Promise<void>;
  handleRouteSelection: (route: AiConversationRouteSnapshot) => void;
  handleSelectThread: (threadId: string) => void;
  handleSubmit: (text: string) => Promise<void>;
  hostFeedback: InlineFeedbackState | null;
  isBundleLoading: boolean;
  messages: readonly ConversationMessageViewModel[];
  onDismissHostFeedback: () => void;
  pendingFirstBeat: boolean;
  readiness: {
    cloudReady: boolean;
    localReady: boolean;
    setupState: ConversationSetupState;
  };
  renderMessageContent: CanonicalMessageContentSlot;
  routeSummary: {
    label: string;
    detail: string | null;
  };
  runtimeConfigState: RuntimeConfigStateV11 | null;
  setChatThinkingPreference: (value: ChatThinkingPreference) => void;
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
  const aiInspectSections = useMemo<CanonicalRuntimeInspectSectionData[]>(() => [
    {
      key: 'chat',
      title: input.t('Chat.settingsChatModel', { defaultValue: 'Chat Model' }),
      hint: input.t('Chat.settingsChatModelHint', {
        defaultValue: 'AI model used for this conversation. Follows Runtime default unless overridden.',
      }),
      summary: input.routeSummary.label,
      content: (
        <div className="space-y-3">
          <RuntimeInspectCard
            label={input.t('Chat.aiCurrentRoute', { defaultValue: 'Current route' })}
            value={input.routeSummary.label}
            detail={input.routeSummary.detail}
          />
          <div className="space-y-2">
            {input.availableRouteSnapshots.map((route) => {
              const routeDisplay = getAiRouteDisplaySummary(route, input.runtimeConfigState);
              const active = isAiRouteSnapshotEqual(route, input.currentRouteSnapshot);
              const routeKey = route.routeKind === 'local'
                ? 'local'
                : `${route.connectorId}:${route.modelId || 'missing-model'}`;
              return (
                <button
                  key={routeKey}
                  type="button"
                  disabled={Boolean(input.submittingThreadId)}
                  onClick={() => input.handleRouteSelection(route)}
                  className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                    active
                      ? 'border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]'
                      : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] hover:border-[var(--nimi-border-strong)]'
                  }`}
                >
                  <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                    {routeDisplay.label}
                  </div>
                  <div className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                    {routeDisplay.detail}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ),
    },
    {
      key: 'voice',
      title: input.t('Chat.settingsVoice', { defaultValue: 'Voice' }),
      hint: input.t('Chat.settingsVoiceHint', {
        defaultValue: 'Control how voice replies are triggered, whether voice session mode stays on, and which timbre is used.',
      }),
      disabledReason: input.t('Chat.settingsUnavailableReason', {
        defaultValue: 'This source does not expose runtime inspect yet.',
      }),
    },
    {
      key: 'media',
      title: input.t('Chat.settingsVisuals', { defaultValue: 'Visuals' }),
      hint: input.t('Chat.settingsVisualsHint', {
        defaultValue: 'Control whether images and videos appear in conversation, and their content style.',
      }),
      disabledReason: input.t('Chat.settingsUnavailableReason', {
        defaultValue: 'This source does not expose runtime inspect yet.',
      }),
    },
    {
      key: 'diagnostics',
      title: input.t('Chat.diagnosticsTitle', { defaultValue: 'Diagnostics' }),
      hint: input.t('Chat.aiProfileSubtitle', { defaultValue: 'Route, target, and conversation details.' }),
      content: (
        <RuntimeInspectCard
          label={input.t('Chat.diagnosticsTitle', { defaultValue: 'Diagnostics' })}
          value={input.readiness.setupState.status === 'ready'
            ? input.t('Chat.settingsRuntimeReady', { defaultValue: 'Runtime ready' })
            : input.t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' })}
          detail={input.routeSummary.detail}
        />
      ),
    },
  ], [
    input.availableRouteSnapshots,
    input.currentRouteSnapshot,
    input.handleRouteSelection,
    input.readiness.setupState.status,
    input.routeSummary.detail,
    input.routeSummary.label,
    input.runtimeConfigState,
    input.submittingThreadId,
    input.t,
  ]);
  const hostFeedbackNode = input.hostFeedback ? (
    <InlineFeedback feedback={input.hostFeedback} onDismiss={input.onDismissHostFeedback} />
  ) : null;
  const adapter = useMemo(() => ({
    mode: 'ai' as const,
    setupState: input.readiness.setupState,
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
        placeholder: input.readiness.setupState.status === 'ready'
          ? input.t('Chat.aiComposerPlaceholder', { defaultValue: 'Ask anything…' })
          : input.t('Chat.aiComposerSetupPlaceholder', { defaultValue: 'Set up a model to start chatting…' }),
      }
      : null,
  }), [input.bundle, input.composerReady, input.handleSubmit, input.messages, input.readiness.setupState, input.submittingThreadId, input.t, input.threads]);

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
        thinkingPreference={input.thinkingPreference}
        thinkingSupported={input.thinkingSupported}
        thinkingUnsupportedReason={input.thinkingUnsupportedReason}
        onThinkingPreferenceChange={input.setChatThinkingPreference}
        chatRouteConfigContent={aiInspectSections[0]?.content}
        voiceRouteConfigContent={<RuntimeInspectUnsupportedNote label={aiInspectSections[1]?.disabledReason || ''} />}
        mediaRouteConfigContent={<RuntimeInspectUnsupportedNote label={aiInspectSections[2]?.disabledReason || ''} />}
        diagnosticsContent={aiInspectSections[3]?.content}
        presenceContent={<RuntimeInspectUnsupportedNote label={input.t('Chat.settingsAllowProactiveContactHint', {
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
    setupDescription: (
      input.readiness.localReady || input.readiness.cloudReady
        ? input.t('Chat.aiRouteUnavailable', {
          defaultValue: 'The saved AI route is no longer ready. Pick one of the ready routes on the right to continue.',
        })
        : input.t('Chat.aiRouteRequired', {
          defaultValue: 'Configure a local chat route or a healthy cloud connector before AI mode can open a conversation.',
        })
    ),
    onSelectThread: input.handleSelectThread,
    onCreateThread: input.handleCreateThread,
    onArchiveThread: input.handleArchiveThread,
  }), [
    adapter,
    aiInspectSections,
    hostFeedbackNode,
    input.activeThreadId,
    input.aiCharacterData,
    input.availableRouteSnapshots,
    input.bundle?.draft?.text,
    input.bundle?.draft?.updatedAtMs,
    input.bundleError,
    input.canonicalMessages,
    input.currentDraftTextRef,
    input.currentRouteSnapshot,
    input.footerContent,
    input.handleArchiveThread,
    input.handleCreateThread,
    input.handleRouteSelection,
    input.handleSelectThread,
    input.isBundleLoading,
    input.messages,
    input.onDismissHostFeedback,
    input.pendingFirstBeat,
    input.readiness.cloudReady,
    input.readiness.localReady,
    input.readiness.setupState,
    input.renderMessageContent,
    input.setChatThinkingPreference,
    input.submittingThreadId,
    input.syntheticTarget,
    input.t,
    input.thinkingPreference,
    input.thinkingSupported,
    input.thinkingUnsupportedReason,
    input.threads.length,
  ]);
}
