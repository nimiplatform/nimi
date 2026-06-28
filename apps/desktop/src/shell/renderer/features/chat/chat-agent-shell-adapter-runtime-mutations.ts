import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { confirmDialog } from '@nimiplatform/kit/shell/renderer/bridge';
import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
import type { InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import type { CanonicalMemoryBankStatus, createRuntimeAgentMemoryAdapter } from '@renderer/infra/runtime-agent-memory';
import type { createRuntimeAgentInspectAdapter, NimiRuntimeAgentInspectSnapshot } from '@renderer/infra/runtime-agent-inspect';

type RuntimeAgentMemoryAdapter = ReturnType<typeof createRuntimeAgentMemoryAdapter>;
type RuntimeAgentInspectAdapter = ReturnType<typeof createRuntimeAgentInspectAdapter>;

type RuntimeHostErrorReporter = (
  error: unknown,
  options?: { action?: string; extra?: Record<string, unknown> },
) => void;

export type RuntimeStateInput = {
  statusText: string;
  worldId: string;
  userId: string;
};

export type AutonomyConfigInput = {
  mode: string;
  dailyTokenBudget: string;
  maxTokensPerHook: string;
};

type AgentConversationRuntimeMutationInput = {
  activeTarget: AgentLocalTargetSnapshot | null;
  refreshRuntimeInspect: (target: AgentLocalTargetSnapshot, options?: { surfaceErrors?: boolean }) => Promise<void>;
  reportHostError: RuntimeHostErrorReporter;
  runtimeAgentInspect: RuntimeAgentInspectAdapter;
  runtimeAgentMemory: RuntimeAgentMemoryAdapter;
  runtimeInspect: NimiRuntimeAgentInspectSnapshot | null;
  setCanonicalMemoryStatus: Dispatch<SetStateAction<CanonicalMemoryBankStatus | null>>;
  setHostFeedback: Dispatch<SetStateAction<InlineFeedbackState | null>>;
  t: TFunction;
};

type RuntimeIdentityInput = {
  readonly localAgentRef: string;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
};

export type AgentConversationRuntimeMutationController = {
  mutationPendingAction: string | null;
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

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveRuntimeIdentity(target: AgentLocalTargetSnapshot | null): RuntimeIdentityInput | null {
  const localAgentRef = normalizeText(target?.localAgentRef);
  const ownerUserId = normalizeText(target?.ownerUserId);
  const runtimeSourceRef = normalizeText(target?.runtimeSourceRef);
  if (!target || !localAgentRef || !ownerUserId || !runtimeSourceRef) {
    return null;
  }
  return { localAgentRef, ownerUserId, runtimeSourceRef };
}

export function useAgentConversationRuntimeMutations(
  input: AgentConversationRuntimeMutationInput,
): AgentConversationRuntimeMutationController {
  const {
    activeTarget,
    refreshRuntimeInspect,
    reportHostError,
    runtimeAgentInspect,
    runtimeAgentMemory,
    runtimeInspect,
    setCanonicalMemoryStatus,
    setHostFeedback,
    t,
  } = input;
  const [mutationPendingAction, setMutationPendingAction] = useState<string | null>(null);

  const handleEnableAutonomy = useCallback(() => {
    const identity = resolveRuntimeIdentity(activeTarget);
    const agentId = identity?.localAgentRef || '';
    const targetName = normalizeText(activeTarget?.displayName) || agentId;
    if (!activeTarget || !identity) {
      return;
    }
    setMutationPendingAction('Enabling autonomy…');
    void runtimeAgentInspect.enableAutonomy(identity)
      .then(async () => {
        await refreshRuntimeInspect(activeTarget);
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
  }, [activeTarget, refreshRuntimeInspect, reportHostError, runtimeAgentInspect, setHostFeedback, t]);

  const handleDisableAutonomy = useCallback(() => {
    const identity = resolveRuntimeIdentity(activeTarget);
    const agentId = identity?.localAgentRef || '';
    const targetName = normalizeText(activeTarget?.displayName) || agentId;
    if (!activeTarget || !identity) {
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
        ...identity,
        reason: 'desktop_agent_chat_diagnostics_disable',
      });
      await refreshRuntimeInspect(activeTarget);
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
  }, [activeTarget, refreshRuntimeInspect, reportHostError, runtimeAgentInspect, setHostFeedback, t]);

  const handleCancelPendingHook = useCallback((hookId: string) => {
    const identity = resolveRuntimeIdentity(activeTarget);
    const normalizedHookId = normalizeText(hookId);
    if (!activeTarget || !identity || !normalizedHookId) {
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
        ...identity,
        hookId: normalizedHookId,
        reason: 'desktop_agent_chat_diagnostics_cancel',
      });
      await refreshRuntimeInspect(activeTarget);
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
  }, [activeTarget, refreshRuntimeInspect, reportHostError, runtimeAgentInspect, setHostFeedback, t]);

  const handleUpdateAutonomyConfig = useCallback((config: AutonomyConfigInput) => {
    const identity = resolveRuntimeIdentity(activeTarget);
    const agentId = identity?.localAgentRef || '';
    const targetName = normalizeText(activeTarget?.displayName) || agentId;
    if (!activeTarget || !identity) {
      return;
    }
    setMutationPendingAction('Updating autonomy config…');
    void runtimeAgentInspect.setAutonomyConfig({
      ...identity,
      mode: config.mode,
      dailyTokenBudget: config.dailyTokenBudget,
      maxTokensPerHook: config.maxTokensPerHook,
    })
      .then(async () => {
        await refreshRuntimeInspect(activeTarget);
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
  }, [activeTarget, refreshRuntimeInspect, reportHostError, runtimeAgentInspect, setHostFeedback, t]);

  const handleUpgradeStandardMemory = useCallback(() => {
    const agentId = normalizeText(activeTarget?.localAgentRef);
    const targetName = normalizeText(activeTarget?.displayName) || agentId;
    if (!activeTarget || !agentId) {
      return;
    }
    setMutationPendingAction('Upgrading memory…');
    void runtimeAgentMemory.bindCanonicalBankStandard({
      localAgentRef: activeTarget.localAgentRef,
      ownerUserId: activeTarget.ownerUserId,
      runtimeSourceRef: activeTarget.runtimeSourceRef,
    })
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
        reportHostError(error, {
          action: 'bind-canonical-memory-standard',
          extra: { agentId },
        });
      })
      .finally(() => {
        setMutationPendingAction(null);
      });
  }, [activeTarget?.localAgentRef, activeTarget?.displayName, reportHostError, runtimeAgentMemory, setCanonicalMemoryStatus, setHostFeedback, t]);

  const handleUpdateRuntimeState = useCallback((stateInput: RuntimeStateInput) => {
    const identity = resolveRuntimeIdentity(activeTarget);
    const agentId = identity?.localAgentRef || '';
    const targetName = normalizeText(activeTarget?.displayName) || agentId;
    if (!activeTarget || !identity) {
      return;
    }
    const nextStatusText = normalizeText(stateInput.statusText);
    const nextWorldId = normalizeText(stateInput.worldId);
    const nextUserId = normalizeText(stateInput.userId);
    const currentStatusText = normalizeText(runtimeInspect?.statusText);
    const currentWorldId = normalizeText(runtimeInspect?.activeWorldId);
    const currentUserId = normalizeText(runtimeInspect?.activeUserId);
    const payload: {
      localAgentRef: string;
      ownerUserId: string;
      runtimeSourceRef: string;
      statusText?: string;
      worldId?: string;
      userId?: string;
    } = { ...identity };
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
        await refreshRuntimeInspect(activeTarget);
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
  }, [activeTarget, refreshRuntimeInspect, reportHostError, runtimeAgentInspect, runtimeInspect, setHostFeedback, t]);

  const handleClearWorldContext = useCallback(() => {
    const identity = resolveRuntimeIdentity(activeTarget);
    const agentId = identity?.localAgentRef || '';
    const targetName = normalizeText(activeTarget?.displayName) || agentId;
    if (!activeTarget || !identity || !normalizeText(runtimeInspect?.activeWorldId)) {
      return;
    }
    setMutationPendingAction('Clearing world context…');
    void runtimeAgentInspect.updateState({
      ...identity,
      clearWorldContext: true,
    })
      .then(async () => {
        await refreshRuntimeInspect(activeTarget);
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
  }, [activeTarget, refreshRuntimeInspect, reportHostError, runtimeAgentInspect, runtimeInspect?.activeWorldId, setHostFeedback, t]);

  const handleClearDyadicContext = useCallback(() => {
    const identity = resolveRuntimeIdentity(activeTarget);
    const agentId = identity?.localAgentRef || '';
    const targetName = normalizeText(activeTarget?.displayName) || agentId;
    if (!activeTarget || !identity || !normalizeText(runtimeInspect?.activeUserId)) {
      return;
    }
    setMutationPendingAction('Clearing dyadic context…');
    void runtimeAgentInspect.updateState({
      ...identity,
      clearDyadicContext: true,
    })
      .then(async () => {
        await refreshRuntimeInspect(activeTarget);
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
  }, [activeTarget, refreshRuntimeInspect, reportHostError, runtimeAgentInspect, runtimeInspect?.activeUserId, setHostFeedback, t]);

  const handleRefreshRuntimeInspect = useCallback(() => {
    if (!activeTarget || !resolveRuntimeIdentity(activeTarget)) {
      return;
    }
    void refreshRuntimeInspect(activeTarget, { surfaceErrors: true });
  }, [activeTarget, refreshRuntimeInspect]);

  return {
    mutationPendingAction,
    handleCancelPendingHook,
    handleUpgradeStandardMemory,
    handleClearDyadicContext,
    handleClearWorldContext,
    handleDisableAutonomy,
    handleEnableAutonomy,
    handleRefreshRuntimeInspect,
    handleUpdateAutonomyConfig,
    handleUpdateRuntimeState,
  };
}
