export type VrmAgentCenterPreviewReadinessInput = {
  readonly capabilityProfileRef?: string | null;
  readonly failureReason?: string | null;
};

export type VrmAgentCenterPreviewDescriptor =
  | {
      readonly backendKind: 'vrm';
      readonly validationStatus: 'valid';
      readonly capabilityProfileRef: string;
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
  if (input.capabilityProfileRef) {
    return {
      backendKind: 'vrm',
      validationStatus: 'valid',
      capabilityProfileRef: input.capabilityProfileRef,
    };
  }
  return {
    backendKind: 'vrm',
    validationStatus: 'invalid',
    capabilityProfileRef: input.capabilityProfileRef || null,
    validationMessage: input.failureReason || 'VRM avatar preview service requires a current capability profile.',
  };
}
