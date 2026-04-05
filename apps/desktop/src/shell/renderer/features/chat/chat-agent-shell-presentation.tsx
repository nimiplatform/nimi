import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { Button } from '@nimiplatform/nimi-kit/ui';
import { dataSync } from '@runtime/data-sync';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type {
  AgentLocalTargetSnapshot,
  AgentLocalThreadBundle,
  AgentLocalThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import type { DesktopConversationModeHost } from './chat-mode-host-types';
import { ChatSettingsPanel } from './chat-settings-panel';
import {
  ChatRuntimeInspectContent,
  RuntimeInspectCard,
  RuntimeInspectUnsupportedNote,
} from './chat-runtime-inspect-content';
import { RuntimeStreamFooter } from './chat-runtime-stream-ui';
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

type SocialSnapshot = Awaited<ReturnType<typeof dataSync.loadSocialSnapshot>>;

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
  inputSelectionAgentId: AgentConversationSelection['agentId'];
  isBundleLoading: boolean;
  messages: readonly ConversationMessageViewModel[];
  onDismissHostFeedback: () => void;
  reasoningLabel: string;
  renderMessageContent: CanonicalMessageContentSlot;
  selectedTargetId: string | null;
  setChatThinkingPreference: (value: ChatThinkingPreference) => void;
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

function ChatAgentTargetRail(input: {
  target: AgentLocalTargetSnapshot;
}) {
  const { t } = useTranslation();
  const navigateToProfile = useAppStore((state) => state.navigateToProfile);
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const detailQuery = useQuery({
    queryKey: ['agent-chat-target-detail', input.target.agentId],
    queryFn: async () => dataSync.loadAgentDetails(input.target.agentId),
    enabled: Boolean(input.target.agentId),
  });

  const profile = detailQuery.data as SocialSnapshot['friends'][number] | null | undefined;
  const displayName = String(profile?.displayName || input.target.displayName).trim() || input.target.displayName;
  const handle = String(profile?.handle || input.target.handle).trim() || input.target.handle;
  const bio = String(profile?.bio || input.target.bio || '').trim() || null;
  const worldId = String(profile?.worldId || input.target.worldId || '').trim() || null;
  const worldName = String(profile?.worldName || input.target.worldName || '').trim() || null;

  return (
    <div className="space-y-4">
      <CanonicalDrawerSection title={t('Chat.agentTarget', { defaultValue: 'Agent target' })}>
        <div>
          <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {displayName}
          </div>
          <div className="mt-1 text-xs text-[var(--nimi-text-muted)]">
            @{handle}
          </div>
        </div>
        {bio ? (
          <p className="text-sm leading-6 text-[var(--nimi-text-secondary)]">
            {bio}
          </p>
        ) : null}
        <div className="space-y-1 text-xs text-[var(--nimi-text-muted)]">
          {worldName ? <div>{worldName}</div> : null}
          {input.target.ownershipType ? <div>{input.target.ownershipType}</div> : null}
        </div>
      </CanonicalDrawerSection>
      <CanonicalDrawerSection title={t('Chat.agentActions', { defaultValue: 'Actions' })}>
        <Button
          tone="secondary"
          size="sm"
          fullWidth
          onClick={() => navigateToProfile(input.target.agentId, 'agent-detail')}
        >
          {t('Chat.agentOpenProfile', { defaultValue: 'Open agent profile' })}
        </Button>
        <Button
          tone="secondary"
          size="sm"
          fullWidth
          disabled={!worldId}
          onClick={() => {
            if (worldId) {
              navigateToWorld(worldId);
            }
          }}
        >
          {t('Chat.agentOpenWorld', { defaultValue: 'Open world' })}
        </Button>
      </CanonicalDrawerSection>
    </div>
  );
}

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
  | 'profileContent'
  | 'profileDrawerSubtitle'
  | 'profileDrawerTitle'
  | 'rightSidebarAutoOpenKey'
  | 'rightSidebarContent'
  | 'rightSidebarResetKey'
  | 'selectedTargetId'
  | 'settingsContent'
  | 'settingsDrawerSubtitle'
  | 'settingsDrawerTitle'
  | 'setupDescription'
  | 'stagePanelProps'
  | 'targets'
  | 'transcriptProps'
> {
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
    footerViewState,
    labels: {
      title: input.t('Chat.agentTitle', { defaultValue: 'Agent Chat' }),
      sendingDisabledReason: input.t('Chat.agentSending', { defaultValue: 'Waiting for agent response…' }),
      composerPlaceholderWithTarget: input.t('Chat.agentComposerPlaceholder', {
        defaultValue: 'Talk to {{name}}…',
        name: input.activeTarget?.displayName || 'this agent',
      }),
      composerPlaceholderWithoutTarget: input.t('Chat.agentComposerNoTargetPlaceholder', {
        defaultValue: 'Select an agent to start chatting…',
      }),
    },
  }), [footerViewState, input.activeTarget, input.composerReady, input.submittingThreadId, input.t]);
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
  const agentInspectSections = useMemo<CanonicalRuntimeInspectSectionData[]>(() => [
    {
      key: 'chat',
      title: input.t('Chat.settingsChatModel', { defaultValue: 'Chat Model' }),
      hint: input.t('Chat.settingsChatModelHint', {
        defaultValue: 'AI model used for this conversation. Follows Runtime default unless overridden.',
      }),
      summary: input.agentRouteReady
        ? input.t('Chat.settingsRuntimeReady', { defaultValue: 'Runtime ready' })
        : input.t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' }),
      content: (
        <div className="space-y-3">
          <RuntimeInspectCard
            label={input.t('Chat.agentSelectLabel', { defaultValue: 'Agent friend' })}
            value={input.activeTarget?.displayName || input.t('Chat.agentTitle', { defaultValue: 'Agent Chat' })}
            detail={input.activeTarget?.worldName || input.t('Chat.agentRouteRequired', {
              defaultValue: 'Agent mode requires a local or cloud runtime route. Configure one in runtime settings.',
            })}
          />
          <RuntimeInspectCard
            label={input.t('Chat.aiCurrentRoute', { defaultValue: 'Current route' })}
            value={input.agentRouteReady
              ? input.t('Chat.settingsRuntimeReady', { defaultValue: 'Runtime ready' })
              : input.t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' })}
            detail={input.t('Chat.agentRouteRequired', {
              defaultValue: 'Agent mode requires a local or cloud runtime route. Configure one in runtime settings.',
            })}
          />
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
      hint: input.t('Chat.agentProfileSubtitle', {
        defaultValue: 'Relationship, memory, and target details.',
      }),
      content: (
        <RuntimeInspectCard
          label={input.t('Chat.diagnosticsTitle', { defaultValue: 'Diagnostics' })}
          value={input.targetsPending
            ? input.t('Chat.settingsLoading', { defaultValue: 'Loading models...' })
            : input.t('Chat.agentTitle', { defaultValue: 'Agent Chat' })}
          detail={input.activeTarget?.ownershipType || input.activeTarget?.worldName || input.t('Chat.agentRouteRequired', {
            defaultValue: 'Agent mode requires a local or cloud runtime route. Configure one in runtime settings.',
          })}
        />
      ),
    },
  ], [input.activeTarget?.displayName, input.activeTarget?.ownershipType, input.activeTarget?.worldName, input.agentRouteReady, input.t, input.targetsPending]);
  const hostFeedbackNode = input.hostFeedback ? (
    <InlineFeedback feedback={input.hostFeedback} onDismiss={input.onDismissHostFeedback} />
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
        submit: async (composerInput: ChatComposerSubmitInput<unknown>) => {
          await input.handleSubmit(composerInput.text);
        },
        disabled: surfaceState.composer.disabled,
        disabledReason: surfaceState.composer.disabledReason,
        placeholder: surfaceState.composer.placeholder,
      }
      : null,
  }), [input.bundle, input.handleSubmit, input.messages, input.setupState, input.targetSummariesInput.threads, surfaceState.composer]);

  return useMemo(() => ({
    ...hostSnapshot,
    adapter,
    settingsContent: (
      <ChatSettingsPanel
        thinkingPreference={input.thinkingPreference}
        thinkingSupported={input.thinkingSupported}
        thinkingUnsupportedReason={input.thinkingUnsupportedReason}
        onThinkingPreferenceChange={input.setChatThinkingPreference}
        chatRouteConfigContent={agentInspectSections[0]?.content}
        voiceRouteConfigContent={<RuntimeInspectUnsupportedNote label={agentInspectSections[1]?.disabledReason || ''} />}
        mediaRouteConfigContent={<RuntimeInspectUnsupportedNote label={agentInspectSections[2]?.disabledReason || ''} />}
        presenceContent={<RuntimeInspectUnsupportedNote label={input.t('Chat.settingsAllowProactiveContactHint', {
          defaultValue: 'Unavailable until runtime inspect is connected for this source.',
        })} />}
      />
    ),
    settingsDrawerTitle: input.t('Chat.settingsTitle', { defaultValue: 'Settings' }),
    settingsDrawerSubtitle: input.t('Chat.settingsSubtitle', { defaultValue: 'Global interaction preferences' }),
    composerContent: (
      adapter.composerAdapter ? (
        <div className="space-y-3">
          {hostFeedbackNode}
          <CanonicalComposer
            key={`${input.activeThreadId || 'none'}:${input.bundle?.draft?.updatedAtMs || 0}`}
            adapter={adapter.composerAdapter}
            initialText={input.bundle?.draft?.text || ''}
            disabled={Boolean(input.submittingThreadId)}
            placeholder={input.t('Chat.agentComposerPlaceholder', { defaultValue: 'Talk to this agent…' })}
            onInputCaptureText={(text) => {
              input.currentDraftTextRef.current = text;
            }}
          />
        </div>
      ) : null
    ),
    profileContent: input.activeTarget ? (
      <div className="space-y-3">
        {hostFeedbackNode}
        <ChatAgentTargetRail target={input.activeTarget} />
      </div>
    ) : hostFeedbackNode,
    rightSidebarContent: (
      <ChatRuntimeInspectContent
        title={input.t('Chat.runtimeInspectTitle', { defaultValue: 'Runtime Inspect' })}
        subtitle={input.t('Chat.runtimeInspectSubtitle', {
          defaultValue: 'Route, voice, media, and diagnostics for this conversation.',
        })}
        statusTitle={input.activeTarget?.displayName || input.t('Chat.agentTitle', { defaultValue: 'Agent Chat' })}
        statusHint={input.activeTarget?.worldName || null}
        statusSummary={input.activeTarget?.ownershipType || input.t('Chat.mode.agent', { defaultValue: 'Agent' })}
        statusChips={[
          {
            label: input.agentRouteReady
              ? input.t('Chat.settingsRuntimeReady', { defaultValue: 'Runtime ready' })
              : input.t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' }),
            tone: input.agentRouteReady ? 'success' : 'warning',
          },
        ]}
        sections={agentInspectSections}
        initialOpenPanel="chat"
      />
    ),
    rightSidebarAutoOpenKey: null,
    rightSidebarResetKey: `agent:${input.activeTarget?.agentId || 'landing'}`,
    profileDrawerTitle: input.t('Chat.profileTitle', { defaultValue: 'Profile' }),
    profileDrawerSubtitle: input.t('Chat.agentProfileSubtitle', {
      defaultValue: 'Relationship, memory, and target details.',
    }),
    setupDescription: input.t('Chat.agentRouteRequired', {
      defaultValue: 'Agent mode requires a local or cloud runtime route. Configure one in runtime settings.',
    }),
  }), [
    adapter,
    agentInspectSections,
    hostFeedbackNode,
    hostSnapshot,
    input.activeTarget,
    input.activeThreadId,
    input.agentRouteReady,
    input.bundle?.draft?.text,
    input.bundle?.draft?.updatedAtMs,
    input.currentDraftTextRef,
    input.onDismissHostFeedback,
    input.setChatThinkingPreference,
    input.submittingThreadId,
    input.t,
    input.thinkingPreference,
    input.thinkingSupported,
    input.thinkingUnsupportedReason,
  ]);
}
