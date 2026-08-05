import type { TesterCapabilityId } from '../tester-capabilities.js';

// The tester shell is a single-level capability workspace (mirrors the Nimi
// Desktop tester): the left rail IS the capability matrix grouped by family,
// plus a UI Recipes entry for the kit component gallery. There is no separate
// App Lab / Evidence / Settings destination — App AIConfig is a right slide-over
// opened by the per-capability settings gear, and run history lives inline under
// each capability.

export type WorkbenchView =
  | { kind: 'capability'; capabilityId: TesterCapabilityId }
  | { kind: 'ui-recipes' }
  | { kind: 'permission-lab' }
  | { kind: 'settings' };

export type WorkbenchNavGroup = {
  label: string;
  capabilityIds: TesterCapabilityId[];
};

export const workbenchNavGroups: WorkbenchNavGroup[] = [
  { label: 'Create', capabilityIds: ['text.generate', 'chat.stream', 'text.embed'] },
  { label: 'Media', capabilityIds: ['image.generate', 'video.generate'] },
  { label: 'Voice', capabilityIds: ['audio.synthesize', 'audio.transcribe', 'speech.bundle'] },
];

// World Tour is a standalone Tauri viewer rather than a runtime capability lane,
// so the left rail lists it under Library alongside the UI Recipes gallery.
export const workbenchLibraryCapabilityId: TesterCapabilityId = 'world.generate';
