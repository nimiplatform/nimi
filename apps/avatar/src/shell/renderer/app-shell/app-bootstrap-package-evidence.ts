import { recordAvatarEvidenceEventually } from './avatar-evidence.js';
import type { AvatarModelManifest } from '@nimiplatform/kit/features/avatar/headless';

export function recordLocalAvatarAssetResolved(input: {
  localAgentRef: string;
  avatarInstanceId: string;
  conversationAnchorId: string;
  manifest: AvatarModelManifest;
}): void {
  const live2dCalibrationRef = input.manifest.kind === 'live2d'
    ? input.manifest.live2d.calibrationRef
    : null;
  recordAvatarEvidenceEventually({
    kind: 'avatar.visual.local-asset-resolved',
    detail: {
      agentId: input.localAgentRef,
      avatar_instance_id: input.avatarInstanceId,
      conversation_anchor_id: input.conversationAnchorId,
      local_asset_ref: input.manifest.modelId,
      backend_kind: input.manifest.kind,
      asset_authority: 'local_avatar_asset',
      resolver_authority: 'avatar_local_materialization',
      live2d_calibration_ref: live2dCalibrationRef,
      live2d_calibration_projection_status: live2dCalibrationRef
        ? 'ref_resolved_effect_not_admitted'
        : 'not_configured',
      live2d_calibration_effect_admitted: false,
    },
  });
}
