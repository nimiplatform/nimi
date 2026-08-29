import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import type { NimiRuntimeAgentPresentationProfileProjection } from '@nimiplatform/sdk/runtime';
import {
  createAppAgentCenterSession,
  type AgentCenterAppearanceProjection,
  type AgentCenterResourcePackPlacementAdapter,
  type AgentCenterSession,
} from '@nimiplatform/kit/features/agent-center';
import { createAgentCenterShellBridge, hasElectronInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types';
import type { AuthStatus } from '../../app-shell/providers/app-store';
import type { RuntimeCommittedStatusProjection } from './chat-agent-shell-visible-state';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { createDesktopAgentCenterHostMechanics } from './chat-agent-center-host-mechanics.js';

type RuntimeHostErrorReporter = (
  error: unknown,
  options?: { action?: string; extra?: Record<string, unknown> },
) => void;

type UseAgentConversationRuntimeControllerInput = {
  activeTarget: AgentLocalTargetSnapshot | null;
  authStatus: AuthStatus;
  reportHostError: RuntimeHostErrorReporter;
};

type AgentConversationRuntimeController = {
  runtimeAgentCenterAdapter: AgentCenterSession | null;
  runtimeCommittedStatus: RuntimeCommittedStatusProjection | null;
  runtimePresentationProfile: NimiRuntimeAgentPresentationProfileProjection | null;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function presentationBackend(
  value: unknown,
): NimiRuntimeAgentPresentationProfileProjection['backendKind'] {
  return value === 'vrm' || value === 'live2d' || value === 'sprite2d'
    || value === 'canvas2d' || value === 'video'
    ? value
    : null;
}

export function projectDesktopRuntimePresentationProfile(
  appearance: AgentCenterAppearanceProjection | null | undefined,
): NimiRuntimeAgentPresentationProfileProjection | null {
  if (!appearance || appearance.status === 'loading' || appearance.status === 'invalid') return null;
  return {
    backendKind: presentationBackend(appearance.backendKind),
    avatarAssetRef: normalizeText(appearance.avatarAssetRef) || null,
    expressionProfileRef: normalizeText(appearance.expressionProfileRef) || null,
    idlePreset: normalizeText(appearance.idlePreset) || null,
    interactionPolicyRef: normalizeText(appearance.interactionPolicyRef) || null,
    defaultVoiceReference: normalizeText(appearance.defaultVoiceReference) || null,
    avatarAutoplay: appearance.avatarAutoplay === true,
    backgroundAssetRef: normalizeText(appearance.backgroundRef) || null,
  };
}

export function useAgentConversationRuntimeController(
  input: UseAgentConversationRuntimeControllerInput,
): AgentConversationRuntimeController {
  const { activeTarget, authStatus, reportHostError } = input;
  const bindings = useDesktopRendererBindings();
  const runtimeAgentCenterAdapter = useMemo(() => {
    const agentHandle = normalizeText(activeTarget?.agentHandle);
    if (authStatus !== 'authenticated' || !activeTarget || !agentHandle) return null;
    const shellBridge = hasElectronInvoke() ? createAgentCenterShellBridge() : null;
    const resourcePackPlacement = activeTarget.conversationAnchorId && shellBridge
      ? {
          availability: {
            state: 'available',
            reasonCode: null,
            actionHint: null,
          },
          open: () => shellBridge.openResourcePackInZhiyu(activeTarget.conversationAnchorId!),
        } as const satisfies AgentCenterResourcePackPlacementAdapter
      : {
          availability: {
            state: 'unavailable',
            reasonCode: 'selection-required',
            actionHint: 'open_current_conversation',
          },
          open: async () => ({
            status: 'unavailable',
            reasonCode: 'operation-unavailable',
            actionHint: 'retry_zhiyu_resource_pack_placement',
          }),
        } as const satisfies AgentCenterResourcePackPlacementAdapter;
    return createAppAgentCenterSession({
      handle: agentHandle as NimiLocalAppAgentHandle,
      client: bindings.sdk.appProduct().agentConfigure,
      ...(activeTarget.conversationAnchorId
        ? { conversationAnchorId: activeTarget.conversationAnchorId }
        : {}),
      hostMechanics: shellBridge
        ? createDesktopAgentCenterHostMechanics({
          conversationAnchorId: activeTarget.conversationAnchorId,
          shell: shellBridge,
          avatarHandoff: bindings.app.commands.avatarHandoff,
        })
        : null,
      resourcePackPlacement,
    });
  }, [activeTarget, authStatus, bindings]);

  useEffect(() => () => {
    runtimeAgentCenterAdapter?.dispose();
  }, [runtimeAgentCenterAdapter]);

  useEffect(() => {
    if (!runtimeAgentCenterAdapter) return;
    void runtimeAgentCenterAdapter.refresh().catch((error) => reportHostError(error, {
      action: 'load-canonical-agent-manager',
    }));
  }, [reportHostError, runtimeAgentCenterAdapter]);

  const subscribe = useCallback((listener: () => void) => (
    runtimeAgentCenterAdapter?.subscribe(listener) ?? (() => undefined)
  ), [runtimeAgentCenterAdapter]);
  const getSnapshot = useCallback(
    () => runtimeAgentCenterAdapter?.getSnapshot() ?? null,
    [runtimeAgentCenterAdapter],
  );
  const managerSnapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const runtimeCommittedStatus = useMemo<RuntimeCommittedStatusProjection | null>(() => {
    if (!managerSnapshot || managerSnapshot.phase === 'loading') return null;
    const cognition = managerSnapshot.state.cognition;
    return {
      lifecycleStatus: cognition.lifecycleStatus,
      executionState: cognition.executionState,
      statusText: cognition.statusText,
    };
  }, [managerSnapshot]);

  const runtimePresentationProfile = useMemo<NimiRuntimeAgentPresentationProfileProjection | null>(() => {
    return projectDesktopRuntimePresentationProfile(managerSnapshot?.state.appearance);
  }, [managerSnapshot]);

  return {
    runtimeAgentCenterAdapter,
    runtimeCommittedStatus,
    runtimePresentationProfile,
  };
}
