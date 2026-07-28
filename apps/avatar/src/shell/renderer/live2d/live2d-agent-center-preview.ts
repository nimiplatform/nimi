export type Live2DAgentCenterPreviewReadinessInput = {
  readonly status: 'pending' | 'ready' | 'error';
  readonly visiblePixels?: number | null;
  readonly reasonCode?: string | null;
};

export type Live2DAgentCenterPreviewDescriptor =
  | {
      readonly backendKind: 'live2d';
      readonly validationStatus: 'valid';
      readonly visiblePixels: number;
    }
  | {
      readonly backendKind: 'live2d';
      readonly validationStatus: 'checking' | 'invalid';
      readonly validationMessage: string;
    };

export function createLive2DAgentCenterPreviewDescriptor(
  input: Live2DAgentCenterPreviewReadinessInput,
): Live2DAgentCenterPreviewDescriptor {
  if (
    input.status === 'ready'
    && typeof input.visiblePixels === 'number'
    && input.visiblePixels > 0
  ) {
    return {
      backendKind: 'live2d',
      validationStatus: 'valid',
      visiblePixels: input.visiblePixels,
    };
  }
  if (input.status === 'pending') {
    return {
      backendKind: 'live2d',
      validationStatus: 'checking',
      validationMessage: 'Live2D avatar preview service is still rendering.',
    };
  }
  return {
    backendKind: 'live2d',
    validationStatus: 'invalid',
    validationMessage: input.reasonCode || 'Live2D avatar preview service requires nonblank visible pixels.',
  };
}
