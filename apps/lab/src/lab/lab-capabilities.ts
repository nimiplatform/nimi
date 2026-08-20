import type { StudioCapabilityDescriptor } from '../ai-studio-core/module-registration.js';
import type { StudioCreateCapabilityId } from '../studio-modules/studio-create/descriptors.js';
import type { StudioMediaCapabilityId } from '../studio-modules/studio-media/descriptors.js';
import type { StudioVoiceCapabilityId } from '../studio-modules/studio-voice/descriptors.js';
import type { LabWorldTourCapabilityId } from './lab-only/world-tour-descriptor.js';
import { labStudioComposition } from './lab-studio-composition.js';

export type LabCapabilityId =
  | StudioCreateCapabilityId
  | StudioMediaCapabilityId
  | StudioVoiceCapabilityId
  | LabWorldTourCapabilityId;

export type LabCapability = StudioCapabilityDescriptor<LabCapabilityId>;

export const labCapabilities: readonly LabCapability[] = Object.freeze(
  labStudioComposition.capabilities.map((capability) => capability.descriptor as LabCapability),
);

export const labModelConfigCapabilityContracts: readonly string[] = Object.freeze(
  labCapabilities
    .flatMap((capability) => (
      capability.execution === 'runtime-sdk' && capability.capabilityContract
        ? [capability.capabilityContract]
        : []
    ))
    .filter((capabilityContract, index, contracts) => contracts.indexOf(capabilityContract) === index),
);

export function getLabCapability(id: string): LabCapability {
  return labStudioComposition.getCapability(id).descriptor as LabCapability;
}
