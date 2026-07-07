import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AgentCenterAppearanceAdapter,
  AgentCenterAppearanceConfigPatch,
  AgentCenterAppearanceProjection,
} from '@nimiplatform/kit/features/agent-center';
import type { ZhiyuEvidence } from '../app/evidence';
import {
  clearZhiyuAgentCenterAvatarAsset,
  clearZhiyuAgentCenterBackground,
  getZhiyuAgentCenterLocalConfig,
  hasZhiyuAgentCenterLocalConfigBridge,
  importZhiyuAgentCenterAvatarAsset,
  importZhiyuAgentCenterBackground,
  importZhiyuAgentCenterLive2dAdapterManifest,
  putZhiyuAgentCenterLocalConfig,
  type ZhiyuAgentCenterAvatarAssetKind,
  type ZhiyuAgentCenterLocalConfig,
  type ZhiyuAgentCenterLocalConfigScope,
} from './zhiyu-agent-center-local-config';

type ZhiyuAppearanceHookState = {
  readonly config: ZhiyuAgentCenterLocalConfig | null;
  readonly loading: boolean;
  readonly pendingAction: string | null;
  readonly error: string | null;
};

const INSTANCE_POLICY_VALUES = ['reuse_active_instance', 'launch_new_instance', 'require_user_selection'] as const;
const GENERATED_MOTION_POLICY_VALUES = ['require_profile_support', 'disable_generated_motion', 'debug_only'] as const;
const LAUNCH_MODE_VALUES = ['manual', 'debug_session', 'start_with_chat'] as const;
const DEBUG_PROFILE_VALUES = ['standard', 'strict_backend_evidence', 'route_matrix'] as const;

function zhiyuAgentCenterLocalConfigScope(evidence: ZhiyuEvidence): ZhiyuAgentCenterLocalConfigScope | null {
  if (
    !evidence.auth.accountId
    || !evidence.localAgent.ownerUserId
    || !evidence.localAgent.runtimeSourceRef
    || !evidence.localAgent.localAgentRef
  ) {
    return null;
  }
  return {
    accountId: evidence.auth.accountId,
    ownerUserId: evidence.localAgent.ownerUserId,
    runtimeSourceRef: evidence.localAgent.runtimeSourceRef,
    localAgentRef: evidence.localAgent.localAgentRef,
  };
}

function normalizeError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function requireAllowed<TValue extends string>(
  field: string,
  value: string,
  allowed: readonly TValue[],
): TValue {
  if ((allowed as readonly string[]).includes(value)) {
    return value as TValue;
  }
  throw new Error(`Unsupported ${field}: ${value}`);
}

