import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { TFunction } from 'i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { logRendererEvent } from '@renderer/bridge/runtime-bridge/logging';
import { confirmDialog } from '@renderer/bridge/runtime-bridge/ui';
import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
import { type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import { ensureRuntimeAgentExists } from './chat-agent-shell-host-actions-helpers';
import {
  createRuntimeAgentMemoryAdapter,
  type CanonicalMemoryBankStatus,
} from '@renderer/infra/runtime-agent-memory';
import {
  createRuntimeAgentInspectAdapter,
  type RuntimeAgentInspectEventSummary,
  type RuntimeAgentInspectSnapshot,
} from '@renderer/infra/runtime-agent-inspect';
import type { AvatarPresentationProfile } from '@nimiplatform/nimi-kit/features/avatar/headless';

type AuthStatus = 'bootstrapping' | 'anonymous' | 'authenticated';

type RuntimeHostErrorDetailsBuilder = (
  error: unknown,
  action?: string,
  extra?: Record<string, unknown>,
) => Record<string, unknown>;

type RuntimeHostErrorReporter = (
  error: unknown,
  options?: { action?: string; extra?: Record<string, unknown> },
) => void;

type UseAgentConversationRuntimeControllerInput = {
  activeTarget: AgentLocalTargetSnapshot | null;
  authStatus: AuthStatus;
  buildHostErrorDetails: RuntimeHostErrorDetailsBuilder;
  diagnosticsVisible: boolean;
  reportHostError: RuntimeHostErrorReporter;
  setHostFeedback: Dispatch<SetStateAction<InlineFeedbackState | null>>;
  t: TFunction;
};

type RuntimeStateInput = {
  statusText: string;
  worldId: string;
  userId: string;
};

type AutonomyConfigInput = {
  mode: string;
  dailyTokenBudget: string;
  maxTokensPerHook: string;
};

type AgentConversationRuntimeController = {
  canonicalMemoryLoading: boolean;
  canonicalMemoryStatus: CanonicalMemoryBankStatus | null;
  mutationPendingAction: string | null;
  recentRuntimeEvents: readonly RuntimeAgentInspectEventSummary[];
  runtimeInspect: RuntimeAgentInspectSnapshot | null;
  runtimeInspectLoading: boolean;
  runtimePresentationProfile: AvatarPresentationProfile | null;
  handleCancelPendingHook: (hookId: string) => void;
  handleClearDyadicContext: () => void;
  handleClearWorldContext: () => void;
  handleDisableAutonomy: () => void;
  handleEnableAutonomy: () => void;
  handleRefreshRuntimeInspect: () => void;
  handleUpdateAutonomyConfig: (config: AutonomyConfigInput) => void;
  handleUpdateRuntimeState: (stateInput: RuntimeStateInput) => void;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireRuntimeSubjectUserId(): string {
  const subjectUserId = normalizeText((useAppStore.getState().auth.user as Record<string, unknown> | null)?.id);
  if (!subjectUserId) {
    throw new Error('desktop agent shell requires authenticated subject user id for runtime.agent');
  }
  return subjectUserId;
}

export function useAgentConversationRuntimeController(
  input: UseAgentConversationRuntimeControllerInput,
): AgentConversationRuntimeController {
  const {
    activeTarget,
    authStatus,
    buildHostErrorDetails,
    diagnosticsVisible,
    reportHostError,
    setHostFeedback,
    t,
  } = input;
  const [canonicalMemoryStatus, setCanonicalMemoryStatus] = useState<CanonicalMemoryBankStatus | null>(null);
  const [canonicalMemoryLoading, setCanonicalMemoryLoading] = useState(false);
  const [runtimeInspect, setRuntimeInspect] = useState<RuntimeAgentInspectSnapshot | null>(null);
  const [runtimeInspectLoading, setRuntimeInspectLoading] = useState(false);
  const [runtimePresentationProfile, setRuntimePresentationProfile] = useState<AvatarPresentationProfile | null>(null);
  const [recentRuntimeEvents, setRecentRuntimeEvents] = useState<readonly RuntimeAgentInspectEventSummary[]>([]);
  const [mutationPendingAction, setMutationPendingAction] = useState<string | null>(null);
  const lastInspectFetchedAgentIdRef = useRef<string | null>(null);
  const runtimeAgentMemory = useMemo(() => createRuntimeAgentMemoryAdapter({
    getSubjectUserId: requireRuntimeSubjectUserId,
  }), []);
  const runtimeAgentInspect = useMemo(() => createRuntimeAgentInspectAdapter({
    getSubjectUserId: requireRuntimeSubjectUserId,
  }), []);

  const reloadRuntimeInspect = useCallback(async (
    agentId: string,
    options?: { surfaceErrors?: boolean },
  ) => {
    const normalizedAgentId = normalizeText(agentId);
    if (!normalizedAgentId || authStatus !== 'authenticated') {
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
  }, [authStatus, buildHostErrorDetails, reportHostError, runtimeAgentInspect]);

  const refreshRuntimeInspect = useCallback(async (
    agentId: string,
    options?: { surfaceErrors?: boolean },
  ) => {
    await reloadRuntimeInspect(agentId, options);
  }, [reloadRuntimeInspect]);

  useEffect(() => {
    let cancelled = false;
    const target = activeTarget;
    const agentId = normalizeText(target?.localAgentRef);
    if (authStatus !== 'authenticated' || !target || !agentId) {
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
  }, [activeTarget, authStatus, buildHostErrorDetails, runtimeAgentInspect]);

  useEffect(() => {
    let cancelled = false;
    const agentId = normalizeText(activeTarget?.localAgentRef);
    if (authStatus !== 'authenticated' || !agentId) {
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
  }, [activeTarget?.localAgentRef, authStatus, buildHostErrorDetails, runtimeAgentMemory]);

  useEffect(() => {
    let cancelled = false;
    const target = activeTarget;
    const agentId = normalizeText(target?.localAgentRef);
    const cachedInspectAgentId = lastInspectFetchedAgentIdRef.current;
    if (cachedInspectAgentId && cachedInspectAgentId !== agentId) {
      setRuntimeInspect(null);
      setRecentRuntimeEvents([]);
      lastInspectFetchedAgentIdRef.current = null;
    }
    if (authStatus !== 'authenticated' || !target || !agentId) {
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
  }, [activeTarget, authStatus, buildHostErrorDetails, runtimeAgentInspect]);

  useEffect(() => {
    const agentId = normalizeText(activeTarget?.localAgentRef);
    if (authStatus !== 'authenticated' || !agentId || !diagnosticsVisible) {
      setRecentRuntimeEvents([]);
      return;
    }
    const eventsCoalesceMs = 2_000;
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
          flushTimer = setTimeout(flush, eventsCoalesceMs);
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
  }, [activeTarget?.localAgentRef, authStatus, buildHostErrorDetails, diagnosticsVisible, runtimeAgentInspect]);

  const handleEnableAutonomy = useCallback(() => {
    const agentId = normalizeText(activeTarget?.localAgentRef);
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
  }, [activeTarget?.localAgentRef, activeTarget?.displayName, refreshRuntimeInspect, reportHostError, runtimeAgentInspect, setHostFeedback, t]);

  const handleDisableAutonomy = useCallback(() => {
    const agentId = normalizeText(activeTarget?.localAgentRef);
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
  }, [activeTarget?.localAgentRef, activeTarget?.displayName, refreshRuntimeInspect, reportHostError, runtimeAgentInspect, setHostFeedback, t]);

  const handleCancelPendingHook = useCallback((hookId: string) => {
    const agentId = normalizeText(activeTarget?.localAgentRef);
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
  }, [activeTarget?.localAgentRef, refreshRuntimeInspect, reportHostError, runtimeAgentInspect, setHostFeedback, t]);

  const handleUpdateAutonomyConfig = useCallback((config: AutonomyConfigInput) => {
    const agentId = normalizeText(activeTarget?.localAgentRef);
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
  }, [activeTarget?.localAgentRef, activeTarget?.displayName, refreshRuntimeInspect, reportHostError, runtimeAgentInspect, setHostFeedback, t]);

  const handleUpdateRuntimeState = useCallback((stateInput: RuntimeStateInput) => {
    const agentId = normalizeText(activeTarget?.localAgentRef);
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
  }, [activeTarget?.localAgentRef, activeTarget?.displayName, refreshRuntimeInspect, reportHostError, runtimeAgentInspect, runtimeInspect, setHostFeedback, t]);

  const handleClearWorldContext = useCallback(() => {
    const agentId = normalizeText(activeTarget?.localAgentRef);
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
  }, [activeTarget?.localAgentRef, activeTarget?.displayName, refreshRuntimeInspect, reportHostError, runtimeAgentInspect, runtimeInspect?.activeWorldId, setHostFeedback, t]);

  const handleClearDyadicContext = useCallback(() => {
    const agentId = normalizeText(activeTarget?.localAgentRef);
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
  }, [activeTarget?.localAgentRef, activeTarget?.displayName, refreshRuntimeInspect, reportHostError, runtimeAgentInspect, runtimeInspect?.activeUserId, setHostFeedback, t]);

  const handleRefreshRuntimeInspect = useCallback(() => {
    const agentId = normalizeText(activeTarget?.localAgentRef);
    if (!agentId) {
      return;
    }
    void refreshRuntimeInspect(agentId, { surfaceErrors: true });
  }, [activeTarget?.localAgentRef, refreshRuntimeInspect]);

  return {
    canonicalMemoryLoading,
    canonicalMemoryStatus,
    mutationPendingAction,
    recentRuntimeEvents,
    runtimeInspect,
    runtimeInspectLoading,
    runtimePresentationProfile,
    handleCancelPendingHook,
    handleClearDyadicContext,
    handleClearWorldContext,
    handleDisableAutonomy,
    handleEnableAutonomy,
    handleRefreshRuntimeInspect,
    handleUpdateAutonomyConfig,
    handleUpdateRuntimeState,
  };
}
