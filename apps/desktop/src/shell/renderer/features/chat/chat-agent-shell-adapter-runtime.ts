import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  createNimiHostRuntimeAgentLifecycleSurface,
  createNimiRuntimeAgentConsumeClient,
} from '@nimiplatform/sdk/runtime';
import type { TFunction } from 'i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import {
  createRuntimeAgentCenterAdapter,
  type AgentCenterRuntimeAdapter,
} from '@nimiplatform/kit/features/agent-center';
import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
import { type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import { ensureRuntimeAgentExists } from './chat-agent-shell-host-actions-helpers';
import {
  getDesktopAppId,
  getDesktopHostRuntimeAgentClient,
  getDesktopRuntime,
  withDesktopRuntimeProtectedScopes,
} from '@renderer/infra/sdk/desktop-nimi-client-session';
import { getAgentConversationAnchorBinding } from '@renderer/app-shell/providers/agent-conversation-anchor-binding-storage';
import {
  createRuntimeAgentMemoryAdapter,
  type CanonicalMemoryBankStatus,
} from '@renderer/infra/runtime-agent-memory';
import {
  createRuntimeAgentInspectAdapter,
  type NimiRuntimeAgentInspectEventSummary,
  type NimiRuntimeAgentInspectSnapshot,
} from '@renderer/infra/runtime-agent-inspect';
import {
  createRuntimeAgentAIConfigAdapter,
  describeRuntimeAgentTextReadiness,
  isRuntimeAgentTextReadinessReady,
  type NimiRuntimeAgentAIConfigSnapshot,
  type NimiRuntimeAgentAIConfigReadinessSnapshotProjection,
} from '@renderer/infra/runtime-agent-ai-config';
import type { NimiRuntimeAgentPresentationProfileProjection } from '@nimiplatform/sdk/runtime';
import {
  useAgentConversationRuntimeMutations,
  type AutonomyConfigInput,
  type RuntimeStateInput,
} from './chat-agent-shell-adapter-runtime-mutations';

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

type AgentConversationRuntimeController = {
  canonicalMemoryLoading: boolean;
  canonicalMemoryStatus: CanonicalMemoryBankStatus | null;
  mutationPendingAction: string | null;
  recentRuntimeEvents: readonly NimiRuntimeAgentInspectEventSummary[];
  runtimeAgentAIConfig: NimiRuntimeAgentAIConfigSnapshot | null;
  runtimeAgentAIConfigReadiness: NimiRuntimeAgentAIConfigReadinessSnapshotProjection | null;
  runtimeAgentAIConfigLoading: boolean;
  runtimeAgentAIConfigError: string | null;
  runtimeAgentCenterAdapter: AgentCenterRuntimeAdapter | null;
  runtimeAgentTextReady: boolean;
  runtimeAgentTextDisabledReason: string | null;
  runtimeInspect: NimiRuntimeAgentInspectSnapshot | null;
  runtimeInspectLoading: boolean;
  runtimePresentationProfile: NimiRuntimeAgentPresentationProfileProjection | null;
  refreshRuntimeAgentAIConfigReadiness: () => Promise<NimiRuntimeAgentAIConfigReadinessSnapshotProjection>;
  handleCancelPendingHook: (hookId: string) => void;
  handleUpgradeStandardMemory: () => void;
  handleClearDyadicContext: () => void;
  handleClearWorldContext: () => void;
  handleDisableAutonomy: () => void;
  handleEnableAutonomy: () => void;
  handleRefreshRuntimeInspect: () => void;
  handleUpdateAutonomyConfig: (config: AutonomyConfigInput) => void;
  handleUpdateRuntimeState: (stateInput: RuntimeStateInput) => void;
};

type RuntimeIdentityInput = {
  readonly localAgentRef: string;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toRuntimeIdentityInput(target: AgentLocalTargetSnapshot): RuntimeIdentityInput {
  return {
    localAgentRef: target.localAgentRef,
    ownerUserId: target.ownerUserId,
    runtimeSourceRef: target.runtimeSourceRef,
  };
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
  const [runtimeAgentAIConfig, setRuntimeAgentAIConfig] = useState<NimiRuntimeAgentAIConfigSnapshot | null>(null);
  const [runtimeAgentAIConfigReadiness, setRuntimeAgentAIConfigReadiness] = useState<NimiRuntimeAgentAIConfigReadinessSnapshotProjection | null>(null);
  const [runtimeAgentAIConfigLoading, setRuntimeAgentAIConfigLoading] = useState(false);
  const [runtimeAgentAIConfigError, setRuntimeAgentAIConfigError] = useState<string | null>(null);
  const [runtimeInspect, setRuntimeInspect] = useState<NimiRuntimeAgentInspectSnapshot | null>(null);
  const [runtimeInspectLoading, setRuntimeInspectLoading] = useState(false);
  const [runtimePresentationProfile, setRuntimePresentationProfile] =
    useState<NimiRuntimeAgentPresentationProfileProjection | null>(null);
  const [recentRuntimeEvents, setRecentRuntimeEvents] = useState<readonly NimiRuntimeAgentInspectEventSummary[]>([]);
  const lastInspectFetchedAgentIdRef = useRef<string | null>(null);
  const runtimeAgentMemory = useMemo(() => createRuntimeAgentMemoryAdapter({
    getSubjectUserId: requireRuntimeSubjectUserId,
  }), []);
  const runtimeAgentInspect = useMemo(() => createRuntimeAgentInspectAdapter({
    getSubjectUserId: requireRuntimeSubjectUserId,
  }), []);
  const runtimeAgentAIConfigAdapter = useMemo(() => createRuntimeAgentAIConfigAdapter({
    getSubjectUserId: requireRuntimeSubjectUserId,
  }), []);
  const runtimeAgentCenterAdapter = useMemo(() => {
    if (authStatus !== 'authenticated' || !activeTarget) {
      return null;
    }
    const lifecycle = createNimiHostRuntimeAgentLifecycleSurface({
      getRuntime: getDesktopHostRuntimeAgentClient,
      getSubjectUserId: requireRuntimeSubjectUserId,
      withScopes: withDesktopRuntimeProtectedScopes,
    });
    const consume = createNimiRuntimeAgentConsumeClient({
      runtime: { agents: getDesktopRuntime().agents },
      runtimeAppId: getDesktopAppId(),
    });
    return createRuntimeAgentCenterAdapter({
      identity: toRuntimeIdentityInput(activeTarget),
      agentAIConfig: runtimeAgentAIConfigAdapter,
      inspect: runtimeAgentInspect,
      async loadSourceContextStatus(identity) {
        const discovered = await lifecycle.discoverLocalAgentsBySource({
          ownerUserId: identity.ownerUserId,
          runtimeSourceRef: identity.runtimeSourceRef,
        });
        const selected = discovered.find((agent) => agent.localAgentRef === identity.localAgentRef);
        return selected?.sourceContextStatus ?? null;
      },
      async loadTurnContextSummary(identity) {
        const localAgentRef = normalizeText(identity.localAgentRef);
        if (!localAgentRef) return null;
        const binding = getAgentConversationAnchorBinding(localAgentRef);
        const conversationAnchorId = normalizeText(identity.conversationAnchorId) || binding?.conversationAnchorId;
        if (!conversationAnchorId) return null;
        const snapshot = await consume.anchors.getSnapshot({
          ownerUserId: identity.ownerUserId,
          runtimeSourceRef: identity.runtimeSourceRef,
          localAgentRef,
          conversationAnchorId,
        });
        return snapshot.turnContextSummary ?? null;
      },
    });
  }, [activeTarget, authStatus, runtimeAgentAIConfigAdapter, runtimeAgentInspect]);

  const requireActiveRuntimeIdentity = useCallback(() => {
    if (!activeTarget) {
      throw new Error('desktop agent shell requires an active Runtime Local Agent before reading Runtime Agent AI Config');
    }
    return toRuntimeIdentityInput(activeTarget);
  }, [activeTarget]);

  const refreshRuntimeAgentAIConfigReadiness = useCallback(async () => {
    const readiness = await runtimeAgentAIConfigAdapter.readiness(requireActiveRuntimeIdentity());
    setRuntimeAgentAIConfigReadiness(readiness);
    setRuntimeAgentAIConfigError(null);
    return readiness;
  }, [requireActiveRuntimeIdentity, runtimeAgentAIConfigAdapter]);

  useEffect(() => {
    let cancelled = false;
    if (authStatus !== 'authenticated' || !activeTarget) {
      setRuntimeAgentAIConfig(null);
      setRuntimeAgentAIConfigReadiness(null);
      setRuntimeAgentAIConfigLoading(false);
      setRuntimeAgentAIConfigError(null);
      return () => {
        cancelled = true;
      };
    }
    const identity = toRuntimeIdentityInput(activeTarget);
    setRuntimeAgentAIConfigLoading(true);
    void Promise.all([
      runtimeAgentAIConfigAdapter.get(identity),
      runtimeAgentAIConfigAdapter.readiness(identity),
    ])
      .then(([agentAIConfig, readiness]) => {
        if (cancelled) {
          return;
        }
        setRuntimeAgentAIConfig(agentAIConfig);
        setRuntimeAgentAIConfigReadiness(readiness);
        setRuntimeAgentAIConfigError(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setRuntimeAgentAIConfig(null);
        setRuntimeAgentAIConfigReadiness(null);
        setRuntimeAgentAIConfigError(error instanceof Error ? error.message : String(error || ''));
        logRendererEvent({
          level: 'warn',
          area: 'agent-chat-shell',
          message: 'action:host-error',
          details: buildHostErrorDetails(error, 'load-runtime-agent-ai-config'),
        });
      })
      .finally(() => {
        if (!cancelled) {
          setRuntimeAgentAIConfigLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeTarget, authStatus, buildHostErrorDetails, runtimeAgentAIConfigAdapter]);

  const reloadRuntimeInspect = useCallback(async (
    target: AgentLocalTargetSnapshot,
    options?: { surfaceErrors?: boolean },
  ) => {
    const identity = toRuntimeIdentityInput(target);
    const normalizedAgentId = normalizeText(identity.localAgentRef);
    if (!normalizedAgentId || authStatus !== 'authenticated') {
      setRuntimeInspect(null);
      setRuntimeInspectLoading(false);
      lastInspectFetchedAgentIdRef.current = null;
      return;
    }
    setRuntimeInspectLoading(true);
    try {
      const snapshot = await runtimeAgentInspect.getPublicInspect(identity);
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
    target: AgentLocalTargetSnapshot,
    options?: { surfaceErrors?: boolean },
  ) => {
    await reloadRuntimeInspect(target, options);
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
      .then(() => runtimeAgentInspect.getPresentationProfile(toRuntimeIdentityInput(target)))
      .then((presentationProfileRead) => {
        if (!cancelled) {
          setRuntimePresentationProfile(presentationProfileRead.profile);
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
    const target = activeTarget;
    const agentId = normalizeText(target?.localAgentRef);
    if (authStatus !== 'authenticated' || !target || !agentId) {
      setCanonicalMemoryStatus(null);
      setCanonicalMemoryLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setCanonicalMemoryLoading(true);
    void runtimeAgentMemory.getCanonicalBankStatus({
      localAgentRef: target.localAgentRef,
      ownerUserId: target.ownerUserId,
      runtimeSourceRef: target.runtimeSourceRef,
    })
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
  }, [activeTarget, authStatus, buildHostErrorDetails, runtimeAgentMemory]);

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
      .then(() => runtimeAgentInspect.getPublicInspect(toRuntimeIdentityInput(target)))
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
    const target = activeTarget;
    const agentId = normalizeText(target?.localAgentRef);
    if (authStatus !== 'authenticated' || !target || !agentId || !diagnosticsVisible) {
      setRecentRuntimeEvents([]);
      return;
    }
    const eventsCoalesceMs = 2_000;
    const controller = new AbortController();
    let pendingEvents: NimiRuntimeAgentInspectEventSummary[] = [];
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
      ...toRuntimeIdentityInput(target),
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

  const runtimeMutations = useAgentConversationRuntimeMutations({
    activeTarget,
    refreshRuntimeInspect,
    reportHostError,
    runtimeAgentInspect,
    runtimeAgentMemory,
    runtimeInspect,
    setCanonicalMemoryStatus,
    setHostFeedback,
    t,
  });

  return {
    canonicalMemoryLoading,
    canonicalMemoryStatus,
    mutationPendingAction: runtimeMutations.mutationPendingAction,
    recentRuntimeEvents,
    runtimeAgentAIConfig,
    runtimeAgentAIConfigReadiness,
    runtimeAgentAIConfigLoading,
    runtimeAgentAIConfigError,
    runtimeAgentCenterAdapter,
    runtimeAgentTextReady: isRuntimeAgentTextReadinessReady(runtimeAgentAIConfigReadiness),
    runtimeAgentTextDisabledReason: runtimeAgentAIConfigError
      || (isRuntimeAgentTextReadinessReady(runtimeAgentAIConfigReadiness)
        ? null
        : describeRuntimeAgentTextReadiness(runtimeAgentAIConfigReadiness)),
    runtimeInspect,
    runtimeInspectLoading,
    runtimePresentationProfile,
    refreshRuntimeAgentAIConfigReadiness,
    handleCancelPendingHook: runtimeMutations.handleCancelPendingHook,
    handleUpgradeStandardMemory: runtimeMutations.handleUpgradeStandardMemory,
    handleClearDyadicContext: runtimeMutations.handleClearDyadicContext,
    handleClearWorldContext: runtimeMutations.handleClearWorldContext,
    handleDisableAutonomy: runtimeMutations.handleDisableAutonomy,
    handleEnableAutonomy: runtimeMutations.handleEnableAutonomy,
    handleRefreshRuntimeInspect: runtimeMutations.handleRefreshRuntimeInspect,
    handleUpdateAutonomyConfig: runtimeMutations.handleUpdateAutonomyConfig,
    handleUpdateRuntimeState: runtimeMutations.handleUpdateRuntimeState,
  };
}