function buildProjection(input: {
  readonly evidence: ZhiyuEvidence;
  readonly config: ZhiyuAgentCenterLocalConfig | null;
  readonly loading: boolean;
  readonly pendingAction: string | null;
  readonly error: string | null;
  readonly blockedReason: string | null;
}): AgentCenterAppearanceProjection {
  const avatar = input.config?.modules.avatar_asset ?? null;
  const appearance = input.config?.modules.appearance ?? null;
  const voice = input.config?.modules.voice ?? null;
  const avatarAssetRef = avatar?.local_avatar_asset_ref || null;
  const backgroundRef = appearance?.background_asset_id || null;
  const backendKind = avatar?.backend_kind || input.evidence.avatar.backendKind || 'live2d';
  const transportBlockedReason = input.blockedReason || null;
  const disabledReason = input.blockedReason || input.error || null;
  const status: AgentCenterAppearanceProjection['status'] = input.loading
    ? 'loading'
    : input.error
      ? 'invalid'
      : avatarAssetRef
        ? 'ready'
        : 'not_configured';
  const avatarAssetValid = Boolean(avatarAssetRef && !input.error);
  const backgroundValid = Boolean(backgroundRef && !input.error);
  return {
    status,
    backendKind,
    avatarAssetRef,
    avatarAssetValid,
    avatarAssetChecking: input.loading,
    validationStatus: avatarAssetRef ? 'projected' : 'selection_missing',
    validationMessage: input.error || input.evidence.avatar.message || null,
    validationIssueRows: input.error ? [input.error] : [],
    backendCapabilityProfileRef: avatar?.backend_capability_profile_ref || (input.evidence.avatar.backendKind ? 'zhiyu-avatar-backend-profile-projected' : null),
    live2dAdapterManifestSource: avatar?.live2d_adapter_manifest_source || 'none',
    live2dAdapterManifestRef: avatar?.live2d_adapter_manifest_ref || null,
    live2dCalibrationRef: avatar?.live2d_calibration_ref || null,
    backgroundRef,
    backgroundValid,
    backgroundChecking: input.loading,
    backgroundValidationStatus: backgroundRef ? 'projected' : 'selection_missing',
    backgroundValidationMessage: null,
    backgroundImportError: null,
    defaultVoiceReference: null,
    avatarAutoplay: voice?.avatar_autoplay === true,
    avatarImportDisabled: Boolean(transportBlockedReason || input.pendingAction),
    backgroundImportDisabled: Boolean(transportBlockedReason || input.pendingAction),
    voiceCleanupPending: false,
    voiceCleanupError: null,
    avatarConfigPending: input.pendingAction === 'avatar:config',
    avatarImportPending: input.pendingAction === 'avatar:live2d' || input.pendingAction === 'avatar:vrm',
    live2dAdapterImportPending: input.pendingAction === 'avatar:live2d-adapter',
    clearAvatarPending: input.pendingAction === 'avatar:clear',
    backgroundImportPending: input.pendingAction === 'background:import',
    clearBackgroundPending: input.pendingAction === 'background:clear',
    avatarImportError: input.error,
    avatarInstancePolicy: avatar?.avatar_instance_policy || 'reuse_active_instance',
    generatedMotionProviderPolicy: avatar?.generated_motion_provider_policy || 'require_profile_support',
    launchMode: avatar?.launch_mode || 'manual',
    debugProfile: avatar?.debug_profile || 'standard',
    developerModeEnabled: false,
    disabledReason: disabledReason || (avatarAssetRef ? null : 'Avatar asset is not configured.'),
  };
}

function requireScope(
  scope: ZhiyuAgentCenterLocalConfigScope | null,
  blockedReason: string | null,
): ZhiyuAgentCenterLocalConfigScope {
  if (!scope) {
    throw new Error(blockedReason || 'Zhiyu Agent Center local config scope is unavailable.');
  }
  if (!hasZhiyuAgentCenterLocalConfigBridge()) {
    throw new Error(blockedReason || 'Zhiyu Agent Center local config bridge is unavailable.');
  }
  return scope;
}

function requireConfig(config: ZhiyuAgentCenterLocalConfig | null): ZhiyuAgentCenterLocalConfig {
  if (!config) {
    throw new Error('Zhiyu Agent Center local config is not loaded.');
  }
  return config;
}

