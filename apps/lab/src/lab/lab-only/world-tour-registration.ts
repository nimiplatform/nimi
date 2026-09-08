import { Compass } from 'lucide-react';
import type { StudioCapabilityRegistration } from '../../ai-studio-core/module-registration.js';
import { EMPTY_STUDIO_PARAMETERS } from '../../ai-studio-core/parameters.js';
import { labWorldTourDescriptor, type LabWorldTourCapabilityId } from './world-tour-descriptor.js';
import { WorldTourActions } from '../world-tour/world-tour-actions.js';

export const labWorldTourCapability = Object.freeze({
  descriptor: labWorldTourDescriptor,
  icon: Compass,
  profile: {
    studioTag: 'World', inputTitleKey: 'Studio.profiles.worldGenerate.inputTitle', inputPlaceholderKey: 'Studio.profiles.worldGenerate.inputPlaceholder', inputKind: 'prompt', inputNoteKey: 'Studio.profiles.worldGenerate.inputNote', supportsAttachments: false, controls: [], primaryLabelKey: 'Studio.profiles.worldGenerate.primaryLabel', primaryRunningLabelKey: 'Studio.profiles.worldGenerate.primaryRunningLabel', resultTitle: 'Viewer', emptyTitleKey: 'Studio.profiles.worldGenerate.emptyTitle', emptyHintKey: 'Studio.profiles.worldGenerate.emptyHint', resultKind: 'artifacts', footnoteKey: 'Studio.profiles.worldGenerate.footnote',
  },
  preset: { id: 'conservatory', label: 'Conservatory', prompt: 'A sunlit botanical conservatory with tall glass windows, leafy plants, stone pathways, and an open central walkway. A coherent immersive interior at human eye level.' },
  runtimeMethod: 'ai.scenarioJobs.submit',
  parameters: EMPTY_STUDIO_PARAMETERS,
  parameterPanel: WorldTourActions,
} as const satisfies StudioCapabilityRegistration<LabWorldTourCapabilityId>);
