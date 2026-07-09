export type Live2DAgentCenterPreviewReadinessInput = {
  readonly status: 'pending' | 'ready' | 'error';
  readonly previewArtifactRef?: string | null;
  readonly evidenceRef?: string | null;
  readonly visiblePixels?: number | null;
  readonly sampledPixelChecksum?: number | null;
  readonly reasonCode?: string | null;
};

export type Live2DAgentCenterPreviewDescriptor =
  | {
      readonly backendKind: 'live2d';
      readonly validationStatus: 'valid';
      readonly previewArtifactRef: string;
      readonly evidenceRef: string;
      readonly visiblePixels: number;
      readonly sampledPixelChecksum: number;
    }
  | {
      readonly backendKind: 'live2d';
      readonly validationStatus: 'checking' | 'invalid';
      readonly previewArtifactRef: null;
      readonly evidenceRef: null;
      readonly validationMessage: string;
    };

export function createLive2DAgentCenterPreviewDescriptor(
  input: Live2DAgentCenterPreviewReadinessInput,
): Live2DAgentCenterPreviewDescriptor {
  if (
    input.status === 'ready'
    && input.previewArtifactRef
    && input.evidenceRef
    && typeof input.visiblePixels === 'number'
    && input.visiblePixels > 0
    && typeof input.sampledPixelChecksum === 'number'
    && Number.isFinite(input.sampledPixelChecksum)
  ) {
    return {
      backendKind: 'live2d',
      validationStatus: 'valid',
      previewArtifactRef: input.previewArtifactRef,
      evidenceRef: input.evidenceRef,
      visiblePixels: input.visiblePixels,
      sampledPixelChecksum: input.sampledPixelChecksum,
    };
  }
  if (input.status === 'pending') {
    return {
      backendKind: 'live2d',
      validationStatus: 'checking',
      previewArtifactRef: null,
      evidenceRef: null,
      validationMessage: 'Live2D avatar preview service is still rendering a visual proof.',
    };
  }
  return {
    backendKind: 'live2d',
    validationStatus: 'invalid',
    previewArtifactRef: null,
    evidenceRef: null,
    validationMessage: input.reasonCode || 'Live2D avatar preview service requires a nonblank visible-pixel proof.',
  };
}
