import type {
  WorldStudioLayoutSlice,
  WorldStudioMainSlice,
  WorldStudioStatusSlice,
  WorldStudioWorkflowSlice,
} from '@world-engine/controllers/world-studio-screen-model.js';
import type { WorldMaintenanceTimelineItem } from '@renderer/hooks/use-world-queries.js';
import { getTimeFlowRatioFromWorldviewPatch, type MaintainTab } from './world-maintain-page-helpers.js';

type WorldMaintainSnapshot = {
  panel: {
    selectedWorldId?: string;
  };
  eventsDraft: {
    primary: unknown[];
    secondary: unknown[];
  };
};

type WorldMaintainWorkspaceSnapshot = {
  agentSync: {
    selectedCharacterIds: string[];
    draftsByCharacter: Record<string, unknown>;
  };
  eventsDraft: {
    primary: unknown[];
    secondary: unknown[];
  };
  taskState: {
    activeTask: unknown;
    recentTasks: unknown[];
    expertMode: boolean;
  };
  unsavedChangesByPanel: Record<string, boolean>;
  workspaceVersion: string | null;
  worldviewPatch: Record<string, unknown>;
};

export function buildWorldMaintainWorkbenchState(input: {
  activeTab: MaintainTab;
  dirtyLabels: string[];
  effectiveWorldId: string;
  error: string | null;
  mutationsList: WorldMaintenanceTimelineItem[];
  notice: string | null;
  snapshot: WorldMaintainSnapshot;
  working: boolean;
  workspaceSnapshot: WorldMaintainWorkspaceSnapshot;
}): {
  layout: WorldStudioLayoutSlice;
  main: WorldStudioMainSlice;
  status: WorldStudioStatusSlice;
  workflow: WorldStudioWorkflowSlice;
} {
  const layout: WorldStudioLayoutSlice = {
    title: 'Forge World Maintenance',
    subtitle: 'Maintain the selected world',
    currentObjectLabel: input.effectiveWorldId || 'World',
    dirtySummary: {
      hasDirty: input.dirtyLabels.length > 0,
      count: input.dirtyLabels.length,
      labels: input.dirtyLabels,
      shortLabel: input.dirtyLabels.length > 0 ? `${input.dirtyLabels.length} dirty` : 'Saved',
    },
    settingsDrawerOpen: false,
    setSettingsDrawerOpen: () => undefined,
    toggleSettingsDrawer: () => undefined,
  };

  const workflow: WorldStudioWorkflowSlice = {
    landing: { target: 'MAINTAIN', worldId: input.effectiveWorldId || null, reason: null },
    landingTarget: 'MAINTAIN',
    worlds: [],
    drafts: [],
    primaryWorld: null,
    latestDraft: null,
    selectedWorldId: input.effectiveWorldId,
    selectedDraftId: '',
    createDisplayStage: 'IMPORT',
    createStageAccess: {
      IMPORT: { enabled: true, reason: null },
      CURATE: { enabled: true, reason: null },
      GENERATE: { enabled: true, reason: null },
      REVIEW: { enabled: true, reason: null },
    },
    activeDomain: 'WORLD',
    activeSection: input.activeTab === 'WORLD'
      ? 'BASE'
      : input.activeTab === 'EVENTS'
        ? 'WORLD_EVENTS'
        : input.activeTab,
    selectedAgentId: '',
  };

  const main: WorldStudioMainSlice = {
    snapshot: input.snapshot as WorldStudioMainSlice['snapshot'],
    phase1: null,
    phase2: null,
    sourceMode: 'TEXT',
    sourceEncoding: 'utf-8',
    filePreviewText: '',
    retryWithFineRoute: false,
    retryScope: 'all',
    retryConcurrency: 1,
    retryErrorCode: null,
    routeOptions: null,
    eventSyncMode: 'merge',
    selectedAgentSyncCharacters: input.workspaceSnapshot.agentSync.selectedCharacterIds,
    truthDerivedAgentDraftsByCharacter: input.workspaceSnapshot.agentSync.draftsByCharacter as WorldStudioMainSlice['truthDerivedAgentDraftsByCharacter'],
    eventsGraph: input.workspaceSnapshot.eventsDraft as WorldStudioMainSlice['eventsGraph'],
    timeFlowRatio: getTimeFlowRatioFromWorldviewPatch(input.workspaceSnapshot.worldviewPatch),
    importSubview: 'PREPARE',
    reviewSubview: 'EDIT',
    working: input.working,
    creatorAgents: [],
    selectedCreatorAgent: null,
    resourceBindings: [],
  };

  const status: WorldStudioStatusSlice = {
    landingLoading: false,
    activeTask: input.workspaceSnapshot.taskState.activeTask as WorldStudioStatusSlice['activeTask'],
    recentTasks: input.workspaceSnapshot.taskState.recentTasks as WorldStudioStatusSlice['recentTasks'],
    expertMode: input.workspaceSnapshot.taskState.expertMode,
    localWorkspaceSavedAt: null,
    notice: input.notice,
    error: input.error,
    conflictReloadSummary: null,
    hasMaintenanceConflict: false,
    maintenanceEditorSnapshotVersion: input.workspaceSnapshot.workspaceVersion || '',
    mutations: input.mutationsList,
    storyProjectionCount: 0,
    storyProjectionMissingContextCount: 0,
    storyProjectionLatestAt: '',
    primaryEventCount: input.workspaceSnapshot.eventsDraft.primary.length,
    secondaryEventCount: input.workspaceSnapshot.eventsDraft.secondary.length,
    missingPrimaryEvidenceCount: 0,
    eventCharacterCoverage: 0,
    eventLocationCoverage: 0,
    terminalChunkSuccess: 0,
    terminalChunkTotal: 0,
    terminalChunkFailed: 0,
    terminalTopFailure: null,
  };

  return {
    layout,
    workflow,
    main,
    status,
  };
}
