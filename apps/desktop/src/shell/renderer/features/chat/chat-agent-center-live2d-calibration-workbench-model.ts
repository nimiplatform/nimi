import type { AgentCenterAvatarAssetModule } from './chat-agent-center-avatar-config-types';
import { AvatarDebugProbeKind } from './chat-agent-center-avatar-debug-workbench-model';

export type Live2dCalibrationWorkbenchItemId =
  | 'preview_artifact'
  | 'model_framing'
  | 'render_policy'
  | 'expression_inventory'
  | 'adapter_manifest';

export type Live2dCalibrationWorkbenchItemStatus =
  | 'ready'
  | 'checking'
  | 'blocked'
  | 'missing'
  | 'probe_required'
  | 'not_admitted'
  | 'effect_projection_pending';

export type Live2dCalibrationWorkbenchItem = {
  id: Live2dCalibrationWorkbenchItemId;
  status: Live2dCalibrationWorkbenchItemStatus;
  detailCode: string;
  evidenceRef: string | null;
  probeKind: AvatarDebugProbeKind | null;
};

export type Live2dCalibrationPersistenceBoundary = {
  admitted: true;
  resolverRefProjectionAdmitted: true;
  resolverEffectProjectionAdmitted: false;
  calibrationRef: string | null;
  reasonCode: 'desktop_live2d_calibration_ref_projected_effect_pending';
  forbiddenFieldIds: readonly string[];
};

export type Live2dCalibrationWorkbenchModel = {
  visible: boolean;
  assetRef: string | null;
  adapterManifestRef: string | null;
  adapterManifestSource: AgentCenterAvatarAssetModule['live2d_adapter_manifest_source'];
  calibrationRef: string | null;
  launchEvidenceReady: boolean;
  reviewItems: readonly Live2dCalibrationWorkbenchItem[];
  debugProbeShortcutKinds: readonly AvatarDebugProbeKind[];
  persistence: Live2dCalibrationPersistenceBoundary;
};

export const LIVE2D_CALIBRATION_WORKBENCH_DEBUG_PROBE_SHORTCUTS = [
  AvatarDebugProbeKind.BACKEND_LOAD,
  AvatarDebugProbeKind.CAPABILITY_PROFILE,
  AvatarDebugProbeKind.ROUTE_SUPPORT_MATRIX,
  AvatarDebugProbeKind.GENERATED_MOTION,
  AvatarDebugProbeKind.EMOTION_EXPRESSION,
  AvatarDebugProbeKind.SPEECH_LIPSYNC,
  AvatarDebugProbeKind.WINDOW_HIT_REGION,
] as const;

export const LIVE2D_CALIBRATION_FORBIDDEN_CONFIG_FIELD_IDS = [
  'live2d_calibration',
  'model_digest',
  'avatar_instance_calibration',
  'preview_artifact_ref',
  'framing_calibration',
  'render_scale',
  'target_fps',
  'performance_policy',
  'expression_inventory',
  'compatibility_tier',
  'avatar_compatibility_diagnostics',
  'live2d_adapter_manifest_payload',
  'live2d_adapter_manifest_path',
  'backend_command',
] as const;

function calibrationBlockedStatus(input: {
  assetConfigured: boolean;
  avatarAssetValid: boolean;
  avatarAssetChecking: boolean;
}): Live2dCalibrationWorkbenchItemStatus {
  if (input.avatarAssetChecking) {
    return 'checking';
  }
  if (!input.assetConfigured || !input.avatarAssetValid) {
    return 'blocked';
  }
  return 'effect_projection_pending';
}

function probeStatus(input: {
  assetConfigured: boolean;
  avatarAssetValid: boolean;
  avatarAssetChecking: boolean;
  profileLinked: boolean;
}): Live2dCalibrationWorkbenchItemStatus {
  if (input.avatarAssetChecking) {
    return 'checking';
  }
  if (!input.assetConfigured || !input.avatarAssetValid || !input.profileLinked) {
    return 'blocked';
  }
  return 'probe_required';
}