export function useZhiyuAgentCenterAppearanceAdapter(evidence: ZhiyuEvidence): {
  readonly projection: AgentCenterAppearanceProjection;
  readonly adapter: AgentCenterAppearanceAdapter;
} {
  const scope = useMemo(() => zhiyuAgentCenterLocalConfigScope(evidence), [
    evidence.auth.accountId,
    evidence.localAgent.localAgentRef,
    evidence.localAgent.ownerUserId,
    evidence.localAgent.runtimeSourceRef,
  ]);
  const bridgeAvailable = hasZhiyuAgentCenterLocalConfigBridge();
  const blockedReason = !scope
    ? 'zhiyu-agent-center-local-config-scope-required'
    : !bridgeAvailable
      ? 'zhiyu-agent-center-local-config-bridge-unavailable'
      : null;
  const [state, setState] = useState<ZhiyuAppearanceHookState>({
    config: null,
    loading: false,
    pendingAction: null,
    error: null,
  });

  const projection = useMemo(() => buildProjection({
    evidence,
    blockedReason,
    config: state.config,
    error: state.error,
    loading: state.loading,
    pendingAction: state.pendingAction,
  }), [blockedReason, evidence, state.config, state.error, state.loading, state.pendingAction]);

  const load = useCallback(async (): Promise<AgentCenterAppearanceProjection> => {
    if (!scope || !bridgeAvailable) {
      setState((current) => ({ ...current, config: null, loading: false, error: null }));
      return buildProjection({
        evidence,
        blockedReason,
        config: null,
        error: null,
        loading: false,
        pendingAction: null,
      });
    }
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const config = await getZhiyuAgentCenterLocalConfig(scope);
      setState((current) => ({ ...current, config, loading: false, error: null }));
      return buildProjection({
        evidence,
        blockedReason: null,
        config,
        error: null,
        loading: false,
        pendingAction: null,
      });
    } catch (error) {
      const message = normalizeError(error);
      setState((current) => ({ ...current, config: null, loading: false, error: message }));
      return buildProjection({
        evidence,
        blockedReason,
        config: null,
        error: message,
        loading: false,
        pendingAction: null,
      });
    }
  }, [blockedReason, bridgeAvailable, evidence, scope]);

  useEffect(() => {
    let active = true;
    if (!scope || !bridgeAvailable) {
      setState({ config: null, loading: false, pendingAction: null, error: null });
      return undefined;
    }
    setState((current) => ({ ...current, loading: true, error: null }));
    void getZhiyuAgentCenterLocalConfig(scope)
      .then((config) => {
        if (active) {
          setState((current) => ({ ...current, config, loading: false, error: null }));
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState((current) => ({ ...current, config: null, loading: false, error: normalizeError(error) }));
        }
      });
    return () => {
      active = false;
    };
  }, [bridgeAvailable, scope]);

  const refreshAfterMutation = useCallback(async (): Promise<AgentCenterAppearanceProjection> => {
    const activeScope = requireScope(scope, blockedReason);
    const config = await getZhiyuAgentCenterLocalConfig(activeScope);
    setState((current) => ({ ...current, config, error: null }));
    return buildProjection({
      evidence,
      blockedReason: null,
      config,
      error: null,
      loading: false,
      pendingAction: null,
    });
  }, [blockedReason, evidence, scope]);

  const runMutation = useCallback(async (
    action: string,
    operation: () => Promise<AgentCenterAppearanceProjection>,
  ): Promise<AgentCenterAppearanceProjection> => {
    setState((current) => ({ ...current, pendingAction: action, error: null }));
    try {
      return await operation();
    } catch (error) {
      const message = normalizeError(error);
      setState((current) => ({ ...current, error: message }));
      throw error;
    } finally {
      setState((current) => ({ ...current, pendingAction: null }));
    }
  }, []);

  const importAvatarAsset = useCallback((kind: ZhiyuAgentCenterAvatarAssetKind) => runMutation(`avatar:${kind}`, async () => {
    const activeScope = requireScope(scope, blockedReason);
    const changed = await importZhiyuAgentCenterAvatarAsset({ scope: activeScope, kind });
    if (!changed) {
      throw new Error('Avatar import was cancelled before a source was selected.');
    }
    return refreshAfterMutation();
  }), [blockedReason, refreshAfterMutation, runMutation, scope]);

  const linkLive2dAdapterManifest = useCallback(() => runMutation('avatar:live2d-adapter', async () => {
    const activeScope = requireScope(scope, blockedReason);
    const current = requireConfig(state.config);
    const localAssetId = current.modules.avatar_asset.local_avatar_asset_ref;
    if (!localAssetId) {
      throw new Error('Select a Live2D Avatar asset before importing an adapter manifest.');
    }
    const changed = await importZhiyuAgentCenterLive2dAdapterManifest({ scope: activeScope, localAssetId });
    if (!changed) {
      throw new Error('Live2D adapter import was cancelled before a source was selected.');
    }
    return refreshAfterMutation();
  }), [blockedReason, refreshAfterMutation, runMutation, scope, state.config]);

  const clearAvatarAsset = useCallback(() => runMutation('avatar:clear', async () => {
    await clearZhiyuAgentCenterAvatarAsset(requireConfig(state.config));
    return refreshAfterMutation();
  }), [refreshAfterMutation, runMutation, state.config]);

  const importBackground = useCallback(() => runMutation('background:import', async () => {
    const activeScope = requireScope(scope, blockedReason);
    const changed = await importZhiyuAgentCenterBackground(activeScope);
    if (!changed) {
      throw new Error('Background import was cancelled before a source was selected.');
    }
    return refreshAfterMutation();
  }), [blockedReason, refreshAfterMutation, runMutation, scope]);

  const clearBackground = useCallback(() => runMutation('background:clear', async () => {
    const activeScope = requireScope(scope, blockedReason);
    const current = requireConfig(state.config);
    const backgroundAssetId = current.modules.appearance.background_asset_id;
    if (!backgroundAssetId) {
      throw new Error('Select a background before clearing it.');
    }
    await clearZhiyuAgentCenterBackground(activeScope, backgroundAssetId);
    return refreshAfterMutation();
  }), [blockedReason, refreshAfterMutation, runMutation, scope, state.config]);

  const updateAvatarConfig = useCallback((patch: AgentCenterAppearanceConfigPatch) => runMutation('avatar:config', async () => {
    const current = requireConfig(state.config);
    const nextAvatar = {
      ...current.modules.avatar_asset,
      ...(patch.avatar_instance_policy ? {
        avatar_instance_policy: requireAllowed('avatar_instance_policy', patch.avatar_instance_policy, INSTANCE_POLICY_VALUES),
      } : {}),
      ...(patch.generated_motion_provider_policy ? {
        generated_motion_provider_policy: requireAllowed('generated_motion_provider_policy', patch.generated_motion_provider_policy, GENERATED_MOTION_POLICY_VALUES),
      } : {}),
      ...(patch.launch_mode ? {
        launch_mode: requireAllowed('launch_mode', patch.launch_mode, LAUNCH_MODE_VALUES),
      } : {}),
      ...(patch.debug_profile ? {
        debug_profile: requireAllowed('debug_profile', patch.debug_profile, DEBUG_PROFILE_VALUES),
      } : {}),
      updated_at: new Date().toISOString(),
      provenance: {
        source: 'user_selection' as const,
        evidence_ref: 'zhiyu-agent-center-avatar-policy-updated',
      },
    };
    const config = await putZhiyuAgentCenterLocalConfig({
      ...current,
      modules: {
        ...current.modules,
        avatar_asset: nextAvatar,
      },
    });
    setState((stateBeforeProjection) => ({ ...stateBeforeProjection, config, error: null }));
    return buildProjection({
      evidence,
      blockedReason: null,
      config,
      error: null,
      loading: false,
      pendingAction: null,
    });
  }), [evidence, runMutation, state.config]);

  const setAvatarAutoplay = useCallback((enabled: boolean) => runMutation('voice:autoplay', async () => {
    const current = requireConfig(state.config);
    const config = await putZhiyuAgentCenterLocalConfig({
      ...current,
      modules: {
        ...current.modules,
        voice: {
          ...current.modules.voice,
          avatar_autoplay: enabled,
        },
      },
    });
    setState((stateBeforeProjection) => ({ ...stateBeforeProjection, config, error: null }));
    return buildProjection({
      evidence,
      blockedReason: null,
      config,
      error: null,
      loading: false,
      pendingAction: null,
    });
  }), [evidence, runMutation, state.config]);

  const adapter = useMemo<AgentCenterAppearanceAdapter>(() => ({
    load,
    importAvatarAsset,
    linkLive2dAdapterManifest,
    clearAvatarAsset,
    importBackground,
    clearBackground,
    updateAvatarConfig,
    setAvatarAutoplay,
  }), [
    clearAvatarAsset,
    clearBackground,
    importAvatarAsset,
    importBackground,
    linkLive2dAdapterManifest,
    load,
    setAvatarAutoplay,
    updateAvatarConfig,
  ]);

  return { projection, adapter };
}
