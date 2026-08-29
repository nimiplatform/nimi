import type { LabCapabilityId } from '../lab-capabilities.js';
import { labAIStudioComposition } from '../lab-studio-composition.js';

export type WorkbenchView =
  | { kind: 'capability'; capabilityId: LabCapabilityId }
  | { kind: 'ui-recipes' }
  | { kind: 'app-access' }
  | { kind: 'agent-center' }
  | { kind: 'agent-conversation' }
  | { kind: 'agent-realtime' }
  | { kind: 'settings' };

export type WorkbenchNavGroup = {
  label: string;
  capabilityIds: LabCapabilityId[];
};

export const workbenchNavGroups: readonly WorkbenchNavGroup[] = Object.freeze(
  labAIStudioComposition.modules.map((module) => ({
    label: module.navigationLabel,
    capabilityIds: module.capabilities.map((capability) => capability.descriptor.id as LabCapabilityId),
  })),
);

// World Tour stays a Lab-only native viewer registration.
export const workbenchLibraryCapabilityId: LabCapabilityId = 'world.generate';
