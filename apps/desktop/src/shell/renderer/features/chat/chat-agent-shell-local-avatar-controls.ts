import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasTauriInvoke } from '@renderer/bridge/runtime-bridge/env';
import {
  buildDesktopAvatarEphemeralInstanceId,
  buildDesktopAvatarInstanceId,
  closeDesktopAvatarHandoff,
  launchDesktopAvatarHandoff,
} from '@renderer/bridge/runtime-bridge/chat-agent-avatar-launcher';
import {
  arbitrateAvatarLaunch,
  evaluateStartWithChatGate,
  type AvatarLaunchArbitrationResult,
  type StartWithChatGateResult,
} from './chat-agent-avatar-launch-arbitration';
import {
  desktopAvatarInstanceRegistryQueryKey,
  listDesktopAvatarLiveInstances,
} from '@renderer/bridge/runtime-bridge/chat-agent-avatar-instance-registry';
import {
  agentCenterLocalConfigQueryKey,
  getAgentCenterBackgroundAsset,
  getAgentCenterLocalConfig,
  importAgentCenterAvatarAsset,
  importAgentCenterBackground,
  importAgentCenterLive2dAdapterManifest,
  listAgentCenterAvatarAssets,
  pickAgentCenterAvatarAssetSource,
  pickAgentCenterBackgroundSource,
  pickAgentCenterLive2dAdapterManifestSource,
  removeAgentCenterAvatarAsset,
  removeAgentCenterBackground,
  selectAgentCenterAvatarAsset,
  validateAgentCenterAvatarAsset,
} from '@renderer/bridge/runtime-bridge/chat-agent-center-local-config-store';
import type { AgentCenterAvatarAssetKind } from './chat-agent-center-local-config';
import { registerDesktopAvatarLiveInstanceBinding } from './chat-agent-avatar-live-instance-runtime-binding';
import { useAgentCenterAvatarConfigMutation } from './chat-agent-center-avatar-config-mutation';
import { buildAvatarAssetValidationPresentation } from './chat-agent-shell-avatar-asset-diagnostics';
import { assetUrlFromFileUrl } from './chat-agent-shell-presentation-status';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';

type AvatarComposerActionState =
  | 'running'
  | 'pending'
  | 'unavailable'
  | 'not_configured'
  | 'local_asset_invalid'
  | 'ready_stopped';

export function resolveAvatarComposerActionState(input: {
  avatarActionPending: boolean;
  avatarHandoffReady: boolean;
  avatarRuntimeAccountReady: boolean;
  avatarRunning: boolean;
  avatarConfigured: boolean;
  avatarAssetValid: boolean;
}): AvatarComposerActionState {
  return input.avatarActionPending
    ? 'pending'
    : !input.avatarHandoffReady || !input.avatarRuntimeAccountReady
      ? 'unavailable'
      : input.avatarRunning
        ? 'running'
        : !input.avatarConfigured
          ? 'not_configured'
          : !input.avatarAssetValid
            ? 'local_asset_invalid'
            : 'ready_stopped';
}

