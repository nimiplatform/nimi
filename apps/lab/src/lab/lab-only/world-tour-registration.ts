import { Compass } from 'lucide-react';
import type { StudioCapabilityRegistration } from '../../ai-studio-core/module-registration.js';
import { EMPTY_STUDIO_PARAMETERS } from '../../ai-studio-core/parameters.js';
import { labWorldTourDescriptor, type LabWorldTourCapabilityId } from './world-tour-descriptor.js';

export const labWorldTourCapability = Object.freeze({
  descriptor: labWorldTourDescriptor,
  icon: Compass,
  profile: {
    studioTag: 'World', inputTitleKey: 'Studio.profiles.worldGenerate.inputTitle', inputPlaceholderKey: 'Studio.profiles.worldGenerate.inputPlaceholder', inputKind: 'none', inputNoteKey: 'Studio.profiles.worldGenerate.inputNote', supportsAttachments: false, controls: [], primaryLabelKey: 'Studio.profiles.worldGenerate.primaryLabel', primaryRunningLabelKey: 'Studio.profiles.worldGenerate.primaryRunningLabel', resultTitle: 'Viewer', emptyTitleKey: 'Studio.profiles.worldGenerate.emptyTitle', emptyHintKey: 'Studio.profiles.worldGenerate.emptyHint', resultKind: 'text', footnoteKey: 'Studio.profiles.worldGenerate.footnote', statusLabelKey: 'StudioShell.statusTauriOnly', pendingLabelKey: 'Studio.result.pendingViewer',
  },
  preset: { id: 'fixture-viewer', label: 'Viewer fixture', prompt: 'Resolve the world-tour fixture and open the standalone viewer.' },
  runtimeMethod: 'tauri.open_world_tour_window',
  parameters: EMPTY_STUDIO_PARAMETERS,
} as const satisfies StudioCapabilityRegistration<LabWorldTourCapabilityId>);
