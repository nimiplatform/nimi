import {
  createLive2DAgentCenterPreviewDescriptor,
  type Live2DAgentCenterPreviewReadinessInput,
} from '../live2d/live2d-agent-center-preview.js';
import {
  createVrmAgentCenterPreviewDescriptor,
  type VrmAgentCenterPreviewReadinessInput,
} from '../vrm/vrm-agent-center-preview.js';

export type AgentCenterAvatarPreviewServiceResolveInput =
  | {
      readonly avatarAssetRef: string;
      readonly backendKind: 'live2d';
      readonly live2d: Live2DAgentCenterPreviewReadinessInput;
    }
  | {
      readonly avatarAssetRef: string;
      readonly backendKind: 'vrm';
      readonly vrm: VrmAgentCenterPreviewReadinessInput;
    };

export type AgentCenterAvatarPreviewServiceResolveResult = {
  readonly avatarAssetRef: string;
  readonly backendKind: 'live2d' | 'vrm';
  readonly previewArtifactRef: string | null;
  readonly validationStatus: 'valid' | 'invalid' | 'checking';
  readonly validationMessage?: string | null;
  readonly visiblePixels?: number | null;
  readonly sampledPixelChecksum?: number | null;
  readonly warnings: readonly string[];
};

export function resolveAgentCenterAvatarPreviewService(
  input: AgentCenterAvatarPreviewServiceResolveInput,
): AgentCenterAvatarPreviewServiceResolveResult {
  const avatarAssetRef = input.avatarAssetRef.trim();
  if (!avatarAssetRef) {
    throw new Error('Agent Center avatar preview service requires avatarAssetRef.');
  }
  if (input.backendKind === 'live2d') {
    const descriptor = createLive2DAgentCenterPreviewDescriptor(input.live2d);
    return {
      avatarAssetRef,
      backendKind: 'live2d',
      previewArtifactRef: descriptor.previewArtifactRef,
      validationStatus: descriptor.validationStatus,
      validationMessage: 'validationMessage' in descriptor ? descriptor.validationMessage : null,
      visiblePixels: 'visiblePixels' in descriptor ? descriptor.visiblePixels : null,
      sampledPixelChecksum: 'sampledPixelChecksum' in descriptor ? descriptor.sampledPixelChecksum : null,
      warnings: ['avatar_preview_service:live2d'],
    };
  }
  const descriptor = createVrmAgentCenterPreviewDescriptor(input.vrm);
  return {
    avatarAssetRef,
    backendKind: 'vrm',
    previewArtifactRef: descriptor.previewArtifactRef,
    validationStatus: descriptor.validationStatus,
    validationMessage: 'validationMessage' in descriptor ? descriptor.validationMessage : null,
    visiblePixels: 'visiblePixels' in descriptor ? descriptor.visiblePixels : null,
    sampledPixelChecksum: 'sampledPixelChecksum' in descriptor ? descriptor.sampledPixelChecksum : null,
    warnings: ['avatar_preview_service:vrm'],
  };
}
