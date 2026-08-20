import { composeAIStudioModules, type StudioCapabilityRegistration } from '../ai-studio-core/module-registration.js';
import type { StudioParameterState } from '../ai-studio-core/parameters.js';
import { studioCreateModule } from '../studio-modules/studio-create/registration.js';
import { studioMediaModule } from '../studio-modules/studio-media/registration.js';
import { studioVoiceModule } from '../studio-modules/studio-voice/registration.js';
import { labWorldTourCapability } from './lab-only/world-tour-registration.js';

export const labAIStudioComposition = composeAIStudioModules([
  studioCreateModule,
  studioMediaModule,
  studioVoiceModule,
]);

const allCapabilities = Object.freeze([
  ...labAIStudioComposition.capabilities,
  labWorldTourCapability,
]);

export const labStudioComposition = Object.freeze({
  modules: labAIStudioComposition.modules,
  capabilities: allCapabilities,
  getCapability(id: string): StudioCapabilityRegistration {
    const capability = allCapabilities.find((candidate) => candidate.descriptor.id === id);
    if (!capability) throw new Error(`Unknown Lab capability: ${id}`);
    return capability;
  },
  resolveCapabilityLabel(id: string): string | null {
    const capability = allCapabilities.find((candidate) => candidate.descriptor.id === id);
    return capability?.descriptor.label ?? null;
  },
  createInitialParameterState(): StudioParameterState {
    return Object.freeze(Object.fromEntries(
      allCapabilities.map((capability) => [capability.descriptor.id, capability.parameters.initial()]),
    ));
  },
});
