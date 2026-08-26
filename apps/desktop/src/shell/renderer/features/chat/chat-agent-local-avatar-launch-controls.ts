import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createNimiClientId } from '@nimiplatform/sdk';
import {
  arbitrateAvatarLaunch,
  evaluateStartWithChatGate,
  type AvatarLaunchArbitrationResult,
  type StartWithChatGateResult,
} from '@nimiplatform/kit/features/avatar/headless';
import { useQuery } from '@tanstack/react-query';
import {
  registerDesktopAvatarLiveInstanceBinding,
  resolveDesktopAvatarPresentationBinding,
} from './chat-agent-avatar-live-instance-runtime-binding';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

function avatarInstanceSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '') || 'unknown';
}

function buildAvatarInstanceId(agentId: string, threadId?: string | null): string {
  if (!agentId.startsWith('local-agent:')) throw new Error('avatar agentId must be a local-agent ref');
  return `desktop-avatar-${avatarInstanceSegment(agentId)}-${avatarInstanceSegment(threadId || 'default')}`;
}

function buildEphemeralAvatarInstanceId(agentId: string, threadId?: string | null): string {
  return `${buildAvatarInstanceId(agentId, threadId)}-${avatarInstanceSegment(createNimiClientId('avatar-nonce'))}`;
}

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
  const bindings = useDesktopRendererBindings();
  const sdk = bindings.sdk;
  const presentation = input.presentation;
  const selectedAgentHandle = String(presentation.activeTarget?.agentHandle || '').trim();
  const presentationBindingQuery = useQuery({
    queryKey: selectedAgentHandle
      ? ['desktop-avatar-presentation-binding', selectedAgentHandle]
      : ['desktop-avatar-presentation-binding', 'none'],
    queryFn: () => resolveDesktopAvatarPresentationBinding({ agentHandle: selectedAgentHandle, sdk }),
    enabled: Boolean(selectedAgentHandle && presentation.accountId),
    staleTime: 30_000,
  });
  const presentationAgentId = presentationBindingQuery.data?.localAgentRef ?? null;
  const avatarHandoffReady = bindings.app.commands.avatarHandoff.available();
  const avatarRuntimeAccountReady = Boolean(presentation.accountId);
  const avatarConversationAnchorReady = Boolean(presentation.activeConversationAnchorId);
  const [avatarActionPending, setAvatarActionPending] = useState(false);
  const avatarInstanceId = useMemo(() => (
    presentationAgentId
      ? buildAvatarInstanceId(
        presentationAgentId,
        presentation.activeThreadId,
      )
      : null
  ), [presentation.activeThreadId, presentationAgentId]);
  const avatarLiveInstancesQuery = useQuery({
    queryKey: presentationAgentId
      ? ['desktop-avatar-instance-registry', presentationAgentId]
      : ['desktop-avatar-instance-registry', 'none'],
    queryFn: async () => (
      presentationAgentId
        ? bindings.app.commands.avatarHandoff.list(presentationAgentId)
        : []
    ),
    enabled: avatarHandoffReady && Boolean(presentationAgentId),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    refetchInterval: avatarHandoffReady && presentationAgentId ? 5_000 : false,
  });
  // The query result object has a fresh identity on every render; only the
  // stable refetch handle may enter callback/effect dependency lists, or the
  // start_with_chat gate effect re-runs (and setStates) on every render.
  const refetchAvatarLiveInstances = avatarLiveInstancesQuery.refetch;
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
  // No admitted Runtime authorization projection exists for automatic launch,
  // so start_with_chat fails closed instead of inferring authorization from
  // account or bridge readiness.
  const avatarRuntimeProjectionAuthorization
    = presentation.accountId === null
        ? 'unauthorized' as const
        : 'unknown' as const;

  // Automatic launch remains fail closed until Runtime projects an admitted
  // launch mode, authorization verdict, and instance policy. Explicit user
  // launch does not depend on that retired Desktop-side proof chain: the
  // verified host owns validation and exact-instance reuse.
  const executeArbitratedLaunch = useCallback(async (input2: {
    trigger: 'start_with_chat';
    newInstanceAlreadySpawnedForThisOpenEvent: boolean;
  }): Promise<{ arbitration: AvatarLaunchArbitrationResult; launched: boolean; opened: boolean }> => {
    if (!presentation.activeTarget || !presentationAgentId || !avatarInstanceId || !presentation.activeConversationAnchorId) {
      return {
        arbitration: { decision: 'fail_closed', state: 'anchor_unavailable', policy: null },
        launched: false,
        opened: false,
      };
    }
    const newInstanceId = buildEphemeralAvatarInstanceId(
      presentationAgentId,
      presentation.activeThreadId,
    );
    const arbitration = arbitrateAvatarLaunch({
      avatarInstancePolicy,
      trigger: input2.trigger,
      localAgentRef: presentationAgentId,
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
    const agentHandle = String(presentation.activeTarget.agentHandle || '').trim();
    if (!agentHandle) throw new Error('Avatar launch requires the selected canonical Agent handle.');
    await registerDesktopAvatarLiveInstanceBinding({
      target: presentation.activeTarget,
      avatarInstanceId: arbitration.avatarInstanceId,
      conversationAnchorId: presentation.activeConversationAnchorId,
      subjectUserId: presentation.accountId || '',
      sdk,
    });
    const result = await bindings.app.commands.avatarHandoff.launch({
      agentId: presentationAgentId,
      agentHandle,
      conversationAnchorId: presentation.activeConversationAnchorId,
      avatarInstanceId: arbitration.avatarInstanceId,
      launchSource: input2.trigger === 'start_with_chat'
        ? 'desktop-agent-chat-start-with-chat'
        : 'desktop-agent-chat',
    });
    await refetchAvatarLiveInstances();
    return { arbitration, launched: true, opened: result.opened };
  }, [
    avatarInstanceId,
    avatarInstancePolicy,
    avatarLiveInstances,
    refetchAvatarLiveInstances,
    sdk,
    presentation.accountId,
    presentation.activeConversationAnchorId,
    presentation.activeTarget,
    presentation.activeThreadId,
    presentationAgentId,
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
        const result = await bindings.app.commands.avatarHandoff.close({
          avatarInstanceId,
          closedBy: 'desktop',
        });
        await refetchAvatarLiveInstances();
        return {
          kind: result.opened ? 'success' as const : 'warning' as const,
          message: result.opened
            ? presentation.t('Chat.agentCenterAvatarStopSuccess', { defaultValue: 'Avatar close request sent.' })
            : presentation.t('Chat.agentCenterAvatarStopUnconfirmed', { defaultValue: 'Close request was sent, but the OS did not confirm it.' }),
        };
      }
      const agentHandle = String(presentation.activeTarget.agentHandle || '').trim();
      if (!agentHandle) throw new Error('Avatar launch requires the selected canonical Agent handle.');
      await registerDesktopAvatarLiveInstanceBinding({
        target: presentation.activeTarget,
        avatarInstanceId,
        conversationAnchorId: presentation.activeConversationAnchorId,
        subjectUserId: presentation.accountId || '',
        sdk,
      });
      const result = await bindings.app.commands.avatarHandoff.launch({
        agentId: presentationAgentId!,
        agentHandle,
        conversationAnchorId: presentation.activeConversationAnchorId,
        avatarInstanceId,
        launchSource: 'desktop-agent-chat',
      });
      await refetchAvatarLiveInstances();
      return {
        kind: result.opened ? 'success' as const : 'warning' as const,
        message: result.opened
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
    bindings,
    refetchAvatarLiveInstances,
    avatarRunning,
    sdk,
    presentation.accountId,
    presentation.activeTarget,
    presentation.activeConversationAnchorId,
    presentation.onOpenAgentCenter,
    presentation.t,
  ]);

  // The single `start_with_chat` auto-launch actuation site. The gate evaluates
  // on every Agent-Chat-open event for the selected
  // LocalAgent. The open event is keyed by { localAgentRef, conversationAnchorId };
  // reopening Agent Chat or switching anchor is a fresh open event and
  // re-evaluates the gate. No other surface/effect/hook emits start_with_chat.
  const [startWithChatGateResult, setStartWithChatGateResult] = useState<StartWithChatGateResult | null>(null);
  const startWithChatOpenEventKey = presentationAgentId && presentation.activeConversationAnchorId
    ? `${presentationAgentId}::${presentation.activeConversationAnchorId}`
    : null;
  // Per-open-event repeated-spawn guard state. A single open event spawns at
  // most one new instance under launch_new_instance.
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
      localAgentRef: presentationAgentId,
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
    presentationAgentId,
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