export function useAgentConversationLocalAvatarControls(input: UseAgentConversationPresentationInput) {
  const queryClient = useQueryClient();
  const agentCenterLocalConfigQuery = useQuery({
    queryKey: input.accountId && input.activeTarget?.localAgentRef
      ? agentCenterLocalConfigQueryKey(input.accountId, input.activeTarget.localAgentRef)
      : ['agent-center-local-config', 'none'],
    queryFn: async () => (
      input.accountId && input.activeTarget?.localAgentRef
        ? getAgentCenterLocalConfig({
          accountId: input.accountId,
          ownerUserId: input.activeTarget.ownerUserId,
          realmAgentId: input.activeTarget.realmAgentId,
          localAgentRef: input.activeTarget.localAgentRef,
        })
        : null
    ),
    enabled: hasTauriInvoke() && Boolean(input.accountId && input.activeTarget?.localAgentRef),
    staleTime: 30_000,
  });
  const avatarAssetConfig = agentCenterLocalConfigQuery.data?.modules.avatar_asset || null;
  const selectedBackgroundAssetId = agentCenterLocalConfigQuery.data?.modules.appearance.background_asset_id || null;
  const backgroundAssetQuery = useQuery({
    queryKey: input.accountId && input.activeTarget?.localAgentRef && selectedBackgroundAssetId
      ? [
        'agent-center-background-asset',
        input.accountId,
        input.activeTarget.localAgentRef,
        selectedBackgroundAssetId,
      ]
      : ['agent-center-background-asset', 'none'],
    queryFn: async () => (
      input.accountId && input.activeTarget?.localAgentRef && selectedBackgroundAssetId
        ? getAgentCenterBackgroundAsset({
          accountId: input.accountId,
          ownerUserId: input.activeTarget.ownerUserId,
          realmAgentId: input.activeTarget.realmAgentId,
          localAgentRef: input.activeTarget.localAgentRef,
          backgroundAssetId: selectedBackgroundAssetId,
        })
        : null
    ),
    enabled: hasTauriInvoke() && Boolean(input.accountId && input.activeTarget?.localAgentRef && selectedBackgroundAssetId),
    staleTime: 30_000,
  });
  const backdropImageUrl = assetUrlFromFileUrl(backgroundAssetQuery.data?.file_url);
  const avatarConfigured = Boolean(avatarAssetConfig?.local_avatar_asset_ref);
  const avatarAssetValidationQuery = useQuery({
    queryKey: input.accountId && input.activeTarget?.localAgentRef && avatarAssetConfig?.local_avatar_asset_ref
      ? [
        'agent-center-avatar-asset-validation',
        input.accountId,
        input.activeTarget.localAgentRef,
        avatarAssetConfig.local_avatar_asset_ref,
        avatarAssetConfig.backend_kind,
        avatarAssetConfig.backend_capability_profile_ref,
      ]
      : ['agent-center-avatar-asset-validation', 'none'],
    queryFn: async () => (
      input.accountId && input.activeTarget?.localAgentRef && avatarAssetConfig?.local_avatar_asset_ref
        ? validateAgentCenterAvatarAsset({
          accountId: input.accountId,
          ownerUserId: input.activeTarget.ownerUserId,
          realmAgentId: input.activeTarget.realmAgentId,
          localAgentRef: input.activeTarget.localAgentRef,
        })
        : null
    ),
    enabled: hasTauriInvoke() && Boolean(
      input.accountId
      && input.activeTarget?.localAgentRef
      && input.activeTarget?.localAgentRef
      && avatarAssetConfig?.local_avatar_asset_ref,
    ),
    staleTime: 15_000,
  });
  const avatarAssetValidation = avatarAssetValidationQuery.data || null;
  const avatarAssetValid = Boolean(
    avatarAssetConfig?.local_avatar_asset_ref
      && avatarAssetConfig.backend_capability_profile_ref
      && avatarAssetValidation?.status === 'valid',
  );
  const avatarAssetChecking = avatarAssetValidationQuery.isFetching;
  const avatarAssetValidationPresentation = buildAvatarAssetValidationPresentation({
    config: avatarAssetConfig,
    validation: avatarAssetValidation,
    configured: avatarConfigured,
    valid: avatarAssetValid,
    checking: avatarAssetChecking,
  });
  const avatarAssetLibraryQuery = useQuery({
    queryKey: input.accountId && input.activeTarget?.localAgentRef
      ? ['agent-center-avatar-asset-library', input.accountId, input.activeTarget.localAgentRef]
      : ['agent-center-avatar-asset-library', 'none'],
    queryFn: async () => (
      input.accountId && input.activeTarget?.localAgentRef
        ? listAgentCenterAvatarAssets({
          accountId: input.accountId,
          ownerUserId: input.activeTarget.ownerUserId,
          realmAgentId: input.activeTarget.realmAgentId,
          localAgentRef: input.activeTarget.localAgentRef,
        })
        : { selected_local_asset_id: null, assets: [] }
    ),
    enabled: hasTauriInvoke() && Boolean(input.accountId && input.activeTarget?.localAgentRef),
    staleTime: 15_000,
  });
  const avatarConfigMutation = useAgentCenterAvatarConfigMutation(input, queryClient, agentCenterLocalConfigQuery.data);
  const avatarAssetSelectMutation = useMutation({
    mutationFn: async (localAssetId: string) => {
      if (!input.accountId || !input.activeTarget?.localAgentRef) {
        throw new Error(input.t('Chat.agentCenterAvatarImportAgentRequired', {
          defaultValue: 'Select an agent before importing a local Avatar asset.',
        }));
      }
      return selectAgentCenterAvatarAsset({
        accountId: input.accountId,
        ownerUserId: input.activeTarget.ownerUserId,
        realmAgentId: input.activeTarget.realmAgentId,
        localAgentRef: input.activeTarget.localAgentRef,
        localAssetId,
      });
    },
    onSuccess: async () => {
      if (!input.accountId || !input.activeTarget?.localAgentRef) {
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentCenterLocalConfigQueryKey(input.accountId, input.activeTarget.localAgentRef),
        }),
        queryClient.invalidateQueries({ queryKey: ['agent-center-avatar-asset-library'] }),
        queryClient.invalidateQueries({ queryKey: ['agent-center-avatar-asset-validation'] }),
        avatarLiveInstancesQuery.refetch(),
      ]);
    },
  });
  const avatarAssetImportMutation = useMutation({
    mutationFn: async (kind: AgentCenterAvatarAssetKind) => {
      if (!input.accountId || !input.activeTarget?.localAgentRef) {
        throw new Error(input.t('Chat.agentCenterAvatarImportAgentRequired', {
          defaultValue: 'Select an agent before importing a local Avatar asset.',
        }));
      }
      const sourcePath = await pickAgentCenterAvatarAssetSource(kind);
      if (!sourcePath) {
        return null;
      }
      return importAgentCenterAvatarAsset({
        accountId: input.accountId,
        ownerUserId: input.activeTarget.ownerUserId,
        realmAgentId: input.activeTarget.realmAgentId,
        localAgentRef: input.activeTarget.localAgentRef,
        kind,
        sourcePath,
        select: true,
      });
    },
    onSuccess: async (result) => {
      if (!result || !input.accountId || !input.activeTarget?.localAgentRef) {
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentCenterLocalConfigQueryKey(input.accountId, input.activeTarget.localAgentRef),
        }),
        queryClient.invalidateQueries({ queryKey: ['agent-center-avatar-asset-library'] }),
        queryClient.invalidateQueries({ queryKey: ['agent-center-avatar-asset-validation'] }),
        avatarLiveInstancesQuery.refetch(),
      ]);
    },
  });
  const live2dAdapterManifestImportMutation = useMutation({
    mutationFn: async () => {
      if (!input.accountId || !input.activeTarget?.localAgentRef || !avatarAssetConfig?.local_avatar_asset_ref) {
        throw new Error(input.t('Chat.agentCenterLive2dAdapterManifestAssetRequired', {
          defaultValue: 'Import and select a Live2D Avatar asset before linking its adapter manifest.',
        }));
      }
      if (avatarAssetConfig.backend_kind !== 'live2d') {
        throw new Error(input.t('Chat.agentCenterLive2dAdapterImportLive2dRequired', {
          defaultValue: 'Live2D adapter manifests can only be linked to Live2D Avatar assets.',
        }));
      }
      const sourcePath = await pickAgentCenterLive2dAdapterManifestSource();
      if (!sourcePath) {
        return null;
      }
      return importAgentCenterLive2dAdapterManifest({
        accountId: input.accountId,
        ownerUserId: input.activeTarget.ownerUserId,
        realmAgentId: input.activeTarget.realmAgentId,
        localAgentRef: input.activeTarget.localAgentRef,
        localAssetId: avatarAssetConfig.local_avatar_asset_ref,
        sourcePath,
        select: true,
      });
    },
    onSuccess: async (result) => {
      if (!result || !input.accountId || !input.activeTarget?.localAgentRef) {
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: agentCenterLocalConfigQueryKey(input.accountId, input.activeTarget.localAgentRef),
      });
      await queryClient.invalidateQueries({ queryKey: ['agent-center-avatar-asset-validation'] });
    },
  });
  const clearAvatarAssetMutation = useMutation({
    mutationFn: async () => {
      if (!input.accountId || !input.activeTarget?.localAgentRef || !avatarAssetConfig?.local_avatar_asset_ref) {
        return null;
      }
      return removeAgentCenterAvatarAsset({
        accountId: input.accountId,
        ownerUserId: input.activeTarget.ownerUserId,
        realmAgentId: input.activeTarget.realmAgentId,
        localAgentRef: input.activeTarget.localAgentRef,
        localAssetId: avatarAssetConfig.local_avatar_asset_ref,
      });
    },
    onSuccess: async (result) => {
      if (!result || !input.accountId || !input.activeTarget?.localAgentRef) {
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentCenterLocalConfigQueryKey(input.accountId, input.activeTarget.localAgentRef),
        }),
        queryClient.invalidateQueries({ queryKey: ['agent-center-avatar-asset-library'] }),
        queryClient.invalidateQueries({ queryKey: ['agent-center-avatar-asset-validation'] }),
        avatarLiveInstancesQuery.refetch(),
      ]);
    },
  });
  const avatarImportDisabled = !hasTauriInvoke()
    || !input.accountId
    || !input.activeTarget?.localAgentRef
    || avatarAssetImportMutation.isPending;
  const avatarImportError = avatarAssetImportMutation.error instanceof Error
    ? avatarAssetImportMutation.error.message
    : live2dAdapterManifestImportMutation.error instanceof Error
      ? live2dAdapterManifestImportMutation.error.message
      : avatarAssetSelectMutation.error instanceof Error
        ? avatarAssetSelectMutation.error.message
      : clearAvatarAssetMutation.error instanceof Error
        ? clearAvatarAssetMutation.error.message
        : null;
  const backgroundValidation = backgroundAssetQuery.data?.validation || null;
  const backgroundValid = backgroundValidation?.status === 'valid';
  const backgroundImportMutation = useMutation({
    mutationFn: async () => {
      if (!input.accountId || !input.activeTarget?.localAgentRef) {
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
        ownerUserId: input.activeTarget.ownerUserId,
        realmAgentId: input.activeTarget.realmAgentId,
        localAgentRef: input.activeTarget.localAgentRef,
        sourcePath,
        select: true,
      });
    },
    onSuccess: async (result) => {
      if (!result || !input.accountId || !input.activeTarget?.localAgentRef) {
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentCenterLocalConfigQueryKey(input.accountId, input.activeTarget.localAgentRef),
        }),
        queryClient.invalidateQueries({ queryKey: ['agent-center-background-asset'] }),
      ]);
    },
  });
  const backgroundImportDisabled = !hasTauriInvoke()
    || !input.accountId
    || !input.activeTarget?.localAgentRef
    || backgroundImportMutation.isPending;
  const backgroundImportError = backgroundImportMutation.error instanceof Error
    ? backgroundImportMutation.error.message
    : null;
  const clearBackgroundMutation = useMutation({
    mutationFn: async () => {
      if (!input.accountId || !input.activeTarget?.localAgentRef || !selectedBackgroundAssetId) {
        return null;
      }
      return removeAgentCenterBackground({
        accountId: input.accountId,
        ownerUserId: input.activeTarget.ownerUserId,
        realmAgentId: input.activeTarget.realmAgentId,
        localAgentRef: input.activeTarget.localAgentRef,
        backgroundAssetId: selectedBackgroundAssetId,
      });
    },
    onSuccess: async (result) => {
      if (!result || !input.accountId || !input.activeTarget?.localAgentRef) {
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentCenterLocalConfigQueryKey(input.accountId, input.activeTarget.localAgentRef),
        }),
        queryClient.invalidateQueries({ queryKey: ['agent-center-background-asset'] }),
      ]);
    },
  });
  const avatarHandoffReady = hasTauriInvoke();
  const avatarRuntimeAccountReady = Boolean(input.accountId);
  const avatarConversationAnchorReady = Boolean(input.activeConversationAnchorId);
  const [avatarActionPending, setAvatarActionPending] = useState(false);
  const avatarInstanceId = useMemo(() => (
    input.activeTarget
      ? buildDesktopAvatarInstanceId({
        localAgentRef: input.activeTarget.localAgentRef,
        threadId: input.activeThreadId,
      })
      : null
  ), [input.activeTarget, input.activeThreadId]);
  const avatarLiveInstancesQuery = useQuery({
    queryKey: input.activeTarget?.localAgentRef
      ? desktopAvatarInstanceRegistryQueryKey(input.activeTarget.localAgentRef)
      : ['desktop-avatar-instance-registry', 'none'],
    queryFn: async () => (
      input.activeTarget?.localAgentRef
        ? listDesktopAvatarLiveInstances({
          ownerUserId: input.activeTarget.ownerUserId,
          realmAgentId: input.activeTarget.realmAgentId,
          localAgentRef: input.activeTarget.localAgentRef,
        })
        : []
    ),
    enabled: avatarHandoffReady && Boolean(input.activeTarget?.localAgentRef),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    refetchInterval: avatarHandoffReady && input.activeTarget?.localAgentRef ? 5_000 : false,
  });
  const runningAvatarInstance = avatarInstanceId
    ? avatarLiveInstancesQuery.data?.find((instance) => instance.avatarInstanceId === avatarInstanceId) || null
    : null;
  const avatarRunning = Boolean(runningAvatarInstance);
  const avatarInstancePolicy = avatarAssetConfig?.avatar_instance_policy ?? null;
  const avatarLaunchMode = avatarAssetConfig?.launch_mode ?? null;
  const avatarLiveInstances = useMemo(
    () => (avatarLiveInstancesQuery.data || []).map((instance) => ({
      avatarInstanceId: instance.avatarInstanceId,
      localAgentRef: instance.localAgentRef,
    })),
    [avatarLiveInstancesQuery.data],
  );
  // D-LLM-105 condition 6 — typed Runtime projection authorization. The verdict
  // is derived only from the typed account projection + Tauri runtime bridge
  // readiness, never from a configuration record or prior same-agent traffic.
  // It stays `unknown` while either typed input is still resolving.
  const avatarRuntimeProjectionAuthorization
    = avatarHandoffReady && avatarRuntimeAccountReady
      ? 'authorized' as const
      : input.accountId === null
        ? 'unauthorized' as const
        : 'unknown' as const;

  /**
   * Shared D-LLM-106 arbitrated launch executor. Both the `start_with_chat`
   * gate and the explicit composer launch route through here, so the launch
   * decision branches on `avatar_instance_policy` in exactly one place. The
   * emitted payload stays the D-LLM-072 triple.
   */
  const executeArbitratedLaunch = useCallback(async (input2: {
    trigger: 'start_with_chat' | 'explicit_user_action';
    newInstanceAlreadySpawnedForThisOpenEvent: boolean;
  }): Promise<{ arbitration: AvatarLaunchArbitrationResult; launched: boolean; opened: boolean }> => {
    if (!input.activeTarget || !avatarInstanceId || !input.activeConversationAnchorId) {
      return {
        arbitration: { decision: 'fail_closed', state: 'anchor_unavailable', policy: null },
        launched: false,
        opened: false,
      };
    }
    const newInstanceId = buildDesktopAvatarEphemeralInstanceId({
      localAgentRef: input.activeTarget.localAgentRef,
      threadId: input.activeThreadId,
    });
    const arbitration = arbitrateAvatarLaunch({
      avatarInstancePolicy,
      trigger: input2.trigger,
      localAgentRef: input.activeTarget.localAgentRef,
      conversationAnchorId: input.activeConversationAnchorId,
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
      target: input.activeTarget,
      avatarInstanceId: arbitration.avatarInstanceId,
      conversationAnchorId: input.activeConversationAnchorId,
      subjectUserId: input.accountId,
    });
    const result = await launchDesktopAvatarHandoff({
      agentId: input.activeTarget.localAgentRef,
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
    input.accountId,
    input.activeConversationAnchorId,
    input.activeTarget,
    input.activeThreadId,
  ]);

  const handleComposerAvatarAction = useCallback(async () => {
    if (!input.activeTarget || !avatarInstanceId) {
      input.onOpenAgentCenter?.();
      return null;
    }
    if (!avatarHandoffReady) {
      return {
        kind: 'warning' as const,
        message: input.t('Chat.agentCenterAvatarStartRuntimeUnavailable', {
          defaultValue: 'Avatar launch requires the desktop Runtime bridge.',
        }),
      };
    }
    if (!avatarRuntimeAccountReady) {
      return {
        kind: 'warning' as const,
        message: input.t('Chat.agentCenterAvatarStartAccountRequired', {
          defaultValue: 'Sign in with the Runtime-backed desktop account before opening Avatar.',
        }),
      };
    }
    if (!avatarConversationAnchorReady || !input.activeConversationAnchorId) {
      return {
        kind: 'warning' as const,
        message: input.t('Chat.agentCenterAvatarStartAnchorRequired', {
          defaultValue: 'Open the current Runtime conversation anchor before opening Avatar.',
        }),
      };
    }
    if (!avatarRunning && !avatarAssetValid) {
      input.onOpenAgentCenter?.();
      return {
        kind: 'warning' as const,
        message: input.t(avatarConfigured
          ? 'Chat.agentCenterAvatarStartBackendEvidenceRequired'
          : 'Chat.agentCenterAvatarStartLocalAssetRequired', {
          defaultValue: avatarConfigured
            ? 'Avatar launch requires backend capability evidence from the local Avatar asset resolver.'
            : 'Avatar launch requires a selected local Avatar asset.',
        }),
      };
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
            ? input.t('Chat.agentCenterAvatarStopSuccess', { defaultValue: 'Avatar close request sent.' })
            : input.t('Chat.agentCenterAvatarStopUnconfirmed', { defaultValue: 'Close request was sent, but the OS did not confirm it.' }),
        };
      }
      // D-LLM-106 — the explicit launch entry branches on instance policy
      // through the same arbitration authority as the start_with_chat gate.
      const { arbitration, launched, opened } = await executeArbitratedLaunch({
        trigger: 'explicit_user_action',
        newInstanceAlreadySpawnedForThisOpenEvent: false,
      });
      if (arbitration.decision === 'reuse_instance') {
        return {
          kind: 'success' as const,
          message: input.t('Chat.agentCenterAvatarReuseActiveInstance', {
            defaultValue: 'An Avatar is already running for this agent and conversation.',
          }),
        };
      }
      if (arbitration.decision === 'require_user_selection') {
        return {
          kind: 'warning' as const,
          message: input.t('Chat.agentCenterAvatarRequireUserSelection', {
            defaultValue: 'Choose which Avatar instance to launch for this agent.',
          }),
        };
      }
      if (arbitration.decision === 'fail_closed') {
        return {
          kind: 'warning' as const,
          message: arbitration.state === 'anchor_unavailable'
            ? input.t('Chat.agentCenterAvatarAnchorUnavailable', {
              defaultValue: 'Avatar launch needs an available conversation anchor.',
            })
            : arbitration.state === 'instance_conflict'
              ? input.t('Chat.agentCenterAvatarInstanceConflict', {
                defaultValue: 'An existing Avatar instance conflicts with this launch; close it or change the instance policy.',
              })
              : input.t('Chat.agentCenterAvatarInstancePolicyUnresolved', {
                defaultValue: 'Avatar launch needs a resolvable instance policy.',
              }),
        };
      }
      return {
        kind: launched && opened ? 'success' as const : 'warning' as const,
        message: launched && opened
          ? input.t('Chat.agentCenterAvatarStartSuccess', { defaultValue: 'Avatar launch requested. Waiting for the avatar to come online.' })
          : input.t('Chat.agentCenterAvatarStartUnconfirmed', { defaultValue: 'Launch request was sent, but the OS did not confirm it.' }),
      };
    } finally {
      setAvatarActionPending(false);
    }
  }, [
    avatarHandoffReady,
    avatarRuntimeAccountReady,
    avatarConversationAnchorReady,
    avatarConfigured,
    avatarInstanceId,
    avatarLiveInstancesQuery,
    avatarAssetValid,
    avatarRunning,
    executeArbitratedLaunch,
    input.activeTarget,
    input.activeConversationAnchorId,
    input.accountId,
    input.onOpenAgentCenter,
    input.t,
  ]);
  // D-LLM-105 — the single `start_with_chat` auto-launch actuation site.
  // The gate evaluates on every Agent-Chat-open event for the selected
  // LocalAgent. The open event is keyed by { localAgentRef, conversationAnchorId };
  // reopening Agent Chat or switching anchor is a fresh open event and
  // re-evaluates the gate. No other surface/effect/hook emits start_with_chat.
  const [startWithChatGateResult, setStartWithChatGateResult] = useState<StartWithChatGateResult | null>(null);
  const startWithChatOpenEventKey = input.activeTarget?.localAgentRef && input.activeConversationAnchorId
    ? `${input.activeTarget.localAgentRef}::${input.activeConversationAnchorId}`
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
      localAgentRef: input.activeTarget?.localAgentRef ?? null,
      realmAgentId: input.activeTarget?.realmAgentId ?? null,
      conversationAnchorId: input.activeConversationAnchorId,
      localAvatarAssetRef: avatarAssetConfig?.local_avatar_asset_ref ?? null,
      localAvatarAssetValidationStatus: avatarAssetValidation?.status ?? null,
      backendCapabilityProfileRef: avatarAssetConfig?.backend_capability_profile_ref ?? null,
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
    avatarAssetConfig?.local_avatar_asset_ref,
    avatarAssetConfig?.backend_capability_profile_ref,
    avatarAssetValidation?.status,
    input.activeTarget,
    input.activeConversationAnchorId,
    executeArbitratedLaunch,
  ]);

  const avatarComposerActionState = resolveAvatarComposerActionState({
    avatarActionPending,
    avatarHandoffReady,
    avatarRuntimeAccountReady,
    avatarRunning,
    avatarConfigured,
    avatarAssetValid,
  });

  return useMemo(() => ({
    backdropImageUrl,
    avatarAssetValid,
    backgroundValid,
    avatarAssetChecking,
    avatarAssetConfig,
    avatarAssetValidationPresentation,
    avatarConfigMutation,
    avatarAssetLibraryQuery,
    avatarAssetSelectMutation,
    avatarAssetImportMutation,
    avatarImportDisabled,
    avatarImportError,
    clearAvatarAssetMutation,
    live2dAdapterManifestImportMutation,
    selectedBackgroundAssetId,
    backgroundAssetQuery,
    backgroundValidation,
    backgroundImportError,
    clearBackgroundMutation,
    backgroundImportDisabled,
    backgroundImportMutation,
    avatarComposerActionState,
    handleComposerAvatarAction,
    startWithChatGateResult,
  }), [
    backdropImageUrl,
    avatarAssetValid,
    backgroundValid,
    avatarAssetChecking,
    avatarAssetConfig,
    avatarAssetValidationPresentation,
    avatarConfigMutation,
    avatarAssetLibraryQuery,
    avatarAssetSelectMutation,
    avatarAssetImportMutation,
    avatarImportDisabled,
    avatarImportError,
    clearAvatarAssetMutation,
    live2dAdapterManifestImportMutation,
    selectedBackgroundAssetId,
    backgroundAssetQuery,
    backgroundValidation,
    backgroundImportError,
    clearBackgroundMutation,
    backgroundImportDisabled,
    backgroundImportMutation,
    avatarComposerActionState,
    handleComposerAvatarAction,
    startWithChatGateResult,
  ]);
}
