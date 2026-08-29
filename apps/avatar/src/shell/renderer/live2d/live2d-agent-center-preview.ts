export type Live2DAgentCenterPreviewReadinessInput = {
  readonly status: 'pending' | 'ready' | 'error';
  readonly reasonCode?: string | null;
};

export type Live2DAgentCenterPreviewDescriptor =
  | {
      readonly backendKind: 'live2d';
      readonly validationStatus: 'valid';
    }
  | {
      readonly backendKind: 'live2d';
      readonly validationStatus: 'checking' | 'invalid';
      readonly validationMessage: string;
    };

export function createLive2DAgentCenterPreviewDescriptor(
  input: Live2DAgentCenterPreviewReadinessInput,
): Live2DAgentCenterPreviewDescriptor {
  if (input.status === 'ready') {
    return {
      backendKind: 'live2d',
      validationStatus: 'valid',
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
    validationMessage: input.reasonCode || 'Live2D avatar preview renderer is unavailable.',
  };
}
