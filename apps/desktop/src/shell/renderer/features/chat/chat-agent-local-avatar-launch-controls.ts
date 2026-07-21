import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildDesktopAvatarEphemeralInstanceId,
  buildDesktopAvatarInstanceId,
  closeDesktopAvatarHandoff,
  launchDesktopAvatarHandoff,
} from '../../bridge/runtime-bridge/chat-agent-avatar-launcher';
import {
  desktopAvatarInstanceRegistryQueryKey,
  listDesktopAvatarLiveInstances,
} from '../../bridge/runtime-bridge/chat-agent-avatar-instance-registry';
import { hasShellHostInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  arbitrateAvatarLaunch,
  evaluateStartWithChatGate,
  type AvatarLaunchArbitrationResult,
  type StartWithChatGateResult,
} from '@nimiplatform/kit/features/avatar/headless';
import { useQuery } from '@tanstack/react-query';
import { registerDesktopAvatarLiveInstanceBinding } from './chat-agent-avatar-live-instance-runtime-binding';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';

type AvatarComposerActionState =
  | 'running'
  | 'pending'
  | 'unavailable'
  | 'not_configured'
  | 'ready_stopped';

export function resolveAvatarComposerActionState(input: {
  avatarActionPending: boolean;
  avatarHandoffReady: boolean;
  avatarRuntimeAccountReady: boolean;
  avatarRunning: boolean;
  avatarConfigured: boolean;
}): AvatarComposerActionState {
  return input.avatarActionPending
    ? 'pending'
    : !input.avatarHandoffReady || !input.avatarRuntimeAccountReady
      ? 'unavailable'
      : input.avatarRunning
        ? 'running'
        : !input.avatarConfigured
          ? 'not_configured'
          : 'ready_stopped';
}

