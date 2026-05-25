import { recordAvatarEvidenceEventually } from './avatar-evidence.js';

type LocalAvatarAssetManifest = {
  kind: 'live2d' | 'vrm';
  modelId: string;
};

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
