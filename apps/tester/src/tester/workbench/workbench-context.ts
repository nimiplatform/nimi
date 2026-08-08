import { createContext } from 'react';
import type { TesterCapabilityId } from '../tester-capabilities.js';
import type { TesterCapabilityParameterState } from '../tester-capability-parameters.js';

// The tester shell is a single-level capability workspace (mirrors the Nimi
// Desktop tester): the left rail IS the capability matrix grouped by family,
// plus a UI Recipes entry for the kit component gallery. There is no separate
// App Lab / Evidence / Settings destination — App AIConfig is a right slide-over
// opened by the per-capability settings gear, and run history lives inline under
// each capability.

export type WorkbenchView =
  | { kind: 'capability'; capabilityId: TesterCapabilityId }
  | { kind: 'ui-recipes' }
  | { kind: 'app-access' }
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

// Run-history load state owned by TesterWorkbench, surfaced inside the history
// panel (which sits several layers below) without threading new props through
// the studio section shell.
export type TesterHistoryLoadState = {
  title: string;
  error: string | null;
  retry: () => void;
};

export const TesterHistoryLoadContext = createContext<TesterHistoryLoadState | null>(null);

export type TesterCapabilityParameterStore = {
  state: TesterCapabilityParameterState;
  setParameters: <TCapabilityId extends TesterCapabilityId>(
    capabilityId: TCapabilityId,
    parameters: TesterCapabilityParameterState[TCapabilityId],
  ) => void;
};

export const TesterCapabilityParameterContext = createContext<TesterCapabilityParameterStore | null>(null);
