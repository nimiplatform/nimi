export type VrmAgentCenterPreviewReadinessInput = {
  readonly visiblePixels?: number | null;
  readonly capabilityProfileRef?: string | null;
  readonly failureReason?: string | null;
};

export type VrmAgentCenterPreviewDescriptor =
  | {
      readonly backendKind: 'vrm';
      readonly validationStatus: 'valid';
      readonly capabilityProfileRef: string;
      readonly visiblePixels: number;
    }
  | {
      readonly backendKind: 'vrm';
      readonly validationStatus: 'invalid';
      readonly capabilityProfileRef: string | null;
      readonly validationMessage: string;
    };

export function createVrmAgentCenterPreviewDescriptor(
  input: VrmAgentCenterPreviewReadinessInput,
): VrmAgentCenterPreviewDescriptor {
  if (
    input.capabilityProfileRef
    && typeof input.visiblePixels === 'number'
    && input.visiblePixels > 0
  ) {
    return {
      backendKind: 'vrm',
      validationStatus: 'valid',
      capabilityProfileRef: input.capabilityProfileRef,
      visiblePixels: input.visiblePixels,
    };
  }
  return {
    backendKind: 'vrm',
    validationStatus: 'invalid',
    capabilityProfileRef: input.capabilityProfileRef || null,
    validationMessage: input.failureReason || 'VRM avatar preview service requires a capability profile and nonblank visible pixels.',
  };
}
