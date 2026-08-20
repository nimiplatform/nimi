import { createContext } from 'react';
import type { LabCapabilityId } from '../lab-capabilities.js';
import type { LabCapabilityParameterState } from '../lab-capability-parameters.js';
import type { LabHistoryPanelScope } from '../lab-preferences.js';
import type { LabImageHistoryRecord } from '../lab-image-history.js';

// The lab shell is a single-level capability workspace (mirrors the Nimi
// Desktop lab): the left rail IS the capability matrix grouped by family,
// plus a UI Recipes entry for the kit component gallery. There is no separate
// App Lab / Evidence / Settings destination — App AIConfig is a right slide-over
// opened by the per-capability settings gear, and run history lives inline under
// each capability.

export type WorkbenchView =
  | { kind: 'capability'; capabilityId: LabCapabilityId }
  | { kind: 'ui-recipes' }
  | { kind: 'app-access' }
  | { kind: 'settings' };

export type WorkbenchNavGroup = {
  label: string;
  capabilityIds: LabCapabilityId[];
};

export const workbenchNavGroups: WorkbenchNavGroup[] = [
  { label: 'Create', capabilityIds: ['text.generate', 'chat.stream', 'text.embed'] },
  { label: 'Media', capabilityIds: ['image.generate', 'video.generate'] },
  { label: 'Voice', capabilityIds: ['audio.synthesize', 'audio.transcribe', 'voice.create', 'speech.bundle'] },
];

// World Tour is a standalone Tauri viewer rather than a runtime capability lane,
// so the left rail lists it under Library alongside the UI Recipes gallery.
export const workbenchLibraryCapabilityId: LabCapabilityId = 'world.generate';

// Run-history load state owned by LabWorkbench, surfaced inside the history
// panel (which sits several layers below) without threading new props through
// the studio section shell.
export type LabHistoryLoadState = {
  title: string;
  error: string | null;
  retry: () => void;
};

export const LabHistoryLoadContext = createContext<LabHistoryLoadState | null>(null);

// History mutation + panel-preference actions owned by LabWorkbench, surfaced
// inside the history panel without threading props through the studio shell.
export type LabHistoryActions = {
  removeRecord(recordId: string, deleteAsset?: boolean): Promise<void>;
  clearScope(capabilityId: string | null, deleteAssets: boolean): Promise<void>;
};

export const LabHistoryActionsContext = createContext<LabHistoryActions | null>(null);

export type LabHistoryPanelState = {
  collapsed: boolean;
  scope: LabHistoryPanelScope;
  hideFailures: boolean;
  imageRecords: readonly LabImageHistoryRecord[];
  setCollapsed(collapsed: boolean): void;
  setScope(scope: LabHistoryPanelScope): void;
  setHideFailures(hideFailures: boolean): void;
};

export const LabHistoryPanelContext = createContext<LabHistoryPanelState | null>(null);

export type LabCapabilityParameterStore = {
  state: LabCapabilityParameterState;
  setParameters: <TCapabilityId extends LabCapabilityId>(
    capabilityId: TCapabilityId,
    parameters: LabCapabilityParameterState[TCapabilityId],
  ) => void;
};

export const LabCapabilityParameterContext = createContext<LabCapabilityParameterStore | null>(null);
