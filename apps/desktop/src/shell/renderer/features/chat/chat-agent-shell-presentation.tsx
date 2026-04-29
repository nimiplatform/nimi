import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ChatComposerSubmitInput,
} from '@nimiplatform/nimi-kit/features/chat';
import type { DesktopConversationModeHost } from './chat-shared-mode-host-types';
import { RuntimeStreamFooter } from './chat-shared-runtime-stream-ui';
import { hasTauriInvoke } from '@renderer/bridge/runtime-bridge/env';
import {
  buildDesktopAvatarInstanceId,
  closeDesktopAvatarHandoff,
  launchDesktopAvatarHandoff,
} from '@renderer/bridge/runtime-bridge/chat-agent-avatar-launcher';
import {
  desktopAvatarInstanceRegistryQueryKey,
  listDesktopAvatarLiveInstances,
} from '@renderer/bridge/runtime-bridge/chat-agent-avatar-instance-registry';
import {
  agentCenterLocalConfigQueryKey,
  getAgentCenterBackgroundAsset,
  getAgentCenterLocalConfig,
  importAgentCenterBackground,
  importAgentCenterAvatarPackage,
  pickAgentCenterBackgroundSource,
  pickAgentCenterAvatarPackageSource,
  removeAgentCenterAvatarPackage,
  removeAgentCenterBackground,
  validateAgentCenterAvatarPackage,
} from '@renderer/bridge/runtime-bridge/chat-agent-center-local-config-store';
import { cancelStream } from '../turns/stream-controller';
import { createInitialAgentTurnLifecycleState } from './chat-agent-shell-lifecycle';
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
import { InlineFeedback } from '@renderer/ui/feedback/inline-feedback';
import { resolveExecutionSchedulingGuardDecision } from './chat-shared-execution-scheduling-guard';
import {
  resolveAgentComposerVoiceState,
} from './chat-agent-voice-session';
import { AgentCanonicalComposer } from './chat-agent-canonical-composer';
import { AgentConversationDiagnosticsContent, AgentConversationSettingsContent } from './chat-agent-shell-presentation-settings';
import { ChatComposerLeadingAvatar } from './chat-shared-composer-leading-avatar';
import { CHAT_CONTENT_POSITION_CLASS, CHAT_CONTENT_WIDTH_CLASS } from './chat-shared-content-layout';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';
import type { PendingAttachment } from '../turns/turn-input-attachments';


const AGENT_TRANSCRIPT_BOTTOM_RESERVE_CLASS = 'pb-[clamp(140px,16vh,200px)]';

