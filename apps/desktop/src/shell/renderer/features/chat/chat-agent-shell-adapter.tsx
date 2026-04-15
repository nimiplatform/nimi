import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  createReadyConversationSetupState,
} from '@nimiplatform/nimi-kit/features/chat';
import {
  type CanonicalMessageAccessorySlot,
  ConversationOrchestrationRegistry,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import { type RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { DesktopConversationModeHost } from './chat-mode-host-types';
import {
  type AgentTurnLifecycleState,
} from './chat-agent-shell-lifecycle';
import {
  type AgentHostFlowFooterState,
} from './chat-agent-shell-host-flow';
import { createAgentLocalChatConversationProvider } from './chat-agent-orchestration';
import type { AgentConversationSelection } from './chat-shell-types';
import {
  RuntimeAgentDebugMessageAccessory,
  RuntimeImageMessageContent,
  RuntimeVoiceMessageContent,
  createReasoningMessageContentRenderer,
} from './chat-runtime-stream-ui';
import {
  getChatThinkingUnsupportedCopy,
  resolveAgentThinkingSupportFromProjection,
} from './chat-thinking';
import {
  loadStoredAgentChatExperienceSettings,
  persistStoredAgentChatExperienceSettings,
  type AgentChatExperienceSettings,
} from './chat-settings-storage';
import {
  loadStoredPerformancePreferences,
  subscribeStoredPerformancePreferences,
} from '../settings/settings-storage';
import { resolveAgentChatBehavior } from './chat-agent-behavior-resolver';
import { type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import { upsertBundleDraft, toErrorMessage } from './chat-agent-shell-core';
import { useAgentConversationPresentation } from './chat-agent-shell-presentation';
import { useAgentConversationEffects } from './chat-agent-shell-effects';
import { useAgentConversationCapabilityEffects } from './chat-agent-shell-capability-effects';
import { useSchedulingFeasibility } from './chat-execution-scheduling-guard';
import { useAgentConversationHostActions } from './chat-agent-shell-host-actions';
import { logRendererEvent } from '@renderer/bridge/runtime-bridge/logging';
import { confirmDialog } from '@renderer/bridge/runtime-bridge/ui';
import type { PendingAttachment } from '../turns/turn-input-attachments';
import { clearPendingAttachments } from '../turns/turn-input-attachments';
import { ChatAgentHistoryPanel } from './chat-agent-history-panel';
import { useAgentConversationVoiceSession } from './chat-agent-shell-adapter-voice';
import { useAgentConversationShellState } from './chat-agent-shell-adapter-state';
import { useAgentConversationMessageMenu } from './chat-agent-shell-adapter-menu';
import { resolveAgentChatRequestedMaxOutputTokens } from './chat-ai-route-view';
import {
  createRuntimeAgentMemoryAdapter,
  type CanonicalMemoryBankStatus,
} from '@renderer/infra/runtime-agent-memory';
import {
  createRuntimeAgentInspectAdapter,
  type RuntimeAgentInspectEventSummary,
  type RuntimeAgentInspectSnapshot,
} from '@renderer/infra/runtime-agent-inspect';

type UseAgentConversationModeHostInput = {
  authStatus: 'bootstrapping' | 'anonymous' | 'authenticated';
  diagnosticsVisible: boolean;
  onDiagnosticsVisibilityChange?: (visible: boolean) => void;
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  selection: AgentConversationSelection;
  lastSelectedThreadId: string | null;
  setSelection: (selection: AgentConversationSelection) => void;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireRuntimeSubjectUserId(): string {
  const subjectUserId = normalizeText((useAppStore.getState().auth.user as Record<string, unknown> | null)?.id);
  if (!subjectUserId) {
    throw new Error('desktop agent shell requires authenticated subject user id for runtime.agentCore');
  }
  return subjectUserId;
}

export function useAgentConversationModeHost(
  input: UseAgentConversationModeHostInput,
): DesktopConversationModeHost {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const agentAdapterAiConfig = useAppStore((state) => state.aiConfig);
  const textCapabilityProjection = useAppStore(
    (state) => state.conversationCapabilityProjectionByCapability['text.generate'] || null,
  );
  const imageCapabilityProjection = useAppStore(
    (state) => state.conversationCapabilityProjectionByCapability['image.generate'] || null,
  );
  const voiceCapabilityProjection = useAppStore(
    (state) => state.conversationCapabilityProjectionByCapability['audio.synthesize'] || null,
  );
  const transcribeCapabilityProjection = useAppStore(
    (state) => state.conversationCapabilityProjectionByCapability['audio.transcribe'] || null,
  );
  const [submittingThreadId, setSubmittingThreadId] = useState<string | null>(null);
  const [hostFeedback, setHostFeedback] = useState<InlineFeedbackState | null>(null);
  const [behaviorSettings, setBehaviorSettingsState] = useState<AgentChatExperienceSettings>(
    () => loadStoredAgentChatExperienceSettings(),
  );
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(
    () => loadStoredPerformancePreferences().developerMode === true,
  );
  const schedulingJudgement = useSchedulingFeasibility();
  const [footerHostStateByThreadId, setFooterHostStateByThreadId] = useState<
    Record<string, {
      footerState: AgentHostFlowFooterState;
      lifecycle: AgentTurnLifecycleState;
    }>
  >({});
  const [pendingAttachmentsByThreadId, setPendingAttachmentsByThreadId] = useState<Record<string, readonly PendingAttachment[]>>({});
  const currentDraftTextRef = useRef('');
  const pendingAttachmentsByThreadRef = useRef<Record<string, readonly PendingAttachment[]>>({});
  const [canonicalMemoryStatus, setCanonicalMemoryStatus] = useState<CanonicalMemoryBankStatus | null>(null);
  const [canonicalMemoryLoading, setCanonicalMemoryLoading] = useState(false);
  const [runtimeInspect, setRuntimeInspect] = useState<RuntimeAgentInspectSnapshot | null>(null);
  const [runtimeInspectLoading, setRuntimeInspectLoading] = useState(false);
  const [recentRuntimeEvents, setRecentRuntimeEvents] = useState<readonly RuntimeAgentInspectEventSummary[]>([]);
  const [mutationPendingAction, setMutationPendingAction] = useState<string | null>(null);
  const runtimeAgentMemory = useMemo(() => createRuntimeAgentMemoryAdapter({
    getSubjectUserId: requireRuntimeSubjectUserId,
  }), []);
  const runtimeAgentInspect = useMemo(() => createRuntimeAgentInspectAdapter({
    getSubjectUserId: requireRuntimeSubjectUserId,
  }), []);
  const registry = useMemo(() => {
    const nextRegistry = new ConversationOrchestrationRegistry();
    nextRegistry.register(createAgentLocalChatConversationProvider());
    return nextRegistry;
  }, []);
  const agentProvider = useMemo(
    () => registry.require('agent-local-chat-v1'),
    [registry],
  );
  const reportHostError = useCallback((error: unknown) => {
    const message = toErrorMessage(error);
    logRendererEvent({
      level: 'error',
      area: 'agent-chat-shell',
      message: 'action:host-error',
      details: {
        error: message,
      },
    });
    setHostFeedback({
      kind: 'error',
      message,
    });
  }, []);
  const thinkingSupport = useMemo(
    () => resolveAgentThinkingSupportFromProjection(textCapabilityProjection),
    [textCapabilityProjection],
  );
  const setBehaviorSettings = useCallback((nextSettings: AgentChatExperienceSettings) => {
    persistStoredAgentChatExperienceSettings(nextSettings);
    setBehaviorSettingsState(nextSettings);
  }, []);
  useEffect(() => subscribeStoredPerformancePreferences((preferences) => {
    setDeveloperModeEnabled(preferences.developerMode === true);
  }), []);
  useEffect(() => {
    pendingAttachmentsByThreadRef.current = pendingAttachmentsByThreadId;
  }, [pendingAttachmentsByThreadId]);
  useEffect(() => () => {
    for (const attachments of Object.values(pendingAttachmentsByThreadRef.current)) {
      clearPendingAttachments([...attachments], (url) => URL.revokeObjectURL(url));
    }
  }, []);
  const thinkingUnsupportedReason = useMemo(() => {
    if (thinkingSupport.supported || !thinkingSupport.reason) {
      return null;
    }
    const copy = getChatThinkingUnsupportedCopy(thinkingSupport.reason);
    return t(copy.key, { defaultValue: copy.defaultValue });
  }, [t, thinkingSupport]);
  const reloadRuntimeInspect = useCallback(async (
    agentId: string,
    options?: { surfaceErrors?: boolean },
  ) => {
    const normalizedAgentId = normalizeText(agentId);
    if (!normalizedAgentId || input.authStatus !== 'authenticated') {
      setRuntimeInspect(null);
      setRuntimeInspectLoading(false);
      return;
    }
    setRuntimeInspectLoading(true);
    try {
      const snapshot = await runtimeAgentInspect.getPublicInspect(normalizedAgentId);
      setRuntimeInspect(snapshot);
    } catch (error) {
      setRuntimeInspect(null);
      if (options?.surfaceErrors) {
        reportHostError(error);
      } else {
        logRendererEvent({
          level: 'warn',
          area: 'agent-chat-shell',
          message: 'action:host-error',
          details: {
            error: error instanceof Error ? error.message : String(error || ''),
          },
        });
      }
    } finally {
      setRuntimeInspectLoading(false);
    }
  }, [input.authStatus, reportHostError, runtimeAgentInspect]);
  const refreshRuntimeInspectIfVisible = useCallback(async (
    agentId: string,
    options?: { surfaceErrors?: boolean },
  ) => {
    if (!input.diagnosticsVisible) {
      return;
    }
    await reloadRuntimeInspect(agentId, options);
  }, [input.diagnosticsVisible, reloadRuntimeInspect]);

  const setSelection = useCallback((selection: AgentConversationSelection) => {
    if (
      input.selection.threadId === selection.threadId
      && input.selection.agentId === selection.agentId
      && input.selection.targetId === selection.targetId
    ) {
      return;
    }
    input.setSelection(selection);
  }, [input]);
  const {
    activeTarget,
    activeThreadId,
    agentResolution,
    agentRouteReady,
    bundle,
    bundleError,
    handleModelSelectionChange,
    initialModelSelection,
    isBundleLoading,
    messages,
    selectedThreadRecord,
    streamState,
    targetByAgentId,
    targets,
    targetsPending,
    targetsReady,
    textRouteModelProfile,
    threads,
    threadsReady,
  } = useAgentConversationShellState({
    aiConfig: agentAdapterAiConfig,
    authStatus: input.authStatus,
    bootstrapReady,
    lastSelectedThreadId: input.lastSelectedThreadId,
    selection: input.selection,
  });

  useEffect(() => {
    let cancelled = false;
    const agentId = normalizeText(activeTarget?.agentId);
    if (input.authStatus !== 'authenticated' || !agentId) {
      setCanonicalMemoryStatus(null);
      setCanonicalMemoryLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setCanonicalMemoryLoading(true);
    void runtimeAgentMemory.getCanonicalBankStatus(agentId)
      .then((status) => {
        if (cancelled) {
          return;
        }
        setCanonicalMemoryStatus(status);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setCanonicalMemoryStatus({ mode: 'unavailable' });
        logRendererEvent({
          level: 'warn',
          area: 'agent-chat-shell',
          message: 'action:host-error',
          details: {
            error: error instanceof Error ? error.message : String(error || ''),
          },
        });
      })
      .finally(() => {
        if (!cancelled) {
          setCanonicalMemoryLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeTarget?.agentId, input.authStatus, reportHostError, runtimeAgentMemory]);
  useEffect(() => {
    let cancelled = false;
    const agentId = normalizeText(activeTarget?.agentId);
    if (input.authStatus !== 'authenticated' || !agentId || !input.diagnosticsVisible) {
      setRuntimeInspect(null);
      setRuntimeInspectLoading(false);
      setRecentRuntimeEvents([]);
      return () => {
        cancelled = true;
      };
    }
    setRuntimeInspectLoading(true);
    void runtimeAgentInspect.getPublicInspect(agentId)
      .then((snapshot) => {
        if (cancelled) {
          return;
        }
        setRuntimeInspect(snapshot);
        setRecentRuntimeEvents([]);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setRuntimeInspect(null);
        logRendererEvent({
          level: 'warn',
          area: 'agent-chat-shell',
          message: 'action:host-error',
          details: {
            error: error instanceof Error ? error.message : String(error || ''),
          },
        });
      })
      .finally(() => {
        if (!cancelled) {
          setRuntimeInspectLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeTarget?.agentId, input.authStatus, input.diagnosticsVisible, runtimeAgentInspect]);
  useEffect(() => {
    const agentId = normalizeText(activeTarget?.agentId);
    if (input.authStatus !== 'authenticated' || !agentId || !input.diagnosticsVisible) {
      setRecentRuntimeEvents([]);
      return;
    }
    const controller = new AbortController();
    void runtimeAgentInspect.subscribePublicEvents({
      agentId,
      signal: controller.signal,
      onEvent: (event) => {
        setRecentRuntimeEvents((current) => {
          // Skip state update when the most recent entry already matches this
          // sequence — avoids a redundant re-render on duplicate events.
          if (current.length > 0 && current[0]?.sequence === event.sequence) {
            return current;
          }
          const next = [event, ...current.filter((item) => item.sequence !== event.sequence)];
          return next.slice(0, 8);
        });
      },
    }).catch((error) => {
      if (controller.signal.aborted) {
        return;
      }
      logRendererEvent({
        level: 'warn',
        area: 'agent-chat-shell',
        message: 'action:host-error',
        details: {
          error: error instanceof Error ? error.message : String(error || ''),
        },
      });
    });
    return () => {
      controller.abort();
    };
  }, [activeTarget?.agentId, input.authStatus, input.diagnosticsVisible, runtimeAgentInspect]);
  const handleEnableAutonomy = useCallback(() => {
    const agentId = normalizeText(activeTarget?.agentId);
    const targetName = normalizeText(activeTarget?.displayName) || agentId;
    if (!agentId) {
      return;
    }
    setMutationPendingAction('Enabling autonomy…');
    void runtimeAgentInspect.enableAutonomy(agentId)
      .then(async () => {
        await refreshRuntimeInspectIfVisible(agentId);
        setHostFeedback({
          kind: 'success',
          message: t('Chat.agentAutonomyEnabled', {
            defaultValue: '{{name}} autonomy enabled.',
            name: targetName,
          }),
        });
      })
      .catch(reportHostError)
      .finally(() => {
        setMutationPendingAction(null);
      });
  }, [activeTarget?.agentId, activeTarget?.displayName, refreshRuntimeInspectIfVisible, reportHostError, runtimeAgentInspect, t]);
  const handleDisableAutonomy = useCallback(() => {
    const agentId = normalizeText(activeTarget?.agentId);
    const targetName = normalizeText(activeTarget?.displayName) || agentId;
    if (!agentId) {
      return;
    }
    void (async () => {
      const confirmation = await confirmDialog({
        title: t('Chat.disableAgentAutonomyTitle', { defaultValue: 'Disable autonomy' }),
        description: t('Chat.disableAgentAutonomyConfirm', {
          defaultValue: 'Disable runtime autonomy for {{name}}? Pending hooks remain visible but life-track execution will stop until autonomy is enabled again.',
          name: targetName,
        }),
        level: 'warning',
      });
      if (!confirmation.confirmed) {
        return;
      }
      setMutationPendingAction('Disabling autonomy…');
      await runtimeAgentInspect.disableAutonomy({
        agentId,
        reason: 'desktop_agent_chat_diagnostics_disable',
      });
      await refreshRuntimeInspectIfVisible(agentId);
      setHostFeedback({
        kind: 'success',
        message: t('Chat.agentAutonomyDisabled', {
          defaultValue: '{{name}} autonomy disabled.',
          name: targetName,
        }),
      });
    })().catch(reportHostError).finally(() => {
      setMutationPendingAction(null);
    });
  }, [activeTarget?.agentId, activeTarget?.displayName, refreshRuntimeInspectIfVisible, reportHostError, runtimeAgentInspect, t]);
  const handleCancelPendingHook = useCallback((hookId: string) => {
    const agentId = normalizeText(activeTarget?.agentId);
    const normalizedHookId = normalizeText(hookId);
    if (!agentId || !normalizedHookId) {
      return;
    }
    void (async () => {
      const confirmation = await confirmDialog({
        title: t('Chat.cancelAgentHookTitle', { defaultValue: 'Cancel pending hook' }),
        description: t('Chat.cancelAgentHookConfirm', {
          defaultValue: 'Cancel pending hook {{hookId}} for this agent?',
          hookId: normalizedHookId,
        }),
        level: 'warning',
      });
      if (!confirmation.confirmed) {
        return;
      }
      setMutationPendingAction(`Canceling ${normalizedHookId}…`);
      await runtimeAgentInspect.cancelHook({
        agentId,
        hookId: normalizedHookId,
        reason: 'desktop_agent_chat_diagnostics_cancel',
      });
      await refreshRuntimeInspectIfVisible(agentId);
      setHostFeedback({
        kind: 'success',
        message: t('Chat.agentHookCanceled', {
          defaultValue: 'Canceled pending hook {{hookId}}.',
          hookId: normalizedHookId,
        }),
      });
    })().catch(reportHostError).finally(() => {
      setMutationPendingAction(null);
    });
  }, [activeTarget?.agentId, refreshRuntimeInspectIfVisible, reportHostError, runtimeAgentInspect, t]);
  const handleUpdateAutonomyConfig = useCallback((config: {
    dailyTokenBudget: string;
    maxTokensPerHook: string;
  }) => {
    const agentId = normalizeText(activeTarget?.agentId);
    const targetName = normalizeText(activeTarget?.displayName) || agentId;
    if (!agentId) {
      return;
    }
    setMutationPendingAction('Updating autonomy config…');
    void runtimeAgentInspect.setAutonomyConfig({
      agentId,
      dailyTokenBudget: config.dailyTokenBudget,
      maxTokensPerHook: config.maxTokensPerHook,
    })
      .then(async () => {
        await refreshRuntimeInspectIfVisible(agentId);
        setHostFeedback({
          kind: 'success',
          message: t('Chat.agentAutonomyConfigUpdated', {
            defaultValue: '{{name}} autonomy config updated.',
            name: targetName,
          }),
        });
      })
      .catch(reportHostError)
      .finally(() => {
        setMutationPendingAction(null);
      });
  }, [activeTarget?.agentId, activeTarget?.displayName, refreshRuntimeInspectIfVisible, reportHostError, runtimeAgentInspect, t]);
  const handleUpdateRuntimeState = useCallback((stateInput: {
    statusText: string;
    worldId: string;
    userId: string;
  }) => {
    const agentId = normalizeText(activeTarget?.agentId);
    const targetName = normalizeText(activeTarget?.displayName) || agentId;
    if (!agentId) {
      return;
    }
    const nextStatusText = normalizeText(stateInput.statusText);
    const nextWorldId = normalizeText(stateInput.worldId);
    const nextUserId = normalizeText(stateInput.userId);
    const currentStatusText = normalizeText(runtimeInspect?.statusText);
    const currentWorldId = normalizeText(runtimeInspect?.activeWorldId);
    const currentUserId = normalizeText(runtimeInspect?.activeUserId);
    const payload: {
      agentId: string;
      statusText?: string;
      worldId?: string;
      userId?: string;
    } = { agentId };
    if (nextStatusText !== currentStatusText) {
      payload.statusText = nextStatusText;
    }
    if (nextWorldId && nextWorldId !== currentWorldId) {
      payload.worldId = nextWorldId;
    }
    if (nextUserId && nextUserId !== currentUserId) {
      payload.userId = nextUserId;
    }
    if (!('statusText' in payload) && !('worldId' in payload) && !('userId' in payload)) {
      setHostFeedback({
        kind: 'info',
        message: t('Chat.agentRuntimeStateUnchanged', {
          defaultValue: 'No runtime state changes to apply for {{name}}.',
          name: targetName,
        }),
      });
      return;
    }
    setMutationPendingAction('Updating runtime state…');
    void runtimeAgentInspect.updateState(payload)
      .then(async () => {
        await refreshRuntimeInspectIfVisible(agentId);
        setHostFeedback({
          kind: 'success',
          message: t('Chat.agentRuntimeStateUpdated', {
            defaultValue: '{{name}} runtime state updated.',
            name: targetName,
          }),
        });
      })
      .catch(reportHostError)
      .finally(() => {
        setMutationPendingAction(null);
      });
  }, [activeTarget?.agentId, activeTarget?.displayName, refreshRuntimeInspectIfVisible, reportHostError, runtimeAgentInspect, t]);
  const handleClearWorldContext = useCallback(() => {
    const agentId = normalizeText(activeTarget?.agentId);
    const targetName = normalizeText(activeTarget?.displayName) || agentId;
    if (!agentId || !normalizeText(runtimeInspect?.activeWorldId)) {
      return;
    }
    setMutationPendingAction('Clearing world context…');
    void runtimeAgentInspect.updateState({
      agentId,
      clearWorldContext: true,
    })
      .then(async () => {
        await refreshRuntimeInspectIfVisible(agentId);
        setHostFeedback({
          kind: 'success',
          message: t('Chat.agentWorldContextCleared', {
            defaultValue: '{{name}} world context cleared.',
            name: targetName,
          }),
        });
      })
      .catch(reportHostError)
      .finally(() => {
        setMutationPendingAction(null);
      });
  }, [activeTarget?.agentId, activeTarget?.displayName, refreshRuntimeInspectIfVisible, reportHostError, runtimeAgentInspect, t]);
  const handleClearDyadicContext = useCallback(() => {
    const agentId = normalizeText(activeTarget?.agentId);
    const targetName = normalizeText(activeTarget?.displayName) || agentId;
    if (!agentId || !normalizeText(runtimeInspect?.activeUserId)) {
      return;
    }
    setMutationPendingAction('Clearing dyadic context…');
    void runtimeAgentInspect.updateState({
      agentId,
      clearDyadicContext: true,
    })
      .then(async () => {
        await refreshRuntimeInspectIfVisible(agentId);
        setHostFeedback({
          kind: 'success',
          message: t('Chat.agentDyadicContextCleared', {
            defaultValue: '{{name}} dyadic context cleared.',
            name: targetName,
          }),
        });
      })
      .catch(reportHostError)
      .finally(() => {
        setMutationPendingAction(null);
      });
  }, [activeTarget?.agentId, activeTarget?.displayName, refreshRuntimeInspectIfVisible, reportHostError, runtimeInspect, t]);
  const handleRefreshRuntimeInspect = useCallback(() => {
    const agentId = normalizeText(activeTarget?.agentId);
    if (!agentId) {
      return;
    }
    void refreshRuntimeInspectIfVisible(agentId, { surfaceErrors: true });
  }, [activeTarget?.agentId, refreshRuntimeInspectIfVisible]);
  useAgentConversationCapabilityEffects({
    bootstrapReady,
    textCapabilityProjection,
    imageCapabilityProjection,
  });

  const setupState = useMemo(() => {
    if (input.authStatus !== 'authenticated') {
      return {
        mode: 'agent' as const,
        status: 'setup-required' as const,
        issues: [{ code: 'agent-contract-unavailable' as const, detail: 'Sign in to use Agent mode' }],
        primaryAction: {
          kind: 'sign-in' as const,
          returnToMode: 'agent' as const,
        },
      };
    }
    return createReadyConversationSetupState('agent');
  }, [bootstrapReady, input.authStatus]);

  const composerReady = setupState.status === 'ready'
    && !isBundleLoading
    && !bundleError;

  const {
    applyDriverEffects,
    setBundleCache,
    setFooterHostState,
    setThreadsCache,
    syncSelectionToThread,
  } = useAgentConversationEffects({
    currentDraftTextRef,
    queryClient,
    setFooterHostStateByThreadId,
    setSelection,
  });

  const reasoningLabel = t('Chat.reasoningLabel', { defaultValue: 'Thought process' });
  const renderReasoningMessageContent = useMemo(
    () => createReasoningMessageContentRenderer(reasoningLabel),
    [reasoningLabel],
  );
  const renderMessageContent = useMemo(() => (
    (
      message: Parameters<NonNullable<typeof renderReasoningMessageContent>>[0],
      context: Parameters<NonNullable<typeof renderReasoningMessageContent>>[1],
    ) => {
      if (message.kind === 'image' || message.kind === 'image-pending') {
        return (
          <RuntimeImageMessageContent
            message={message}
            imageLabel={t('ChatTimeline.imageMessage', 'Image')}
            showCaptionLabel={t('ChatTimeline.showImagePrompt', 'Show prompt')}
            hideCaptionLabel={t('ChatTimeline.hideImagePrompt', 'Hide prompt')}
          />
        );
      }
      if (message.kind === 'voice') {
        return (
          <RuntimeVoiceMessageContent
            message={message}
            voiceLabel={t('Chat.voiceInspectTitle', { defaultValue: 'Voice inspect' })}
            transcriptLabel={t('Chat.voiceInspectTranscriptTitle', { defaultValue: 'Transcript' })}
            showTranscriptLabel={t('Chat.voiceTranscribe', { defaultValue: 'Transcribe voice' })}
            hideTranscriptLabel={t('Chat.voiceCollapseTranscript', { defaultValue: 'Collapse transcript' })}
            transcriptUnavailableLabel={t('Chat.voiceInspectTranscriptUnavailable', { defaultValue: 'No transcript available for this voice beat.' })}
          />
        );
      }
      return renderReasoningMessageContent(message, context);
    }
  ), [renderReasoningMessageContent, t]);
  const renderMessageAccessory = useMemo<CanonicalMessageAccessorySlot>(() => (
    (message) => {
      if ((message.kind || 'text') !== 'text' || (message.role !== 'assistant' && message.role !== 'agent')) {
        return undefined;
      }
      return (
        <RuntimeAgentDebugMessageAccessory
          message={message}
          debugVisible={developerModeEnabled}
          summaryLabel={t('Chat.agentDebugSummary', { defaultValue: 'Show debug prompt / returned data' })}
          copyLabel={t('Chat.agentDebugCopyLabel', { defaultValue: 'Copy' })}
          copiedLabel={t('Chat.agentDebugCopiedLabel', { defaultValue: 'Copied' })}
          followUpLabel={t('Chat.agentDebugFollowUpLabel', { defaultValue: 'Auto follow-up' })}
          followUpInstructionLabel={t('Chat.agentDebugFollowUpInstructionLabel', { defaultValue: 'Follow-up instruction' })}
          promptLabel={t('Chat.agentDebugPromptLabel', { defaultValue: 'Prompt' })}
          systemPromptLabel={t('Chat.agentDebugSystemPromptLabel', { defaultValue: 'System Prompt' })}
          rawOutputLabel={t('Chat.agentDebugRawOutputLabel', { defaultValue: 'Raw Model Output' })}
          normalizedOutputLabel={t('Chat.agentDebugNormalizedOutputLabel', { defaultValue: 'Normalized Model Output' })}
        />
      );
    }
  ), [developerModeEnabled, t]);
  const currentFooterHostState = activeThreadId ? footerHostStateByThreadId[activeThreadId] || null : null;
  const activePendingAttachments = activeThreadId
    ? (pendingAttachmentsByThreadId[activeThreadId] || [])
    : [];
  const setPendingAttachmentsForThread = useCallback((threadId: string | null, nextAttachments: readonly PendingAttachment[]) => {
    const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : '';
    if (!normalizedThreadId) {
      return;
    }
    setPendingAttachmentsByThreadId((current) => {
      const existing = current[normalizedThreadId] || [];
      const nextUrlSet = new Set(nextAttachments.map((attachment) => attachment.previewUrl));
      for (const attachment of existing) {
        if (!nextUrlSet.has(attachment.previewUrl)) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      }
      if (nextAttachments.length === 0) {
        if (!(normalizedThreadId in current)) {
          return current;
        }
        const { [normalizedThreadId]: _removed, ...rest } = current;
        return rest;
      }
      return {
        ...current,
        [normalizedThreadId]: [...nextAttachments],
      };
    });
  }, []);
  const persistVoiceTranscriptDraft = useCallback(async (text: string) => {
    if (!activeThreadId) {
      throw new Error('Voice input is unavailable because no active thread is selected.');
    }
    const draft = await chatAgentStoreClient.putDraft({
      threadId: activeThreadId,
      text,
      updatedAtMs: Date.now(),
    });
    currentDraftTextRef.current = text;
    setBundleCache(
      activeThreadId,
      (current) => upsertBundleDraft(current, draft) || current,
    );
  }, [activeThreadId, currentDraftTextRef, setBundleCache]);
  const {
    clearLatestVoiceCaptureForThread,
    handsFreeState,
    latestVoiceCaptureByThreadRef,
    onVoiceSessionCancel,
    onVoiceSessionToggle,
    voiceSessionState,
  } = useAgentConversationVoiceSession({
    activeTarget,
    activeThreadId,
    aiConfig: agentAdapterAiConfig,
    agentResolution,
    bundleMessages: bundle?.messages,
    persistVoiceTranscriptDraft,
    reportHostError,
    setBundleCache,
    submittingThreadId,
    t,
    transcribeCapabilityProjection,
    voiceCapabilityProjection,
  });
  const agentAiConfig = useAppStore((state) => state.aiConfig);
  const { handleDeleteMessage, handleDeleteThread, handleSelectAgent, handleSelectThread, handleSubmit } = useAgentConversationHostActions({
    activeTarget,
    activeThreadId,
    aiConfig: agentAiConfig,
    applyDriverEffects,
    bundle,
    currentDraftTextRef,
    draftText: bundle?.draft?.text,
    draftUpdatedAtMs: bundle?.draft?.updatedAtMs,
    latestVoiceCaptureByThreadRef,
    queryClient,
    reportHostError,
    runAgentTurn: (turnInput) => agentProvider.runTurn({
      modeId: 'agent-local-chat-v1',
      threadId: turnInput.threadId,
      turnId: turnInput.turnId,
      userMessage: turnInput.userMessage,
      history: turnInput.history,
      signal: turnInput.signal,
      metadata: {
        agentLocalChat: {
          agentId: turnInput.target.agentId,
          targetSnapshot: turnInput.target,
          agentResolution: turnInput.agentResolution,
          textExecutionSnapshot: turnInput.textExecutionSnapshot,
          imageExecutionSnapshot: turnInput.imageExecutionSnapshot,
          voiceExecutionSnapshot: turnInput.voiceExecutionSnapshot,
          voiceWorkflowExecutionSnapshotByCapability: turnInput.voiceWorkflowExecutionSnapshotByCapability,
          latestVoiceCapture: turnInput.latestVoiceCapture,
          imageCapabilityParams: (
            agentAiConfig.capabilities.selectedParams['image.generate'] || null
          ) as Record<string, unknown> | null,
          runtimeConfigState: input.runtimeConfigState,
          runtimeFields: input.runtimeFields,
          reasoningPreference: behaviorSettings.thinkingPreference,
          textModelContextTokens: textRouteModelProfile?.maxContextTokens ?? null,
          textMaxOutputTokensRequested: resolveAgentChatRequestedMaxOutputTokens(textRouteModelProfile),
          resolvedBehavior: resolveAgentChatBehavior({
            userText: turnInput.userMessage.text,
            settings: behaviorSettings,
          }),
        },
      },
    }),
    selectedAgentId: input.selection.agentId,
    selectedThreadRecord,
    setBundleCache,
    setFooterHostState,
    setSelectionForAgent: (agentId) => setSelection({
      threadId: null,
      agentId,
      targetId: agentId,
    }),
    setSubmittingThreadId,
    setThreadsCache,
    clearSelectedTarget: () => setSelectedTargetForSource('agent', null),
    submittingThreadId,
    syncSelectionToThread,
    t,
    targetByAgentId,
    targetsReady,
    threads,
    threadsReady,
    textModelContextTokens: textRouteModelProfile?.maxContextTokens ?? null,
    textMaxOutputTokensRequested: resolveAgentChatRequestedMaxOutputTokens(textRouteModelProfile),
  });
  const {
    auxiliaryOverlayContent,
    clearMessageContextMenu,
    onMessageContextMenu,
  } = useAgentConversationMessageMenu({
    onDeleteMessage: (messageId) => {
      void handleDeleteMessage(messageId).catch(reportHostError);
    },
    submittingThreadId,
    t,
  });
  const presentation = useAgentConversationPresentation({
    activeTarget,
    activeThreadId,
    bundle,
    bundleError,
    composerReady,
    currentDraftTextRef,
    currentFooterHostState,
    mutationPendingAction,
    onCancelPendingHook: handleCancelPendingHook,
    onClearDyadicContext: handleClearDyadicContext,
    onClearWorldContext: handleClearWorldContext,
    onDisableAutonomy: handleDisableAutonomy,
    onEnableAutonomy: handleEnableAutonomy,
    onRefreshInspect: handleRefreshRuntimeInspect,
    onUpdateRuntimeState: handleUpdateRuntimeState,
    onUpdateAutonomyConfig: handleUpdateAutonomyConfig,
    recentRuntimeEvents,
    handleSubmit,
    hostFeedback,
    initialModelSelection,
    inputSelectionAgentId: input.selection.agentId,
    isBundleLoading,
    messages,
    pendingAttachments: activePendingAttachments,
    onDismissHostFeedback: () => setHostFeedback(null),
    onAttachmentsChange: (nextAttachments) => setPendingAttachmentsForThread(activeThreadId, nextAttachments),
    onMessageContextMenu,
    onModelSelectionChange: handleModelSelectionChange,
    reasoningLabel,
    renderMessageAccessory,
    renderMessageContent,
    routeReady: !activeTarget || agentRouteReady,
    runtimeInspect,
    runtimeInspectLoading,
    schedulingJudgement,
    selectedTargetId: activeTarget?.agentId || null,
    behaviorSettings,
    setBehaviorSettings,
    onDiagnosticsVisibilityChange: input.onDiagnosticsVisibilityChange,
    voiceSessionState,
    onVoiceSessionToggle,
    onVoiceSessionCancel,
    onEnterHandsFreeVoiceSession: handsFreeState.onEnter,
    onExitHandsFreeVoiceSession: handsFreeState.onExit,
    setupState,
    streamState,
    submittingThreadId,
    t,
    targetSummariesInput: { targets, threads },
    targetsPending,
    thinkingPreference: behaviorSettings.thinkingPreference,
    thinkingSupported: thinkingSupport.supported,
    thinkingUnsupportedReason,
    agentRouteReady,
  });

  const handleDeleteCurrentThread = useCallback((threadId: string) => {
    clearMessageContextMenu();
    setPendingAttachmentsForThread(threadId, []);
    clearLatestVoiceCaptureForThread(threadId);
    void handleDeleteThread(threadId).catch(reportHostError);
  }, [clearLatestVoiceCaptureForThread, clearMessageContextMenu, handleDeleteThread, reportHostError, setPendingAttachmentsForThread]);

  const handleUpgradeStandardMemory = useCallback(() => {
    const agentId = normalizeText(activeTarget?.agentId);
    const targetName = normalizeText(activeTarget?.displayName) || agentId;
    if (!agentId) {
      return Promise.resolve();
    }
    setCanonicalMemoryLoading(true);
    return runtimeAgentMemory.bindCanonicalBankStandard(agentId)
      .then((status) => {
        setCanonicalMemoryStatus(status);
        setHostFeedback({
          kind: 'success',
          message: t('Chat.memoryModeUpgradeSuccess', {
            defaultValue: '{{name}} now uses Standard memory on this device.',
            name: targetName,
          }),
        });
      })
      .catch((error) => {
        reportHostError(error);
      })
      .finally(() => {
        setCanonicalMemoryLoading(false);
      });
  }, [activeTarget?.agentId, activeTarget?.displayName, reportHostError, runtimeAgentMemory, t]);

  const settingsContent = useMemo(() => (
    <div className="space-y-4">
      {presentation.settingsContent}
      {activeTarget ? (
        <ChatAgentHistoryPanel
          targetTitle={activeTarget.displayName}
          activeThreadId={activeThreadId}
          disabled={Boolean(submittingThreadId)}
          memoryStatus={canonicalMemoryStatus}
          memoryLoading={canonicalMemoryLoading}
          onUpgradeStandardMemory={handleUpgradeStandardMemory}
          onClearAgentHistory={handleDeleteCurrentThread}
        />
      ) : null}
    </div>
  ), [
    activeTarget,
    activeThreadId,
    canonicalMemoryLoading,
    canonicalMemoryStatus,
    handleDeleteCurrentThread,
    handleUpgradeStandardMemory,
    presentation.settingsContent,
    submittingThreadId,
  ]);

  return useMemo<DesktopConversationModeHost>(() => ({
    ...presentation,
    auxiliaryOverlayContent,
    handsFreeState,
    settingsContent,
    onSelectTarget: handleSelectAgent,
    onSelectThread: handleSelectThread,
  }), [auxiliaryOverlayContent, handleSelectAgent, handleSelectThread, handsFreeState, presentation, settingsContent]);
}
