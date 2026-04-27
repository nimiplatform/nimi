import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getPlatformClient } from '@nimiplatform/sdk';
import { asNimiError } from '@nimiplatform/sdk/runtime';
import {
  createReadyConversationSetupState,
} from '@nimiplatform/nimi-kit/features/chat';
import {
  type CanonicalMessageAccessorySlot,
  ConversationOrchestrationRegistry,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import type { AvatarPresentationProfile } from '@nimiplatform/nimi-kit/features/avatar/headless';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import type { AgentLocalThreadBundle } from '@renderer/bridge/runtime-bridge/types';
import { type RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { DesktopConversationModeHost } from './chat-shared-mode-host-types';
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
} from './chat-shared-runtime-stream-ui';
import {
  getChatThinkingUnsupportedCopy,
  resolveAgentThinkingSupportFromProjection,
} from './chat-shared-thinking';
import {
  createDefaultAgentChatExperienceSettings,
  normalizeAgentChatExperienceSettings,
  type AgentChatExperienceSettings,
} from './chat-settings-storage';
import {
  loadStoredPerformancePreferences,
  subscribeStoredPerformancePreferences,
} from '../settings/settings-storage';
import { resolveAgentChatBehavior } from './chat-agent-behavior-resolver';
import { type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import {
  bundleQueryKey,
  THREADS_QUERY_KEY,
  upsertBundleDraft,
  upsertThreadSummary,
  toErrorMessage,
} from './chat-agent-shell-core';
import { useAgentConversationPresentation } from './chat-agent-shell-presentation';
import { useAgentConversationEffects } from './chat-agent-shell-effects';
import { useAgentConversationCapabilityEffects } from './chat-agent-shell-capability-effects';
import { useSchedulingFeasibility } from './chat-shared-execution-scheduling-guard';
import { useAgentConversationHostActions } from './chat-agent-shell-host-actions';
import { ensureRuntimeAgentExists } from './chat-agent-shell-host-actions-helpers';
import { logRendererEvent } from '@renderer/bridge/runtime-bridge/logging';
import { confirmDialog } from '@renderer/bridge/runtime-bridge/ui';
import type { PendingAttachment } from '../turns/turn-input-attachments';
import { clearPendingAttachments } from '../turns/turn-input-attachments';
import { ChatAgentHistoryPanel } from './chat-agent-history-panel';
import { useAgentConversationVoiceSession } from './chat-agent-shell-adapter-voice';
import { useAgentConversationShellState } from './chat-agent-shell-adapter-state';
import { useAgentConversationMessageMenu } from './chat-agent-shell-adapter-menu';
import { resolveAgentChatRequestedMaxOutputTokens } from './chat-nimi-route-view';
import {
  buildAgentThreadMetadataUpdate,
  mergeAgentTargetWithPresentationProfile,
} from './chat-agent-thread-model';
import { hydrateAgentThreadBundleFromRuntimeSessionSnapshot } from './chat-agent-session-hydration';
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
  onOpenAgentCenter?: () => void;
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  selection: AgentConversationSelection;
  lastSelectedThreadId: string | null;
  setSelection: (selection: AgentConversationSelection) => void;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(nowMs() - startedAt));
}

