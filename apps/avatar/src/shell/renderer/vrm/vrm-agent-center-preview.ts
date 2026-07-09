export type VrmAgentCenterPreviewReadinessInput = {
  readonly previewArtifactRef?: string | null;
  readonly evidenceRef?: string | null;
  readonly visiblePixels?: number | null;
  readonly sampledPixelChecksum?: number | null;
  readonly capabilityProfileRef?: string | null;
  readonly failureReason?: string | null;
};

export type VrmAgentCenterPreviewDescriptor =
  | {
      readonly backendKind: 'vrm';
      readonly validationStatus: 'valid';
      readonly previewArtifactRef: string;
      readonly evidenceRef: string;
      readonly capabilityProfileRef: string;
      readonly visiblePixels: number;
      readonly sampledPixelChecksum: number;
    }
  | {
      readonly backendKind: 'vrm';
      readonly validationStatus: 'invalid';
      readonly previewArtifactRef: null;
      readonly evidenceRef: null;
      readonly capabilityProfileRef: string | null;
      readonly validationMessage: string;
    };

export function createVrmAgentCenterPreviewDescriptor(
  input: VrmAgentCenterPreviewReadinessInput,
): VrmAgentCenterPreviewDescriptor {
  if (
    input.previewArtifactRef
    && input.evidenceRef
    && input.capabilityProfileRef
    && typeof input.visiblePixels === 'number'
    && input.visiblePixels > 0
    && typeof input.sampledPixelChecksum === 'number'
    && Number.isFinite(input.sampledPixelChecksum)
  ) {
    return {
      backendKind: 'vrm',
      validationStatus: 'valid',
      previewArtifactRef: input.previewArtifactRef,
      evidenceRef: input.evidenceRef,
      capabilityProfileRef: input.capabilityProfileRef,
      visiblePixels: input.visiblePixels,
      sampledPixelChecksum: input.sampledPixelChecksum,
    };
  }
  return {
    backendKind: 'vrm',
    validationStatus: 'invalid',
    previewArtifactRef: null,
    evidenceRef: null,
    capabilityProfileRef: input.capabilityProfileRef || null,
    validationMessage: input.failureReason || 'VRM avatar preview service requires rendered preview, capability profile evidence, and nonblank visible pixels.',
  };
}