export function useAgentLocalAvatarLaunchControls(input: {
  presentation: UseAgentConversationPresentationInput;
  avatarAssetRef: string | null;
  backendCapabilityProfileRef: string | null;
  avatarConfigured: boolean;
  validationStatus: string | null;
}) {
  const presentation = input.presentation;
  const avatarHandoffReady = hasShellHostInvoke();
  const avatarRuntimeAccountReady = Boolean(presentation.accountId);
  const avatarConversationAnchorReady = Boolean(presentation.activeConversationAnchorId);
  const [avatarActionPending, setAvatarActionPending] = useState(false);
  const avatarInstanceId = useMemo(() => (
    presentation.activeTarget
      ? buildDesktopAvatarInstanceId({
        agentId: presentation.activeTarget.localAgentRef,
        threadId: presentation.activeThreadId,
      })
      : null
  ), [presentation.activeTarget, presentation.activeThreadId]);
  const avatarLiveInstancesQuery = useQuery({
    queryKey: presentation.activeTarget?.localAgentRef
      ? desktopAvatarInstanceRegistryQueryKey(presentation.activeTarget.localAgentRef)
      : ['desktop-avatar-instance-registry', 'none'],
    queryFn: async () => (
      presentation.activeTarget?.localAgentRef
        ? listDesktopAvatarLiveInstances({
          agentId: presentation.activeTarget.localAgentRef,
        })
        : []
    ),
    enabled: avatarHandoffReady && Boolean(presentation.activeTarget?.localAgentRef),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    refetchInterval: avatarHandoffReady && presentation.activeTarget?.localAgentRef ? 5_000 : false,
  });
  const runningAvatarInstance = avatarInstanceId
    ? avatarLiveInstancesQuery.data?.find((instance) => instance.avatarInstanceId === avatarInstanceId) || null
    : null;
  const avatarRunning = Boolean(runningAvatarInstance);
  const avatarInstancePolicy = null;
  const avatarLaunchMode = null;
  const avatarLiveInstances = useMemo(
    () => (avatarLiveInstancesQuery.data || []).map((instance) => ({
      avatarInstanceId: instance.avatarInstanceId,
      localAgentRef: instance.agentId,
    })),
    [avatarLiveInstancesQuery.data],
  );
  // D-LLM-105 condition 6 requires a typed Runtime authorization projection.
  // No admitted projection exists in this hook yet, so start_with_chat fails
  // closed instead of inferring authorization from account or bridge readiness.
  const avatarRuntimeProjectionAuthorization
    = presentation.accountId === null
        ? 'unauthorized' as const
        : 'unknown' as const;

  /**
   * Shared D-LLM-106 arbitrated launch executor. Both the `start_with_chat`
   * gate and the explicit composer launch route through here, so the launch
   * decision branches on `avatar_instance_policy` in exactly one place. The
   * emitted payload stays the D-LLM-072 LocalAgent identity envelope plus
   * Avatar instance launch fields.
   */
  const executeArbitratedLaunch = useCallback(async (input2: {
    trigger: 'start_with_chat' | 'explicit_user_action';
    newInstanceAlreadySpawnedForThisOpenEvent: boolean;
  }): Promise<{ arbitration: AvatarLaunchArbitrationResult; launched: boolean; opened: boolean }> => {
    if (!presentation.activeTarget || !avatarInstanceId || !presentation.activeConversationAnchorId) {
      return {
        arbitration: { decision: 'fail_closed', state: 'anchor_unavailable', policy: null },
        launched: false,
        opened: false,
      };
    }
    const newInstanceId = buildDesktopAvatarEphemeralInstanceId({
      agentId: presentation.activeTarget.localAgentRef,
      threadId: presentation.activeThreadId,
    });
    const arbitration = arbitrateAvatarLaunch({
      avatarInstancePolicy,
      trigger: input2.trigger,
      localAgentRef: presentation.activeTarget.localAgentRef,
      conversationAnchorId: presentation.activeConversationAnchorId,
      reuseInstanceId: avatarInstanceId,
      newInstanceId,
      liveInstances: avatarLiveInstances,
      newInstanceAlreadySpawnedForThisOpenEvent: input2.newInstanceAlreadySpawnedForThisOpenEvent,
    });
    if (arbitration.decision !== 'launch_instance') {
      // reuse_instance / require_user_selection / fail_closed never emit a
      // launch intent here; the caller maps them to typed product surfaces.
      return { arbitration, launched: false, opened: false };
    }
    await registerDesktopAvatarLiveInstanceBinding({
      target: presentation.activeTarget,
      avatarInstanceId: arbitration.avatarInstanceId,
      conversationAnchorId: presentation.activeConversationAnchorId,
      subjectUserId: presentation.accountId,
    });
    const result = await launchDesktopAvatarHandoff({
      agentId: presentation.activeTarget.localAgentRef,
      avatarInstanceId: arbitration.avatarInstanceId,
      launchSource: input2.trigger === 'start_with_chat'
        ? 'desktop-agent-chat-start-with-chat'
        : 'desktop-agent-chat',
    });
    await avatarLiveInstancesQuery.refetch();
    return { arbitration, launched: true, opened: result.opened };
  }, [
    avatarInstanceId,
    avatarInstancePolicy,
    avatarLiveInstances,
    avatarLiveInstancesQuery,
    presentation.accountId,
    presentation.activeConversationAnchorId,
    presentation.activeTarget,
    presentation.activeThreadId,
  ]);

  const handleComposerAvatarAction = useCallback(async () => {
    if (!presentation.activeTarget || !avatarInstanceId) {
      presentation.onOpenAgentCenter?.();
      return null;
    }
    if (!avatarHandoffReady) {
      return {
        kind: 'warning' as const,
        message: presentation.t('Chat.agentCenterAvatarStartRuntimeUnavailable', {
          defaultValue: 'Avatar launch requires the desktop Runtime bridge.',
        }),
      };
    }
    if (!avatarRuntimeAccountReady) {
      return {
        kind: 'warning' as const,
        message: presentation.t('Chat.agentCenterAvatarStartAccountRequired', {
          defaultValue: 'Sign in with the Runtime-backed desktop account before opening Avatar.',
        }),
      };
    }
    if (!avatarConversationAnchorReady || !presentation.activeConversationAnchorId) {
      return {
        kind: 'warning' as const,
        message: presentation.t('Chat.agentCenterAvatarStartAnchorRequired', {
          defaultValue: 'Open the current Runtime conversation anchor before opening Avatar.',
        }),
      };
    }
    if (!avatarRunning && !input.avatarConfigured) {
      presentation.onOpenAgentCenter?.();
      return null;
    }
    setAvatarActionPending(true);
    try {
      if (avatarRunning) {
        const result = await closeDesktopAvatarHandoff({
          avatarInstanceId,
          closedBy: 'desktop',
          sourceSurface: 'desktop-agent-chat',
        });
        await avatarLiveInstancesQuery.refetch();
        return {
          kind: result.opened ? 'success' as const : 'warning' as const,
          message: result.opened
            ? presentation.t('Chat.agentCenterAvatarStopSuccess', { defaultValue: 'Avatar close request sent.' })
            : presentation.t('Chat.agentCenterAvatarStopUnconfirmed', { defaultValue: 'Close request was sent, but the OS did not confirm it.' }),
        };
      }
      // D-LLM-106 - the explicit launch entry branches on instance policy
      // through the same arbitration authority as the start_with_chat gate.
      const { arbitration, launched, opened } = await executeArbitratedLaunch({
        trigger: 'explicit_user_action',
        newInstanceAlreadySpawnedForThisOpenEvent: false,
      });
      if (arbitration.decision === 'reuse_instance') {
        return {
          kind: 'success' as const,
          message: presentation.t('Chat.agentCenterAvatarReuseActiveInstance', {
            defaultValue: 'An Avatar is already running for this agent and conversation.',
          }),
        };
      }
      if (arbitration.decision === 'require_user_selection') {
        return {
          kind: 'warning' as const,
          message: presentation.t('Chat.agentCenterAvatarRequireUserSelection', {
            defaultValue: 'Choose which Avatar instance to launch for this agent.',
          }),
        };
      }
      if (arbitration.decision === 'fail_closed') {
        return {
          kind: 'warning' as const,
          message: arbitration.state === 'anchor_unavailable'
            ? presentation.t('Chat.agentCenterAvatarAnchorUnavailable', {
              defaultValue: 'Avatar launch needs an available conversation anchor.',
            })
            : arbitration.state === 'instance_conflict'
              ? presentation.t('Chat.agentCenterAvatarInstanceConflict', {
                defaultValue: 'An existing Avatar instance conflicts with this launch; close it or change the instance policy.',
              })
              : presentation.t('Chat.agentCenterAvatarInstancePolicyUnresolved', {
                defaultValue: 'Avatar launch needs a resolvable instance policy.',
              }),
        };
      }
      return {
        kind: launched && opened ? 'success' as const : 'warning' as const,
        message: launched && opened
          ? presentation.t('Chat.agentCenterAvatarStartSuccess', { defaultValue: 'Avatar launch requested. Waiting for the avatar to come online.' })
          : presentation.t('Chat.agentCenterAvatarStartUnconfirmed', { defaultValue: 'Launch request was sent, but the OS did not confirm it.' }),
      };
    } finally {
      setAvatarActionPending(false);
    }
  }, [
    avatarHandoffReady,
    avatarRuntimeAccountReady,
    avatarConversationAnchorReady,
    input.avatarConfigured,
    avatarInstanceId,
    avatarLiveInstancesQuery,
    avatarRunning,
    executeArbitratedLaunch,
    presentation.activeTarget,
    presentation.activeConversationAnchorId,
    presentation.onOpenAgentCenter,
    presentation.t,
  ]);

  // D-LLM-105 - the single `start_with_chat` auto-launch actuation site.
  // The gate evaluates on every Agent-Chat-open event for the selected
  // LocalAgent. The open event is keyed by { localAgentRef, conversationAnchorId };
  // reopening Agent Chat or switching anchor is a fresh open event and
  // re-evaluates the gate. No other surface/effect/hook emits start_with_chat.
  const [startWithChatGateResult, setStartWithChatGateResult] = useState<StartWithChatGateResult | null>(null);
  const startWithChatOpenEventKey = presentation.activeTarget?.localAgentRef && presentation.activeConversationAnchorId
    ? `${presentation.activeTarget.localAgentRef}::${presentation.activeConversationAnchorId}`
    : null;
  // Per-open-event repeated-spawn guard state (D-LLM-106). A single open event
  // spawns at most one new instance under launch_new_instance.
  const startWithChatActuationRef = useRef<{ openEventKey: string | null; newInstanceSpawned: boolean }>({
    openEventKey: null,
    newInstanceSpawned: false,
  });
  useEffect(() => {
    if (startWithChatActuationRef.current.openEventKey !== startWithChatOpenEventKey) {
      // New Agent-Chat-open event: reset the repeated-spawn guard.
      startWithChatActuationRef.current = {
        openEventKey: startWithChatOpenEventKey,
        newInstanceSpawned: false,
      };
    }
    const gateResult = evaluateStartWithChatGate({
      userLoggedIn: avatarRuntimeAccountReady,
      localAgentRef: presentation.activeTarget?.localAgentRef ?? null,
      runtimeSourceRef: presentation.activeTarget?.runtimeSourceRef ?? null,
      conversationAnchorId: presentation.activeConversationAnchorId,
      avatarAssetRef: input.avatarAssetRef,
      avatarAssetValidationStatus: input.validationStatus,
      backendCapabilityProfileRef: input.backendCapabilityProfileRef,
      runtimeProjectionAuthorization: avatarRuntimeProjectionAuthorization,
      launchMode: avatarLaunchMode,
      avatarInstancePolicy,
    });
    setStartWithChatGateResult(gateResult);
    if (gateResult.decision !== 'auto_launch') {
      // Fail closed: a failed gate produces a typed non-launch outcome and
      // never degrades to a guessed launch or remembered binding.
      return;
    }
    if (!avatarHandoffReady) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const { arbitration } = await executeArbitratedLaunch({
        trigger: 'start_with_chat',
        newInstanceAlreadySpawnedForThisOpenEvent:
          startWithChatActuationRef.current.openEventKey === startWithChatOpenEventKey
          && startWithChatActuationRef.current.newInstanceSpawned,
      });
      if (cancelled) {
        return;
      }
      if (
        arbitration.decision === 'launch_instance'
        && arbitration.policy === 'launch_new_instance'
        && startWithChatActuationRef.current.openEventKey === startWithChatOpenEventKey
      ) {
        // Mark this open event as having spawned a new instance so a
        // re-evaluation of the gate on the same open event does not double-spawn.
        startWithChatActuationRef.current.newInstanceSpawned = true;
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-evaluation is intentionally driven by the open-event key plus the
    // typed gate inputs; executeArbitratedLaunch is stable per those inputs.
  }, [
    startWithChatOpenEventKey,
    avatarRuntimeAccountReady,
    avatarHandoffReady,
    avatarRuntimeProjectionAuthorization,
    avatarLaunchMode,
    avatarInstancePolicy,
    input.avatarAssetRef,
    input.backendCapabilityProfileRef,
    input.validationStatus,
    presentation.activeTarget,
    presentation.activeConversationAnchorId,
    executeArbitratedLaunch,
  ]);

  const avatarComposerActionState = resolveAvatarComposerActionState({
    avatarActionPending,
    avatarHandoffReady,
    avatarRuntimeAccountReady,
    avatarRunning,
    avatarConfigured: input.avatarConfigured,
  });

  return {
    avatarLiveInstancesQuery,
    avatarComposerActionState,
    handleComposerAvatarAction,
    startWithChatGateResult,
  };
}