function adapterManifestStatus(
  source: AgentCenterAvatarAssetModule['live2d_adapter_manifest_source'],
  manifestRef: string | null,
): Live2dCalibrationWorkbenchItemStatus {
  if (source === 'external_sidecar_manifest') {
    return manifestRef ? 'ready' : 'blocked';
  }
  if (source === 'embedded_creator_manifest') {
    return 'ready';
  }
  return 'missing';
}

export function buildLive2dCalibrationWorkbenchModel(input: {
  config: AgentCenterAvatarAssetModule | null;
  avatarAssetValid: boolean;
  avatarAssetChecking: boolean;
}): Live2dCalibrationWorkbenchModel {
  const backendKind = input.config?.backend_kind || 'live2d';
  const visible = backendKind === 'live2d';
  const assetRef = input.config?.local_avatar_asset_ref || null;
  const adapterManifestSource = input.config?.live2d_adapter_manifest_source || 'none';
  const adapterManifestRef = input.config?.live2d_adapter_manifest_ref || null;
  const calibrationRef = input.config?.live2d_calibration_ref || null;
  const profileRef = input.config?.backend_capability_profile_ref || null;
  const assetConfigured = Boolean(assetRef);
  const profileLinked = Boolean(profileRef);
  const launchEvidenceReady = Boolean(assetConfigured && input.avatarAssetValid && profileLinked);
  const probeInput = {
    assetConfigured,
    avatarAssetValid: input.avatarAssetValid,
    avatarAssetChecking: input.avatarAssetChecking,
    profileLinked,
  };
  const calibrationInput = {
    assetConfigured,
    avatarAssetValid: input.avatarAssetValid,
    avatarAssetChecking: input.avatarAssetChecking,
  };

  return {
    visible,
    assetRef,
    adapterManifestRef,
    adapterManifestSource,
    calibrationRef,
    launchEvidenceReady,
    reviewItems: [
      {
        id: 'preview_artifact',
        status: probeStatus(probeInput),
        detailCode: launchEvidenceReady
          ? 'runtime_backend_or_window_probe_required'
          : 'local_asset_or_capability_evidence_required',
        evidenceRef: null,
        probeKind: AvatarDebugProbeKind.BACKEND_LOAD,
      },
      {
        id: 'model_framing',
        status: calibrationBlockedStatus(calibrationInput),
        detailCode: launchEvidenceReady
          ? 'calibration_effect_projection_pending'
          : 'local_asset_or_capability_evidence_required',
        evidenceRef: null,
        probeKind: AvatarDebugProbeKind.WINDOW_HIT_REGION,
      },
      {
        id: 'render_policy',
        status: calibrationBlockedStatus(calibrationInput),
        detailCode: launchEvidenceReady
          ? 'calibration_effect_projection_pending'
          : 'local_asset_or_capability_evidence_required',
        evidenceRef: null,
        probeKind: AvatarDebugProbeKind.BACKEND_LOAD,
      },
      {
        id: 'expression_inventory',
        status: probeStatus(probeInput),
        detailCode: profileLinked
          ? 'runtime_emotion_probe_required'
          : 'backend_capability_profile_ref_required',
        evidenceRef: profileRef,
        probeKind: AvatarDebugProbeKind.EMOTION_EXPRESSION,
      },
      {
        id: 'adapter_manifest',
        status: adapterManifestStatus(adapterManifestSource, adapterManifestRef),
        detailCode: adapterManifestSource === 'external_sidecar_manifest'
          ? 'external_sidecar_ref_selected'
          : adapterManifestSource === 'embedded_creator_manifest'
            ? 'embedded_creator_manifest_selected'
            : 'adapter_manifest_not_selected',
        evidenceRef: adapterManifestRef,
        probeKind: AvatarDebugProbeKind.CAPABILITY_PROFILE,
      },
    ],
    debugProbeShortcutKinds: LIVE2D_CALIBRATION_WORKBENCH_DEBUG_PROBE_SHORTCUTS,
    persistence: {
      admitted: true,
      resolverRefProjectionAdmitted: true,
      resolverEffectProjectionAdmitted: false,
      calibrationRef,
      reasonCode: 'desktop_live2d_calibration_ref_projected_effect_pending',
      forbiddenFieldIds: LIVE2D_CALIBRATION_FORBIDDEN_CONFIG_FIELD_IDS,
    },
  };
}