function assetUrlFromFileUrl(fileUrl: string | null | undefined): string | undefined {
  const normalized = String(fileUrl || '').trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.startsWith('file://')
    ? normalized.replace(/^file:\/\//, 'asset://localhost')
    : normalized;
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
  const queryClient = useQueryClient();
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
  const agentCenterLocalConfigQuery = useQuery({
    queryKey: input.accountId && input.activeTarget?.agentId
      ? agentCenterLocalConfigQueryKey(input.accountId, input.activeTarget.agentId)
      : ['agent-center-local-config', 'none'],
    queryFn: async () => (
      input.accountId && input.activeTarget?.agentId
        ? getAgentCenterLocalConfig({
          accountId: input.accountId,
          agentId: input.activeTarget.agentId,
        })
        : null
    ),
    enabled: hasTauriInvoke() && Boolean(input.accountId && input.activeTarget?.agentId),
    staleTime: 30_000,
  });
  const selectedAvatarPackage = agentCenterLocalConfigQuery.data?.modules.avatar_package.selected_package || null;
  const selectedBackgroundAssetId = agentCenterLocalConfigQuery.data?.modules.appearance.background_asset_id || null;
  const backgroundAssetQuery = useQuery({
    queryKey: input.accountId && input.activeTarget?.agentId && selectedBackgroundAssetId
      ? [
        'agent-center-background-asset',
        input.accountId,
        input.activeTarget.agentId,
        selectedBackgroundAssetId,
      ]
      : ['agent-center-background-asset', 'none'],
    queryFn: async () => (
      input.accountId && input.activeTarget?.agentId && selectedBackgroundAssetId
        ? getAgentCenterBackgroundAsset({
          accountId: input.accountId,
          agentId: input.activeTarget.agentId,
          backgroundAssetId: selectedBackgroundAssetId,
        })
        : null
    ),
    enabled: hasTauriInvoke() && Boolean(input.accountId && input.activeTarget?.agentId && selectedBackgroundAssetId),
    staleTime: 30_000,
  });
  const backdropImageUrl = assetUrlFromFileUrl(backgroundAssetQuery.data?.file_url);
  const avatarPackageValidationQuery = useQuery({
    queryKey: input.accountId && input.activeTarget?.agentId && selectedAvatarPackage
      ? [
        'agent-center-avatar-package-validation',
        input.accountId,
        input.activeTarget.agentId,
        selectedAvatarPackage.kind,
        selectedAvatarPackage.package_id,
      ]
      : ['agent-center-avatar-package-validation', 'none'],
    queryFn: async () => (
      input.accountId && input.activeTarget?.agentId && selectedAvatarPackage
        ? validateAgentCenterAvatarPackage({
          accountId: input.accountId,
          agentId: input.activeTarget.agentId,
          kind: selectedAvatarPackage.kind,
          packageId: selectedAvatarPackage.package_id,
        })
        : null
    ),
    enabled: hasTauriInvoke() && Boolean(input.accountId && input.activeTarget?.agentId && selectedAvatarPackage),
    staleTime: 30_000,
  });
  const avatarConfigured = Boolean(selectedAvatarPackage);
  const avatarPackageLaunchSupported = !selectedAvatarPackage || selectedAvatarPackage.kind === 'live2d';
  const avatarPackageValid = avatarPackageLaunchSupported && avatarPackageValidationQuery.data?.status === 'valid';
  const avatarPackageChecking = Boolean(selectedAvatarPackage && avatarPackageValidationQuery.isFetching);
  const backgroundValidation = backgroundAssetQuery.data?.validation || null;
  const backgroundValid = backgroundValidation?.status === 'valid';
  const avatarPackageImportMutation = useMutation({
    mutationFn: async (kind: 'live2d' | 'vrm') => {
      if (!input.accountId || !input.activeTarget?.agentId) {
        throw new Error(input.t('Chat.agentCenterAvatarImportAgentRequired', {
          defaultValue: 'Select an agent before importing an avatar package.',
        }));
      }
      const sourcePath = await pickAgentCenterAvatarPackageSource({ kind });
      if (!sourcePath) {
        return null;
      }
      return importAgentCenterAvatarPackage({
        accountId: input.accountId,
        agentId: input.activeTarget.agentId,
        kind,
        sourcePath,
        select: true,
      });
    },
    onSuccess: async (result) => {
      if (!result || !input.accountId || !input.activeTarget?.agentId) {
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentCenterLocalConfigQueryKey(input.accountId, input.activeTarget.agentId),
        }),
        queryClient.invalidateQueries({ queryKey: ['agent-center-avatar-package-validation'] }),
      ]);
    },
  });
  const avatarImportDisabled = !hasTauriInvoke()
    || !input.accountId
    || !input.activeTarget?.agentId
    || avatarPackageImportMutation.isPending;
  const avatarImportError = avatarPackageImportMutation.error instanceof Error
    ? avatarPackageImportMutation.error.message
    : null;
  const clearAvatarPackageMutation = useMutation({
    mutationFn: async () => {
      if (!input.accountId || !input.activeTarget?.agentId || !selectedAvatarPackage) {
        return null;
      }
      return removeAgentCenterAvatarPackage({
        accountId: input.accountId,
        agentId: input.activeTarget.agentId,
        kind: selectedAvatarPackage.kind,
        packageId: selectedAvatarPackage.package_id,
      });
    },
    onSuccess: async (result) => {
      if (!result || !input.accountId || !input.activeTarget?.agentId) {
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentCenterLocalConfigQueryKey(input.accountId, input.activeTarget.agentId),
        }),
        queryClient.invalidateQueries({ queryKey: ['agent-center-avatar-package-validation'] }),
      ]);
    },
  });
  const backgroundImportMutation = useMutation({
    mutationFn: async () => {
      if (!input.accountId || !input.activeTarget?.agentId) {
        throw new Error(input.t('Chat.agentCenterBackgroundImportAgentRequired', {
          defaultValue: 'Select an agent before importing a background.',
        }));
      }
      const sourcePath = await pickAgentCenterBackgroundSource();
      if (!sourcePath) {
        return null;
      }
      return importAgentCenterBackground({
        accountId: input.accountId,
        agentId: input.activeTarget.agentId,
        sourcePath,
        select: true,
      });
    },
    onSuccess: async (result) => {
      if (!result || !input.accountId || !input.activeTarget?.agentId) {
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentCenterLocalConfigQueryKey(input.accountId, input.activeTarget.agentId),
        }),
        queryClient.invalidateQueries({ queryKey: ['agent-center-background-asset'] }),
      ]);
    },
  });
  const backgroundImportDisabled = !hasTauriInvoke()
    || !input.accountId
    || !input.activeTarget?.agentId
    || backgroundImportMutation.isPending;
  const backgroundImportError = backgroundImportMutation.error instanceof Error
    ? backgroundImportMutation.error.message
    : null;
  const clearBackgroundMutation = useMutation({
    mutationFn: async () => {
      if (!input.accountId || !input.activeTarget?.agentId || !selectedBackgroundAssetId) {
        return null;
      }
      return removeAgentCenterBackground({
        accountId: input.accountId,
        agentId: input.activeTarget.agentId,
        backgroundAssetId: selectedBackgroundAssetId,
      });
    },
    onSuccess: async (result) => {
      if (!result || !input.accountId || !input.activeTarget?.agentId) {
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentCenterLocalConfigQueryKey(input.accountId, input.activeTarget.agentId),
        }),
        queryClient.invalidateQueries({ queryKey: ['agent-center-background-asset'] }),
      ]);
    },
  });
  const avatarHandoffReady = hasTauriInvoke();
  const [avatarActionPending, setAvatarActionPending] = useState(false);
  const avatarInstanceId = useMemo(() => (
    input.activeTarget
      ? buildDesktopAvatarInstanceId({
        agentId: input.activeTarget.agentId,
        threadId: input.activeThreadId,
        conversationAnchorId: input.activeConversationAnchorId,
      })
      : null
  ), [input.activeConversationAnchorId, input.activeTarget, input.activeThreadId]);
  const avatarLiveInstancesQuery = useQuery({
    queryKey: input.activeTarget?.agentId
      ? desktopAvatarInstanceRegistryQueryKey(input.activeTarget.agentId)
      : ['desktop-avatar-instance-registry', 'none'],
    queryFn: async () => (
      input.activeTarget?.agentId
        ? listDesktopAvatarLiveInstances(input.activeTarget.agentId)
        : []
    ),
    enabled: avatarHandoffReady && avatarPackageValid && Boolean(input.activeTarget?.agentId),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    refetchInterval: avatarHandoffReady && avatarPackageValid && input.activeTarget?.agentId ? 5_000 : false,
  });
  const runningAvatarInstance = avatarInstanceId
    ? avatarLiveInstancesQuery.data?.find((instance) => instance.avatarInstanceId === avatarInstanceId) || null
    : null;
  const avatarRunning = Boolean(runningAvatarInstance);
  const handleComposerAvatarAction = useCallback(async () => {
    if (
      !input.accountId
      || !input.activeTarget
      || !selectedAvatarPackage
      || !avatarConfigured
      || !avatarPackageValid
      || !avatarHandoffReady
      || !avatarInstanceId
    ) {
      input.onOpenAgentCenter?.();
      return null;
    }
    setAvatarActionPending(true);
    try {
      if (avatarRunning) {
        const result = await closeDesktopAvatarHandoff({
          avatarInstanceId,
          bindingId: runningAvatarInstance?.scopedBinding?.bindingId || null,
          closedBy: 'desktop',
          sourceSurface: 'desktop-agent-chat',
        });
        await avatarLiveInstancesQuery.refetch();
        return {
          kind: result.opened ? 'success' as const : 'warning' as const,
          message: result.opened
            ? input.t('Chat.agentCenterAvatarStopSuccess', { defaultValue: 'Avatar close request sent.' })
            : input.t('Chat.agentCenterAvatarStopUnconfirmed', { defaultValue: 'Close request was sent, but the OS did not confirm it.' }),
        };
      }
      const anchorMode = input.activeConversationAnchorId ? 'existing' : 'open_new';
      const result = await launchDesktopAvatarHandoff({
        agentId: input.activeTarget.agentId,
        avatarPackage: {
          kind: selectedAvatarPackage.kind,
          packageId: selectedAvatarPackage.package_id,
        },
        avatarInstanceId,
        conversationAnchorId: input.activeConversationAnchorId,
        anchorMode,
        launchedBy: 'nimi.desktop',
        runtimeAppId: 'nimi.desktop',
        sourceSurface: 'desktop-agent-chat',
        worldId: input.activeTarget.worldId,
      });
      await avatarLiveInstancesQuery.refetch();
      return {
        kind: result.opened ? 'success' as const : 'warning' as const,
        message: result.opened
          ? input.t('Chat.agentCenterAvatarStartSuccess', { defaultValue: 'Avatar opened in Nimi Avatar.' })
          : input.t('Chat.agentCenterAvatarStartUnconfirmed', { defaultValue: 'Launch request was sent, but the OS did not confirm it.' }),
      };
    } finally {
      setAvatarActionPending(false);
    }
  }, [
    avatarConfigured,
    avatarPackageValid,
    avatarHandoffReady,
    avatarInstanceId,
    avatarLiveInstancesQuery,
    avatarRunning,
    input.activeConversationAnchorId,
    input.activeTarget,
    input.accountId,
    input.onOpenAgentCenter,
    input.t,
    runningAvatarInstance,
    selectedAvatarPackage,
  ]);
  const avatarComposerActionState = !avatarConfigured
    ? 'not_configured'
    : avatarPackageChecking
      ? 'pending'
      : !avatarPackageValid
        ? 'package_invalid'
        : avatarActionPending
          ? 'pending'
          : !avatarHandoffReady
            ? 'unavailable'
            : avatarRunning
              ? 'running'
              : 'ready_stopped';
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
    transcriptWidthClassName: CHAT_CONTENT_WIDTH_CLASS,
    transcriptWidthPositionClassName: CHAT_CONTENT_POSITION_CLASS,
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
  const diagnosticsContent = <AgentConversationDiagnosticsContent input={input} />;
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
      <AgentConversationSettingsContent
        input={input}
        diagnosticsContent={diagnosticsContent}
        avatarPackageValid={avatarPackageValid}
        backgroundValid={backgroundValid}
        avatarPackageChecking={avatarPackageChecking}
        selectedAvatarPackage={selectedAvatarPackage}
        avatarPackageValidationQuery={avatarPackageValidationQuery}
        avatarImportError={avatarImportError}
        clearAvatarPackageMutation={clearAvatarPackageMutation}
        avatarImportDisabled={avatarImportDisabled}
        avatarPackageImportMutation={avatarPackageImportMutation}
        avatarActionPending={avatarActionPending}
        selectedBackgroundAssetId={selectedBackgroundAssetId}
        backgroundAssetQuery={backgroundAssetQuery}
        backgroundValidation={backgroundValidation}
        backgroundImportError={backgroundImportError}
        clearBackgroundMutation={clearBackgroundMutation}
        backgroundImportDisabled={backgroundImportDisabled}
        backgroundImportMutation={backgroundImportMutation}
      />
    ),
    settingsDrawerTitle: input.t('Chat.agentCenterTitle', { defaultValue: 'Agent Center' }),
    settingsDrawerSubtitle: resolvedAgentDisplayName,
    settingsDrawerWorld: input.activeTarget?.worldName || null,
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
            avatarAction={{
              state: avatarComposerActionState,
              onConfigure: input.onOpenAgentCenter,
              onActivate: handleComposerAvatarAction,
            }}
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
    setupDescription: input.t('Chat.agentRouteRequired', {
      defaultValue: 'Agent mode requires a local or cloud runtime route. Configure one in runtime settings.',
    }),
  }), [
    adapter,
    diagnosticsContent,
    hostFeedbackNode,
    schedulingFeedbackNode,
    hostSnapshot,
    agentCenterLocalConfigQuery.data,
    characterData.name,
    characterData.avatarUrl,
    characterData.avatarFallback,
    avatarConfigured,
    avatarImportDisabled,
    avatarImportError,
    avatarPackageChecking,
    avatarPackageImportMutation,
    avatarPackageValidationQuery.data,
    avatarPackageValid,
    avatarComposerActionState,
    avatarActionPending,
    avatarHandoffReady,
    avatarRunning,
    backgroundImportDisabled,
    backgroundImportError,
    backgroundImportMutation,
    backgroundAssetQuery.data,
    backgroundAssetQuery.isFetching,
    backgroundValidation,
    backgroundValid,
    clearAvatarPackageMutation,
    clearBackgroundMutation,
    selectedBackgroundAssetId,
    selectedAvatarPackage,
    handleComposerAvatarAction,
    input.activeTarget,
    input.activeConversationAnchorId,
    input.activeThreadId,
    input.agentRouteReady,
    input.mutationPendingAction,
    input.behaviorSettings,
    input.bundle?.draft?.text,
    input.bundle?.draft?.updatedAtMs,
    input.currentDraftTextRef,
    input.handleSubmit,
    input.onAttachmentsChange,
    input.onDismissHostFeedback,
    input.onEnableAutonomy,
    input.onDisableAutonomy,
    input.onUpdateAutonomyConfig,
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
    input.cognitionContent,
    input.onOpenAgentCenter,
  ]);
}
