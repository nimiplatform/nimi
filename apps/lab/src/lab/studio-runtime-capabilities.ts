import type { StudioRuntimeCapabilityDescriptor } from '../ai-studio-core/runtime-types.js';
import { studioCreateDescriptors } from '../studio-modules/studio-create/descriptors.js';
import { studioMediaDescriptors } from '../studio-modules/studio-media/descriptors.js';
import { studioVoiceDescriptors } from '../studio-modules/studio-voice/descriptors.js';
import { labWorldTourDescriptor } from './lab-only/world-tour-descriptor.js';

export const studioRuntimeCapabilities: readonly StudioRuntimeCapabilityDescriptor[] = Object.freeze([
  ...studioCreateDescriptors,
  ...studioMediaDescriptors,
  ...studioVoiceDescriptors,
  labWorldTourDescriptor,
]);

export function getStudioRuntimeCapability(id: string): StudioRuntimeCapabilityDescriptor {
  const capability = studioRuntimeCapabilities.find((candidate) => candidate.id === id);
  if (!capability) throw new Error(`Unknown studio runtime capability: ${id}`);
  return capability;
}
