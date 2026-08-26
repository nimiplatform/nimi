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
  createNimiRuntimeAgentConsumeClient,
  type NimiRuntimeAgentConversationAnchorSnapshot,
  type NimiRuntimeAgentTurnContextSummary,
  type NimiSharedLocalAgentAIConfigCallInput,
  type NimiSharedLocalAgentAIConfigOverwriteInput,
  type RuntimeLocalAgentIdentityInput,
} from '@nimiplatform/sdk/runtime';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import type { TFunction } from 'i18next';
import { useAppStore, type AuthStatus } from '../../app-shell/providers/app-store';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import {
  createFirstPartyAgentCenterSession,
  createAgentCenterShellAppearanceAdapter,
  type AgentCenterSharedAIConfigModule,
  type AgentCenterSession,
} from '@nimiplatform/kit/features/agent-center';
import { createAgentCenterShellBridge, hasElectronInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types';
import { type InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import { ensureRuntimeAgentExists } from './chat-agent-shell-host-actions-helpers';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useAgentConversationAnchorBindings } from '../../app-shell/providers/agent-conversation-anchor-binding-context.js';
import {
  createRuntimeAgentMemoryAdapter,
  type CanonicalMemoryBankStatus,
} from '../../infra/runtime-agent-memory';
import {
  createRuntimeAgentInspectAdapter,
  type NimiRuntimeAgentInspectEventSummary,
  type NimiRuntimeAgentInspectSnapshot,
} from '../../infra/runtime-agent-inspect';
import {
  createRuntimeAgentAIConfigAdapter,
  type NimiRuntimeAgentAIConfigSnapshot,
} from '../../infra/runtime-agent-ai-config';
import type { NimiRuntimeAgentPresentationProfileProjection } from '@nimiplatform/sdk/runtime';
import {
  useAgentConversationRuntimeMutations,
  type AutonomyConfigInput,
  type RuntimeStateInput,
} from './chat-agent-shell-adapter-runtime-mutations';
import { createDesktopAgentCenterAutonomyAdapter } from './chat-agent-center-autonomy-adapter.js';
import { createDesktopAgentCenterAvatarPreviewAdapter } from './chat-agent-center-avatar-preview-adapter.js';
import { createRuntimeAgentPresentationProfileAdapter } from '../../infra/runtime-agent-presentation-profile';
import { loadAgentRuntimeVoiceCatalog } from './chat-agent-runtime-voice-catalog.js';
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
  runtimeAgentAIConfigLoading: boolean;
  runtimeAgentAIConfigError: string | null;
  runtimeAgentCenterAdapter: AgentCenterSession | null;
  runtimeInspect: NimiRuntimeAgentInspectSnapshot | null;
  runtimeInspectLoading: boolean;
  runtimePresentationProfile: NimiRuntimeAgentPresentationProfileProjection | null;
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

const AGENT_PRESENTATION_MUTATION_TIMEOUT_MS = 60_000;

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

type DesktopAgentCenterTurnContextIdentity = RuntimeLocalAgentIdentityInput & {
  readonly conversationAnchorId?: string;
};

export async function loadDesktopAgentCenterTurnContextSummary(input: {
  readonly identity: DesktopAgentCenterTurnContextIdentity;
  readonly boundConversationAnchorId?: string | null;
  readonly getSnapshot: (
    identity: RuntimeLocalAgentIdentityInput & { readonly conversationAnchorId: string },
  ) => Promise<Pick<NimiRuntimeAgentConversationAnchorSnapshot, 'turnContextSummary'>>;
}): Promise<NimiRuntimeAgentTurnContextSummary | null> {
  const localAgentRef = normalizeText(input.identity.localAgentRef);
  const conversationAnchorId = normalizeText(input.identity.conversationAnchorId)
    || normalizeText(input.boundConversationAnchorId);
  if (!localAgentRef || !conversationAnchorId) return null;
  const snapshot = await input.getSnapshot({
    ownerUserId: input.identity.ownerUserId,
    runtimeSourceRef: input.identity.runtimeSourceRef,
    localAgentRef,
    conversationAnchorId,
  });
  return snapshot.turnContextSummary ?? null;
}

export function useAgentConversationRuntimeController(
  input: UseAgentConversationRuntimeControllerInput,
): AgentConversationRuntimeController {
  const anchorBindings = useAgentConversationAnchorBindings();
  const bindings = useDesktopRendererBindings();
  const subjectUserId = useAppStore((state) => normalizeText(state.auth.user?.id));
  const getSubjectUserId = useCallback(() => {
    if (!subjectUserId) {
      throw new Error('desktop agent shell requires authenticated subject user id for runtime.agent');
    }
    return subjectUserId;
  }, [subjectUserId]);
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
  const [runtimeAgentAIConfigLoading, setRuntimeAgentAIConfigLoading] = useState(false);
  const [runtimeAgentAIConfigError, setRuntimeAgentAIConfigError] = useState<string | null>(null);
  const [runtimeInspect, setRuntimeInspect] = useState<NimiRuntimeAgentInspectSnapshot | null>(null);
  const [runtimeInspectLoading, setRuntimeInspectLoading] = useState(false);
  const [runtimePresentationProfile, setRuntimePresentationProfile] =
    useState<NimiRuntimeAgentPresentationProfileProjection | null>(null);
  const [recentRuntimeEvents, setRecentRuntimeEvents] = useState<readonly NimiRuntimeAgentInspectEventSummary[]>([]);
  const lastInspectFetchedAgentIdRef = useRef<string | null>(null);
  const getRuntimeAgentMemoryClient = useCallback(() => ({
    appId: bindings.sdk.appId(),
    auth: bindings.sdk.accountRuntime().auth,
    agent: bindings.sdk.accountProduct().agents,
  }), [bindings]);
  const getRuntimeAgentInspectClient = useCallback(() => ({
    appId: bindings.sdk.appId(),
    auth: bindings.sdk.accountRuntime().auth,
    agent: bindings.sdk.runtimeAgentOwner(),
  }), [bindings]);
  const runtimeAgentMemory = useMemo(() => createRuntimeAgentMemoryAdapter({
    getRuntime: getRuntimeAgentMemoryClient,
    getSubjectUserId,
    withScopes: bindings.sdk.withRuntimeProtectedScopes,
  }), [bindings, getRuntimeAgentMemoryClient, getSubjectUserId]);
  const runtimeAgentInspect = useMemo(() => createRuntimeAgentInspectAdapter({
    getRuntime: getRuntimeAgentInspectClient,
    getSubjectUserId,
    withScopes: bindings.sdk.withRuntimeProtectedScopes,
  }), [bindings, getRuntimeAgentInspectClient, getSubjectUserId]);
  const runtimeAgentAIConfigAdapter = useMemo(() => createRuntimeAgentAIConfigAdapter({
    runtime: {
      get appId() { return bindings.sdk.appId(); },
      get auth() { return bindings.sdk.accountRuntime().auth; },
      get agent() { return bindings.sdk.accountProduct().agents; },
    },
    getSubjectUserId,
    withScopes: bindings.sdk.withRuntimeProtectedScopes,
  }), [bindings, getSubjectUserId]);
  const runtimeAgentCenterSharedAIConfig = useMemo<AgentCenterSharedAIConfigModule>(() => ({
    async get(account: NimiSharedLocalAgentAIConfigCallInput) {
      return runtimeAgentAIConfigAdapter.get({
        subjectUserId: account.subjectUserId,
      });
    },
    async overwrite(updateInput: NimiSharedLocalAgentAIConfigOverwriteInput) {
      return runtimeAgentAIConfigAdapter.update({
        subjectUserId: updateInput.subjectUserId,
        expectedRevision: updateInput.expectedRevision,
        capabilities: updateInput.capabilities,
      });
    },
    async listOptions(optionsInput) {
      return runtimeAgentAIConfigAdapter.listOptions(optionsInput);
    },
  }), [runtimeAgentAIConfigAdapter]);
  const runtimeAgentCenterAdapter = useMemo(() => {
    if (authStatus !== 'authenticated' || !activeTarget || !subjectUserId) {
      return null;
    }
    const lifecycle = bindings.sdk.runtimeAgentDiscovery(getSubjectUserId);
    const consume = createNimiRuntimeAgentConsumeClient({
      runtime: { agents: bindings.sdk.accountProduct().agents },
      runtimeAppId: bindings.sdk.appId(),
    });
    const identity = toRuntimeIdentityInput(activeTarget);
    const runtimePresentation = createRuntimeAgentPresentationProfileAdapter({
      getRuntime: bindings.sdk.hostRuntimeAgent,
      getSubjectUserId: () => subjectUserId,
      withScopes: (scopes, operation) => bindings.sdk.withRuntimeProtectedScopes(
        scopes,
        (options) => operation({
          ...options,
          timeoutMs: Math.min(
            options.timeoutMs ?? AGENT_PRESENTATION_MUTATION_TIMEOUT_MS,
            AGENT_PRESENTATION_MUTATION_TIMEOUT_MS,
          ),
        }),
      ),
    });
    const appearance = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: subjectUserId,
      runtimePresentation,
      shell: hasElectronInvoke() ? createAgentCenterShellBridge() : null,
      avatarPreview: createDesktopAgentCenterAvatarPreviewAdapter({
        avatarHandoff: bindings.app.commands.avatarHandoff,
      }),
      snapshot: { inspect: runtimeInspect as never },
      loadPresentation: () => runtimeAgentInspect.getPresentationProfile(identity),
      loadVoiceCatalog: () => loadAgentRuntimeVoiceCatalog({
        ai: bindings.sdk.aiExecution().ai,
        appId: bindings.sdk.appId(),
        subjectUserId,
      }),
      onPresentationCommitted(result) {
        setRuntimePresentationProfile(result.profile);
        setRuntimeInspect((current) => current ? {
          ...current,
          presentationProfile: result.profile,
          presentationProfileRevision: result.committedRevision,
        } : current);
      },
    });
    return createFirstPartyAgentCenterSession({
      identity,
      appearance,
      sharedAIConfig: runtimeAgentCenterSharedAIConfig,
      autonomy: createDesktopAgentCenterAutonomyAdapter(runtimeAgentInspect),
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
        const binding = anchorBindings.get(normalizeText(identity.localAgentRef));
        return loadDesktopAgentCenterTurnContextSummary({
          identity,
          boundConversationAnchorId: binding?.conversationAnchorId,
          getSnapshot: (snapshotIdentity) => consume.anchors.getSnapshot(snapshotIdentity),
        });
      },
    });
  }, [activeTarget, anchorBindings, authStatus, bindings, getSubjectUserId, runtimeAgentCenterSharedAIConfig, runtimeAgentInspect, runtimeInspect, subjectUserId]);

  useEffect(() => {
    let cancelled = false;
    if (authStatus !== 'authenticated' || !activeTarget) {
      setRuntimeAgentAIConfig(null);
      setRuntimeAgentAIConfigLoading(false);
      setRuntimeAgentAIConfigError(null);
      return () => {
        cancelled = true;
      };
    }
    setRuntimeAgentAIConfigLoading(true);
    // Runtime owns execution admission. Shell load reads configuration facts
    // only and never probes or resolves a capability implementation.
    void runtimeAgentAIConfigAdapter.get({ subjectUserId })
      .then((agentAIConfig) => {
        if (cancelled) {
          return;
        }
        setRuntimeAgentAIConfig(agentAIConfig);
        setRuntimeAgentAIConfigError(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setRuntimeAgentAIConfig(null);
        if (extractNimiErrorFields(error).reasonCode === 'AI_CONFIG_NOT_FOUND') {
          setRuntimeAgentAIConfigError(null);
          return;
        }
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
    void ensureRuntimeAgentExists(target, bindings.sdk, subjectUserId)
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
  }, [activeTarget, authStatus, bindings, buildHostErrorDetails, runtimeAgentInspect, subjectUserId]);

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
    void ensureRuntimeAgentExists(target, bindings.sdk, subjectUserId)
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
  }, [activeTarget, authStatus, bindings, buildHostErrorDetails, runtimeAgentInspect, subjectUserId]);

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
    let cancelFlush: (() => void) | null = null;
    const flush = () => {
      cancelFlush = null;
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
        if (cancelFlush === null) {
          cancelFlush = bindings.clock.schedule(eventsCoalesceMs, (result) => {
            if (!result.ok) {
              cancelFlush = null;
              pendingEvents = [];
              reportHostError(new Error(result.error));
              return;
            }
            flush();
          });
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
      cancelFlush?.();
      cancelFlush = null;
      pendingEvents = [];
    };
  }, [activeTarget?.localAgentRef, authStatus, bindings.clock, buildHostErrorDetails, diagnosticsVisible, reportHostError, runtimeAgentInspect]);

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
    runtimeAgentAIConfigLoading,
    runtimeAgentAIConfigError,
    runtimeAgentCenterAdapter,
    runtimeInspect,
    runtimeInspectLoading,
    runtimePresentationProfile,
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