function requireRuntimeSubjectUserId(): string {
  const subjectUserId = normalizeText((useAppStore.getState().auth.user as Record<string, unknown> | null)?.id);
  if (!subjectUserId) {
    throw new Error('desktop agent shell requires authenticated subject user id for runtime.agent');
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
    () => createDefaultAgentChatExperienceSettings(),
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
  const lastRuntimeSessionSnapshotRequestKeyRef = useRef<string | null>(null);
  const pendingRuntimeSessionSnapshotRequestKeyRef = useRef<string | null>(null);
  const [canonicalMemoryStatus, setCanonicalMemoryStatus] = useState<CanonicalMemoryBankStatus | null>(null);
  const [canonicalMemoryLoading, setCanonicalMemoryLoading] = useState(false);
  const [runtimeInspect, setRuntimeInspect] = useState<RuntimeAgentInspectSnapshot | null>(null);
  const [runtimeInspectLoading, setRuntimeInspectLoading] = useState(false);
  const [runtimePresentationProfile, setRuntimePresentationProfile] = useState<AvatarPresentationProfile | null>(null);
  const [recentRuntimeEvents, setRecentRuntimeEvents] = useState<readonly RuntimeAgentInspectEventSummary[]>([]);
  const [mutationPendingAction, setMutationPendingAction] = useState<string | null>(null);
  // Tracks the last agentId for which inspect was fetched — used only for
  // detecting agent changes so we can eagerly clear stale data, NOT for
  // skipping re-fetches on panel reopen.
  const lastInspectFetchedAgentIdRef = useRef<string | null>(null);
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
  const buildHostErrorDetails = useCallback((error: unknown, action?: string, extra?: Record<string, unknown>) => {
    const normalized = asNimiError(error, { source: 'runtime' });
    const causeMessage = error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : undefined;
    return {
      error: toErrorMessage(error),
      ...(action ? { action } : {}),
      ...(typeof normalized.reasonCode === 'string' && normalized.reasonCode.trim()
        ? { reasonCode: normalized.reasonCode.trim() }
        : {}),
      ...(typeof normalized.actionHint === 'string' && normalized.actionHint.trim()
        ? { actionHint: normalized.actionHint.trim() }
        : {}),
      ...(causeMessage ? { causeMessage } : {}),
      ...(extra || {}),
    };
  }, []);
  const reportHostError = useCallback((error: unknown, options?: { action?: string; extra?: Record<string, unknown> }) => {
    const details = buildHostErrorDetails(error, options?.action, options?.extra);
    const message = [
      String(details.error || '').trim(),
      typeof details.reasonCode === 'string' && details.reasonCode.trim()
        ? `[${details.reasonCode.trim()}]`
        : '',
    ].filter(Boolean).join(' ');
    logRendererEvent({
      level: 'error',
      area: 'agent-chat-shell',
      message: 'action:host-error',
      details,
    });
    setHostFeedback({
      kind: 'error',
      message,
    });
  }, [buildHostErrorDetails]);
  const thinkingSupport = useMemo(
    () => resolveAgentThinkingSupportFromProjection(textCapabilityProjection),
    [textCapabilityProjection],
  );
  const setBehaviorSettings = useCallback((nextSettings: AgentChatExperienceSettings) => {
    setBehaviorSettingsState(normalizeAgentChatExperienceSettings(nextSettings));
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
      lastInspectFetchedAgentIdRef.current = null;
      return;
    }
    setRuntimeInspectLoading(true);
    try {
      const snapshot = await runtimeAgentInspect.getPublicInspect(normalizedAgentId);
      setRuntimeInspect(snapshot);
      lastInspectFetchedAgentIdRef.current = normalizedAgentId;
      } catch (error) {
        setRuntimeInspect(null);
        lastInspectFetchedAgentIdRef.current = null;
        if (options?.surfaceErrors) {
          reportHostError(error, {
            action: 'load-runtime-agent-inspect',
            extra: {
              agentId: normalizedAgentId,
            },
          });
        } else {
          logRendererEvent({
            level: 'warn',
            area: 'agent-chat-shell',
            message: 'action:host-error',
            details: buildHostErrorDetails(error, 'load-runtime-agent-inspect', {
              agentId: normalizedAgentId,
            }),
          });
        }
      } finally {
      setRuntimeInspectLoading(false);
    }
  }, [buildHostErrorDetails, input.authStatus, reportHostError, runtimeAgentInspect]);
  const refreshRuntimeInspect = useCallback(async (
    agentId: string,
    options?: { surfaceErrors?: boolean },
  ) => {
    await reloadRuntimeInspect(agentId, options);
  }, [reloadRuntimeInspect]);

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
    activeTarget: shellActiveTarget,
    activeThreadId,
    activeConversationAnchorId,
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
  const activeTarget = useMemo(
    () => mergeAgentTargetWithPresentationProfile(shellActiveTarget, runtimePresentationProfile),
    [runtimePresentationProfile, shellActiveTarget],
  );

  useEffect(() => {
    let cancelled = false;
    const target = activeTarget;
    const agentId = normalizeText(target?.agentId);
    if (input.authStatus !== 'authenticated' || !target || !agentId) {
      setRuntimePresentationProfile(null);
      return () => {
        cancelled = true;
      };
    }
    void ensureRuntimeAgentExists(target)
      .then(() => runtimeAgentInspect.getPresentationProfile(agentId))
      .then((profile) => {
        if (!cancelled) {
          setRuntimePresentationProfile(profile);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setRuntimePresentationProfile(null);
        logRendererEvent({
          level: 'warn',
          area: 'agent-chat-shell',
          message: 'action:host-error',
          details: buildHostErrorDetails(error, 'load-runtime-agent-presentation', {
            agentId,
          }),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [activeTarget, buildHostErrorDetails, input.authStatus, runtimeAgentInspect]);

  useEffect(() => {
    const metadataUpdate = buildAgentThreadMetadataUpdate({
      thread: selectedThreadRecord,
      target: activeTarget,
    });
    if (!metadataUpdate) {
      return;
    }
    let cancelled = false;
    void chatAgentStoreClient.updateThreadMetadata(metadataUpdate)
      .then((updatedThread) => {
        if (cancelled) {
          return;
        }
        queryClient.setQueryData(['chat-agent-threads'], (current: typeof threads | undefined) => (
          upsertThreadSummary(current || [], updatedThread)
        ));
        queryClient.setQueryData(bundleQueryKey(updatedThread.id), (current: AgentLocalThreadBundle | undefined) => {
          if (!current || current.thread.id !== updatedThread.id) {
            return current;
          }
          return {
            ...current,
            thread: updatedThread,
          };
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        logRendererEvent({
          level: 'warn',
          area: 'agent-chat-shell',
          message: 'action:host-error',
          details: buildHostErrorDetails(error, 'sync-agent-thread-target-snapshot', {
            threadId: metadataUpdate.id,
            agentId: metadataUpdate.targetSnapshot.agentId,
          }),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [activeTarget, buildHostErrorDetails, queryClient, selectedThreadRecord, threads]);

  useEffect(() => {
    let cancelled = false;
    const thread = selectedThreadRecord;
    const agentId = normalizeText(activeTarget?.agentId || thread?.agentId);
    const conversationAnchorId = normalizeText(activeConversationAnchorId);
    if (
      input.authStatus !== 'authenticated'
      || !thread
      || !agentId
      || !conversationAnchorId
      || isBundleLoading
      || Boolean(bundleError)
      || submittingThreadId === thread.id
    ) {
      return () => {
        cancelled = true;
      };
    }
    const currentBundleAtRequest = queryClient.getQueryData<AgentLocalThreadBundle | null>(
      bundleQueryKey(thread.id),
    );
    const knownMessages = currentBundleAtRequest?.messages || [];
    const lastKnownMessage = knownMessages[knownMessages.length - 1] || null;
    const snapshotRequestKey = [
      agentId,
      conversationAnchorId,
      thread.id,
      thread.updatedAtMs,
      thread.lastMessageAtMs || '',
      knownMessages.length,
      normalizeText(lastKnownMessage?.id),
      normalizeText(lastKnownMessage?.status),
    ].join('|');
    if (
      pendingRuntimeSessionSnapshotRequestKeyRef.current === snapshotRequestKey
      || lastRuntimeSessionSnapshotRequestKeyRef.current === snapshotRequestKey
    ) {
      logRendererEvent({
        level: 'info',
        area: 'agent-chat-shell-latency',
        message: 'action:desktop_runtime_agent_session_snapshot_request_deduped',
        details: {
          counter: 'desktop_runtime_agent_session_snapshot_request_deduped_total',
          value: 1,
          threadId: thread.id,
          conversationAnchorId,
          agentId,
        },
      });
      return () => {
        cancelled = true;
      };
    }
    pendingRuntimeSessionSnapshotRequestKeyRef.current = snapshotRequestKey;
    const snapshotStartedAt = nowMs();
    logRendererEvent({
      level: 'info',
      area: 'agent-chat-shell-latency',
      message: 'action:desktop_runtime_agent_session_snapshot_request_total',
      details: {
        counter: 'desktop_runtime_agent_session_snapshot_request_total',
        value: 1,
        threadId: thread.id,
        conversationAnchorId,
        agentId,
        submittingThreadId: submittingThreadId || null,
      },
    });
    void getPlatformClient().runtime.agent.turns.getSessionSnapshot({
      agentId,
      conversationAnchorId,
    })
      .then((snapshot) => {
        if (cancelled) {
          return;
        }
        logRendererEvent({
          level: 'info',
          area: 'agent-chat-shell-latency',
          message: 'phase:desktop.runtime_agent.session_snapshot_request_ms',
          costMs: elapsedMs(snapshotStartedAt),
          details: {
            stage: 'desktop.runtime_agent.session_snapshot_request_ms',
            threadId: thread.id,
            conversationAnchorId,
            agentId,
            transcriptMessageCount: Array.isArray(snapshot?.transcript) ? snapshot.transcript.length : null,
            hasActiveTurn: Boolean(snapshot?.activeTurn),
            hasLastTurn: Boolean(snapshot?.lastTurn),
            hasPendingFollowUp: Boolean(snapshot?.pendingFollowUp),
          },
        });
        const currentBundle = queryClient.getQueryData<AgentLocalThreadBundle | null>(
          bundleQueryKey(thread.id),
        );
        const hydratedBundle = hydrateAgentThreadBundleFromRuntimeSessionSnapshot({
          thread,
          bundle: currentBundle,
          conversationAnchorId,
          snapshot,
          nowMs: Date.now(),
        });
        if (!hydratedBundle) {
          return;
        }
        queryClient.setQueryData(bundleQueryKey(thread.id), hydratedBundle);
        queryClient.setQueryData(THREADS_QUERY_KEY, (current: typeof threads | undefined) => (
          upsertThreadSummary(current || [], hydratedBundle.thread)
        ));
        lastRuntimeSessionSnapshotRequestKeyRef.current = snapshotRequestKey;
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        logRendererEvent({
          level: 'warn',
          area: 'agent-chat-shell',
          message: 'action:host-error',
          details: buildHostErrorDetails(error, 'hydrate-runtime-agent-session', {
            threadId: thread.id,
            conversationAnchorId,
            agentId,
          }),
        });
      })
      .finally(() => {
        if (pendingRuntimeSessionSnapshotRequestKeyRef.current === snapshotRequestKey) {
          pendingRuntimeSessionSnapshotRequestKeyRef.current = null;
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeConversationAnchorId,
    activeTarget?.agentId,
    buildHostErrorDetails,
    bundleError,
    input.authStatus,
    isBundleLoading,
    queryClient,
    selectedThreadRecord,
    submittingThreadId,
    threads,
  ]);

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
          details: buildHostErrorDetails(error, 'load-runtime-canonical-memory-status', {
            agentId,
          }),
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
  }, [activeTarget?.agentId, buildHostErrorDetails, input.authStatus, reportHostError, runtimeAgentMemory]);
  useEffect(() => {
    let cancelled = false;
    const target = activeTarget;
    const agentId = normalizeText(target?.agentId);
    const cachedInspectAgentId = lastInspectFetchedAgentIdRef.current;
    if (cachedInspectAgentId && cachedInspectAgentId !== agentId) {
      setRuntimeInspect(null);
      setRecentRuntimeEvents([]);
      lastInspectFetchedAgentIdRef.current = null;
    }
    if (input.authStatus !== 'authenticated' || !target || !agentId) {
      setRuntimeInspect(null);
      lastInspectFetchedAgentIdRef.current = null;
      setRuntimeInspectLoading(false);
      setRecentRuntimeEvents([]);
      return () => {
        cancelled = true;
      };
    }
    setRuntimeInspectLoading(true);
    void ensureRuntimeAgentExists(target)
      .then(() => runtimeAgentInspect.getPublicInspect(agentId))
      .then((snapshot) => {
        if (cancelled) {
          return;
        }
        setRuntimeInspect(snapshot);
        lastInspectFetchedAgentIdRef.current = agentId;
        setRecentRuntimeEvents([]);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setRuntimeInspect(null);
        lastInspectFetchedAgentIdRef.current = null;
        logRendererEvent({
          level: 'warn',
          area: 'agent-chat-shell',
          message: 'action:host-error',
          details: buildHostErrorDetails(error, 'load-runtime-agent-inspect-passive', {
            agentId,
          }),
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
  }, [activeTarget, buildHostErrorDetails, input.authStatus, runtimeAgentInspect]);
  // Coalesce event-driven state updates: buffer incoming events and flush at
  // most once per EVENTS_COALESCE_MS to reduce re-render frequency while the
  // diagnostics panel is open.  The subscription itself stays active whenever
  // diagnosticsVisible is true so all users see the same data — only the
  // render cadence is throttled.
  useEffect(() => {
    const agentId = normalizeText(activeTarget?.agentId);
    if (input.authStatus !== 'authenticated' || !agentId || !input.diagnosticsVisible) {
      setRecentRuntimeEvents([]);
      return;
    }
    const EVENTS_COALESCE_MS = 2_000;
    const controller = new AbortController();
    let pendingEvents: RuntimeAgentInspectEventSummary[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      const batch = pendingEvents;
      pendingEvents = [];
      if (batch.length === 0) {
        return;
      }
      setRecentRuntimeEvents((current) => {
        let next = [...current];
        for (const event of batch) {
          if (next.length > 0 && next[0]?.sequence === event.sequence) {
            continue;
          }
          next = [event, ...next.filter((item) => item.sequence !== event.sequence)];
        }
        const sliced = next.slice(0, 8);
        // Referential-equality bailout: if nothing changed, return the
        // existing array so React skips the re-render.
        if (
          sliced.length === current.length
          && sliced.every((item, i) => item === current[i])
        ) {
          return current;
        }
        return sliced;
      });
    };
    void runtimeAgentInspect.subscribePublicEvents({
      agentId,
      signal: controller.signal,
      onEvent: (event) => {
        pendingEvents.push(event);
        if (flushTimer === null) {
          flushTimer = setTimeout(flush, EVENTS_COALESCE_MS);
        }
      },
    }).catch((error) => {
      if (controller.signal.aborted) {
        return;
      }
      logRendererEvent({
        level: 'warn',
        area: 'agent-chat-shell',
        message: 'action:host-error',
        details: buildHostErrorDetails(error, 'subscribe-runtime-agent-events', {
          agentId,
        }),
      });
    });
    return () => {
      controller.abort();
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
      }
    };
  }, [activeTarget?.agentId, buildHostErrorDetails, input.authStatus, input.diagnosticsVisible, runtimeAgentInspect]);
  const handleEnableAutonomy = useCallback(() => {
    const agentId = normalizeText(activeTarget?.agentId);
    const targetName = normalizeText(activeTarget?.displayName) || agentId;
    if (!agentId) {
      return;
    }
    setMutationPendingAction('Enabling autonomy…');
    void runtimeAgentInspect.enableAutonomy(agentId)
      .then(async () => {
        await refreshRuntimeInspect(agentId);
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
  }, [activeTarget?.agentId, activeTarget?.displayName, refreshRuntimeInspect, reportHostError, runtimeAgentInspect, t]);
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
      await refreshRuntimeInspect(agentId);
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
  }, [activeTarget?.agentId, activeTarget?.displayName, refreshRuntimeInspect, reportHostError, runtimeAgentInspect, t]);
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
      await refreshRuntimeInspect(agentId);
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
  }, [activeTarget?.agentId, refreshRuntimeInspect, reportHostError, runtimeAgentInspect, t]);
  const handleUpdateAutonomyConfig = useCallback((config: {
    mode: string;
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
      mode: config.mode,
      dailyTokenBudget: config.dailyTokenBudget,
      maxTokensPerHook: config.maxTokensPerHook,
    })
      .then(async () => {
        await refreshRuntimeInspect(agentId);
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
  }, [activeTarget?.agentId, activeTarget?.displayName, refreshRuntimeInspect, reportHostError, runtimeAgentInspect, t]);
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
        await refreshRuntimeInspect(agentId);
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
  }, [activeTarget?.agentId, activeTarget?.displayName, refreshRuntimeInspect, reportHostError, runtimeAgentInspect, t]);
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
        await refreshRuntimeInspect(agentId);
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
  }, [activeTarget?.agentId, activeTarget?.displayName, refreshRuntimeInspect, reportHostError, runtimeAgentInspect, t]);
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
        await refreshRuntimeInspect(agentId);
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
  }, [activeTarget?.agentId, activeTarget?.displayName, refreshRuntimeInspect, reportHostError, runtimeInspect, t]);
  const handleRefreshRuntimeInspect = useCallback(() => {
    const agentId = normalizeText(activeTarget?.agentId);
    if (!agentId) {
      return;
    }
    void refreshRuntimeInspect(agentId, { surfaceErrors: true });
  }, [activeTarget?.agentId, refreshRuntimeInspect]);
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
  const [voicePlaybackState, setVoicePlaybackState] = useState<{
    conversationAnchorId: string;
    messageId: string;
    active: boolean;
    amplitude: number;
    visemeId: 'aa' | 'ee' | 'ih' | 'oh' | 'ou' | null;
  } | null>(null);
  const handleVoicePlaybackStateChange = useCallback((nextState: {
    conversationAnchorId: string;
    messageId: string;
    active: boolean;
    amplitude: number;
    visemeId: 'aa' | 'ee' | 'ih' | 'oh' | 'ou' | null;
  }) => {
    setVoicePlaybackState((current) => {
      if (nextState.active) {
        return nextState;
      }
      if (current?.messageId === nextState.messageId) {
        return null;
      }
      return current;
    });
  }, []);
  useEffect(() => {
    setVoicePlaybackState((current) => (
      current && activeConversationAnchorId && current.conversationAnchorId !== activeConversationAnchorId
        ? null
        : current
    ));
  }, [activeConversationAnchorId]);
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
            onPlaybackStateChange={handleVoicePlaybackStateChange}
          />
        );
      }
      return renderReasoningMessageContent(message, context);
    }
  ), [handleVoicePlaybackStateChange, renderReasoningMessageContent, t]);
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
  const persistVoiceTranscriptDraft = useCallback(async (input: { text: string; conversationAnchorId: string }) => {
    if (!activeThreadId || !activeConversationAnchorId || input.conversationAnchorId !== activeConversationAnchorId) {
      throw new Error('Voice input is unavailable because no active thread is selected.');
    }
    const draft = await chatAgentStoreClient.putDraft({
      threadId: activeThreadId,
      text: input.text,
      updatedAtMs: Date.now(),
    });
    currentDraftTextRef.current = input.text;
    setBundleCache(
      activeThreadId,
      (current) => upsertBundleDraft(current, draft) || current,
    );
  }, [activeConversationAnchorId, activeThreadId, currentDraftTextRef, setBundleCache]);
  const {
    clearLatestVoiceCaptureForThread,
    handsFreeState,
    latestVoiceCaptureByThreadRef,
    onVoiceSessionCancel,
    onVoiceSessionToggle,
    voiceCaptureState,
    voiceSessionState,
  } = useAgentConversationVoiceSession({
    activeTarget,
    activeConversationAnchorId,
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
          conversationAnchorId: turnInput.conversationAnchorId,
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
          textMaxOutputTokensRequested: resolveAgentChatRequestedMaxOutputTokens(textRouteModelProfile, behaviorSettings.maxOutputTokensOverride),
          resolvedBehavior: resolveAgentChatBehavior({
            userText: turnInput.userMessage.text,
            hasUserAttachments: turnInput.userMessage.attachments.length > 0,
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
    textMaxOutputTokensRequested: resolveAgentChatRequestedMaxOutputTokens(textRouteModelProfile, behaviorSettings.maxOutputTokensOverride),
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
  const handleDeleteCurrentThread = useCallback((threadId: string) => {
    clearMessageContextMenu();
    setPendingAttachmentsForThread(threadId, []);
    clearLatestVoiceCaptureForThread(threadId);
    void handleDeleteThread(threadId).catch(reportHostError);
  }, [clearLatestVoiceCaptureForThread, clearMessageContextMenu, handleDeleteThread, reportHostError, setPendingAttachmentsForThread]);

  const cognitionContent = useMemo(() => (
    activeTarget ? (
      <ChatAgentHistoryPanel
        targetTitle={activeTarget.displayName}
        disabled={Boolean(submittingThreadId)}
        memoryStatus={canonicalMemoryStatus}
        memoryLoading={canonicalMemoryLoading}
        allowMemoryUpgrade={false}
      />
    ) : null
  ), [
    activeTarget,
    canonicalMemoryLoading,
    canonicalMemoryStatus,
    submittingThreadId,
  ]);

  const presentation = useAgentConversationPresentation({
    activeTarget,
    accountId: input.runtimeFields.targetAccountId
      || normalizeText((useAppStore.getState().auth.user as Record<string, unknown> | null)?.id)
      || 'local_account',
    activeThreadId,
    activeConversationAnchorId,
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
    cognitionContent,
    onDiagnosticsVisibilityChange: input.onDiagnosticsVisibilityChange,
    onOpenAgentCenter: input.onOpenAgentCenter,
    voiceSessionState,
    voiceCaptureState,
    voicePlaybackState,
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
    clearChatsTargetName: activeTarget?.displayName ?? null,
    clearChatsDisabled: Boolean(submittingThreadId) || !activeThreadId,
    onClearAgentHistory: activeThreadId ? () => handleDeleteCurrentThread(activeThreadId) : undefined,
  });

  return useMemo<DesktopConversationModeHost>(() => ({
    ...presentation,
    auxiliaryOverlayContent,
    handsFreeState,
    onSelectTarget: handleSelectAgent,
    onSelectThread: handleSelectThread,
  }), [auxiliaryOverlayContent, handleSelectAgent, handleSelectThread, handsFreeState, presentation]);
}
