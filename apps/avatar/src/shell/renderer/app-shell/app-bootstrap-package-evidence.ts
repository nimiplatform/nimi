import { recordAvatarEvidenceEventually } from './avatar-evidence.js';

type RuntimeAuthorizedAvatarPackageHandoff = {
  avatarPackageRef: string;
  backendKind: 'live2d' | 'vrm';
  backendCapabilityProfileRef: string;
  materializationRef: string;
};

type LocalAvatarAssetManifest = {
  kind: 'live2d' | 'vrm';
  modelId: string;
};

export function recordRuntimeAuthorizedAvatarPackageResolved(input: {
  localAgentRef: string;
  avatarInstanceId: string;
  conversationAnchorId: string;
  handoff: RuntimeAuthorizedAvatarPackageHandoff;
}): void {
  recordAvatarEvidenceEventually({
    kind: 'avatar.visual.package-resolved',
    detail: {
      agentId: input.localAgentRef,
      avatar_instance_id: input.avatarInstanceId,
      conversation_anchor_id: input.conversationAnchorId,
      avatar_package_ref: input.handoff.avatarPackageRef,
      backend_kind: input.handoff.backendKind,
      backend_capability_profile_ref: input.handoff.backendCapabilityProfileRef,
      materialization_ref: input.handoff.materializationRef,
      package_authority: 'runtime_avatar_package_projection',
      resolver_authority: 'local_materialization_only',
    },
  });
}

export function recordLocalAvatarAssetResolved(input: {
  localAgentRef: string;
  avatarInstanceId: string;
  conversationAnchorId: string;
  manifest: LocalAvatarAssetManifest;
}): void {
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
    },
  });
}
