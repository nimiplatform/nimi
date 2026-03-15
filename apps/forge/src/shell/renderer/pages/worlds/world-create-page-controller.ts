import { useCallback, useRef, useState } from 'react';
import type {
  WorldStudioActionsSlice,
  WorldStudioMainSlice,
  WorldStudioRoutingSlice,
  WorldStudioStatusSlice,
  WorldStudioWorkflowSlice,
} from '@world-engine/controllers/world-studio-screen-model.js';
import type {
  EventNodeDraft,
  WorldLorebookDraftRow,
  WorldStudioAgentDraft,
  WorldStudioCreateStep,
} from '@world-engine/contracts.js';
import { useWorldMutations } from '@renderer/hooks/use-world-mutations.js';
import { useCreatorWorldStore } from '@renderer/state/creator-world-store.js';
import {
  getTimeFlowRatioFromWorldviewPatch,
  setTimeFlowRatioOnWorldviewPatch,
  toCreateDisplayStage,
  toImportSubview,
  toReviewSubview,
} from './world-create-page-helpers';
import { useWorldCreatePageDraftPersistence } from './world-create-page-draft-persistence';
import { useWorldCreatePageGeneration } from './world-create-page-generation';
import { useWorldCreatePageSource } from './world-create-page-source';

type UseWorldCreatePageModelInput = {
  mutations: ReturnType<typeof useWorldMutations>;
  navigate: (to: string) => void;
  resumeDraftId: string;
  userId: string;
};

export function useWorldCreatePageModel({
  mutations,
  navigate,
  resumeDraftId,
  userId,
}: UseWorldCreatePageModelInput): {
  actions: WorldStudioActionsSlice;
  clearNotice: () => void;
  main: WorldStudioMainSlice;
  routing: WorldStudioRoutingSlice;
  status: WorldStudioStatusSlice;
  workflow: WorldStudioWorkflowSlice;
} {
  const snapshot = useCreatorWorldStore((state) => state.snapshot);
  const patchSnapshot = useCreatorWorldStore((state) => state.patchSnapshot);
  const setCreateStep = useCreatorWorldStore((state) => state.setCreateStep);
  const hydrateForUser = useCreatorWorldStore((state) => state.hydrateForUser);
  const persistForUser = useCreatorWorldStore((state) => state.persistForUser);

  const [notice, setNotice] = useState<string | null>(null);
  const [activeDraftId, setActiveDraftId] = useState(resumeDraftId);
  const [retryWithFineRoute, setRetryWithFineRoute] = useState(false);
  const [retryScope, setRetryScope] = useState<'all' | 'json' | 'coarse' | 'fine'>('all');
  const [retryConcurrency, setRetryConcurrency] = useState(3);
  const [retryErrorCode, setRetryErrorCode] = useState<string | null>(null);
  const sourceChunksRef = useRef<string[]>([]);

  const {
    filePreviewText,
    onSelectSourceFile,
    onSourceEncodingChange,
    sourceEncoding,
    sourceMode,
    sourceRawTextRef,
  } = useWorldCreatePageSource({ patchSnapshot });

  useWorldCreatePageDraftPersistence({
    hydrateForUser,
    patchSnapshot,
    persistForUser,
    resumeDraftId,
    setCreateStep,
    setNotice,
    snapshot,
    userId,
  });

  const onStepChange = useCallback((step: WorldStudioCreateStep) => setCreateStep(step), [setCreateStep]);
  const onSourceTextChange = useCallback((value: string) => patchSnapshot({ sourceText: value }), [patchSnapshot]);
  const onSourceRefChange = useCallback((value: string) => patchSnapshot({ sourceRef: value }), [patchSnapshot]);
  const onSelectStartTimeId = useCallback((value: string) => patchSnapshot({ selectedStartTimeId: value }), [patchSnapshot]);
  const onToggleCharacter = useCallback((name: string, checked: boolean) => {
    const next = checked
      ? [...snapshot.selectedCharacters, name]
      : snapshot.selectedCharacters.filter((item) => item !== name);
    patchSnapshot({ selectedCharacters: next });
  }, [patchSnapshot, snapshot.selectedCharacters]);
  const onToggleAgentSyncCharacter = useCallback((name: string, checked: boolean) => {
    const next = checked
      ? [...snapshot.agentSync.selectedCharacterIds, name]
      : snapshot.agentSync.selectedCharacterIds.filter((item) => item !== name);
    patchSnapshot({ agentSync: { ...snapshot.agentSync, selectedCharacterIds: next } });
  }, [patchSnapshot, snapshot.agentSync]);
  const onTimeFlowRatioChange = useCallback((value: string) => {
    patchSnapshot({ worldviewPatch: setTimeFlowRatioOnWorldviewPatch(snapshot.worldviewPatch, value) });
  }, [patchSnapshot, snapshot.worldviewPatch]);
  const onFutureEventsTextChange = useCallback((value: string) => patchSnapshot({ futureEventsText: value }), [patchSnapshot]);
  const onWorldPatchChange = useCallback((value: Record<string, unknown>) => patchSnapshot({ worldPatch: value }), [patchSnapshot]);
  const onWorldviewPatchChange = useCallback((value: Record<string, unknown>) => patchSnapshot({ worldviewPatch: value }), [patchSnapshot]);
  const onAgentDraftChange = useCallback((name: string, patch: Partial<WorldStudioAgentDraft>) => {
    patchSnapshot({
      agentSync: {
        ...snapshot.agentSync,
        draftsByCharacter: {
          ...snapshot.agentSync.draftsByCharacter,
          [name]: {
            ...(snapshot.agentSync.draftsByCharacter[name] || {
              characterName: name,
              handle: '',
              concept: '',
              backstory: '',
              coreValues: '',
              relationshipStyle: '',
            }),
            ...patch,
          },
        },
      },
    });
  }, [patchSnapshot, snapshot.agentSync]);
  const onEventsGraphChange = useCallback((next: { primary: EventNodeDraft[]; secondary: EventNodeDraft[] }) => {
    patchSnapshot({ eventsDraft: next });
  }, [patchSnapshot]);
  const onEventGraphLayoutChange = useCallback((next: { selectedEventId: string; expandedPrimaryIds: string[] }) => {
    patchSnapshot({ eventGraphLayout: next });
  }, [patchSnapshot]);
  const onLorebooksChange = useCallback((value: WorldLorebookDraftRow[]) => {
    patchSnapshot({ lorebooksDraft: value });
  }, [patchSnapshot]);

  const {
    onGenerateCharacterPortrait,
    onGenerateWorldCover,
    onRefreshQualityGate,
    onRunFailedChunks,
    onRunFailedChunksByErrorCode,
    onRunPhase1,
    onRunPhase2,
    persistDraft,
    phase1,
    phase2,
    publishDraft,
  } = useWorldCreatePageGeneration({
    activeDraftId,
    mutations,
    patchSnapshot,
    retryConcurrency,
    retryScope,
    setActiveDraftId,
    setCreateStep,
    setNotice,
    setRetryErrorCode,
    snapshot,
    sourceChunksRef,
    sourceMode,
    sourceRawTextRef,
  });

  const activeTask = snapshot.taskState.activeTask;
  const working = activeTask ? ['RUNNING', 'PAUSE_REQUESTED'].includes(activeTask.status) : false;
  const selectedAgentSyncCharacters = snapshot.agentSync.selectedCharacterIds.length > 0
    ? snapshot.agentSync.selectedCharacterIds
    : snapshot.selectedCharacters;
  const timeFlowRatio = getTimeFlowRatioFromWorldviewPatch(snapshot.worldviewPatch);

  const workflow: WorldStudioWorkflowSlice = {
    landing: { target: 'CREATE', worldId: null, reason: null },
    landingTarget: 'CREATE',
    worlds: [],
    drafts: [],
    primaryWorld: null,
    latestDraft: null,
    selectedWorldId: '',
    selectedDraftId: activeDraftId,
    createDisplayStage: toCreateDisplayStage(snapshot.createStep),
    createStageAccess: {
      IMPORT: { enabled: true, reason: null },
      CURATE: { enabled: true, reason: null },
      GENERATE: { enabled: true, reason: null },
      REVIEW: { enabled: true, reason: null },
    },
    activeDomain: 'WORLD',
    activeSection: 'BASE',
    selectedAgentId: '',
  };

  const main: WorldStudioMainSlice = {
    snapshot,
    phase1,
    phase2,
    sourceMode,
    sourceEncoding,
    filePreviewText,
    retryWithFineRoute,
    retryScope,
    retryConcurrency,
    retryErrorCode,
    routeOptions: null,
    eventSyncMode: 'merge',
    selectedAgentSyncCharacters,
    eventsGraph: snapshot.eventsDraft,
    timeFlowRatio,
    importSubview: toImportSubview(snapshot.createStep),
    reviewSubview: toReviewSubview(snapshot.createStep),
    working,
    creatorAgents: [],
    selectedCreatorAgent: null,
    mediaBindings: [],
  };

  const routing: WorldStudioRoutingSlice = {
    activeCoarseRouteSource: 'local',
    activeCoarseRouteConnectorId: '',
    activeFineRouteSource: 'local',
    activeFineRouteConnectorId: '',
    effectiveCoarseRouteBinding: null,
    effectiveFineRouteBinding: null,
    coarseRouteModelOptions: [],
    fineRouteModelOptions: [],
    routeConnectors: [],
    routeConfigReady: true,
    routeConfigReasonCode: '',
    routeConfigActionHint: 'none',
    coarseRouteReadiness: { ready: true, reasonCode: '', actionHint: 'none', message: '' },
    fineRouteReadiness: { ready: true, reasonCode: '', actionHint: 'none', message: '' },
    embeddingReadiness: { healthy: true, reasonCode: '', actionHint: 'none', message: '' },
    embeddingIndexStatus: 'idle',
    embeddingEntryCount: 0,
    embeddingIndexLastBuiltAt: null,
    embeddingIndexErrorMessage: null,
    effectiveCoarseRouteSummary: '',
    effectiveFineRouteSummary: '',
  };

  const status: WorldStudioStatusSlice = {
    landingLoading: false,
    activeTask: snapshot.taskState.activeTask,
    recentTasks: snapshot.taskState.recentTasks,
    expertMode: snapshot.taskState.expertMode,
    notice,
    error: null,
    conflictReloadSummary: null,
    hasMaintenanceConflict: false,
    maintenanceEditorSnapshotVersion: snapshot.editorSnapshotVersion,
    mutations: [],
    storyProjectionCount: Array.isArray(phase2?.worldEvents) ? phase2.worldEvents.length : 0,
    storyProjectionMissingContextCount: 0,
    storyProjectionLatestAt: '',
    primaryEventCount: snapshot.eventsDraft.primary.length,
    secondaryEventCount: snapshot.eventsDraft.secondary.length,
    missingPrimaryEvidenceCount: 0,
    eventCharacterCoverage: snapshot.selectedCharacters.length,
    eventLocationCoverage: 0,
    terminalChunkSuccess: snapshot.parseJob.chunkCompleted,
    terminalChunkTotal: snapshot.parseJob.chunkTotal,
    terminalChunkFailed: snapshot.parseJob.chunkFailed,
    terminalTopFailure: null,
  };

  const actions: WorldStudioActionsSlice = {
    workflow: {
      loadLanding: async () => undefined,
      openMaintenance: () => undefined,
      openCreate: (draftId) => {
        setActiveDraftId(draftId || '');
      },
      selectCreateDisplayStage: (stage) => {
        if (stage === 'IMPORT') {
          onStepChange('SOURCE');
          return;
        }
        if (stage === 'CURATE') {
          onStepChange('CHECKPOINTS');
          return;
        }
        if (stage === 'GENERATE') {
          onStepChange('SYNTHESIZE');
          return;
        }
        onStepChange('DRAFT');
      },
      selectMaintainDomain: () => undefined,
      selectMaintainSection: () => undefined,
      selectMaintainAgent: () => undefined,
      refreshWorkspace: async () => undefined,
      openRuntimeSetup: () => navigate('/runtime'),
    },
    source: {
      onSourceTextChange,
      onSourceRefChange,
      onSourceEncodingChange,
      onSelectSourceFile: async (file) => {
        onSelectSourceFile(file);
      },
      startExtraction: async () => {
        onRunPhase1();
      },
      retryFailed: async () => {
        onRunFailedChunks();
      },
      retryFailedByErrorCode: async (errorCode) => {
        onRunFailedChunksByErrorCode(errorCode);
      },
      clearRetryErrorCode: () => setRetryErrorCode(null),
      setRetryWithFineRoute,
      setRetryScope,
      setRetryConcurrency,
    },
    curate: {
      onSelectStartTimeId,
      onToggleCharacter,
      onEventsGraphChange,
      onEventGraphLayoutChange,
      refreshQualityGate: onRefreshQualityGate,
      continueToGenerate: async () => {
        onRunPhase2();
      },
    },
    generate: {
      onTimeFlowRatioChange,
      onFutureEventsTextChange,
      onGenerateWorldCover: async () => {
        onGenerateWorldCover();
      },
      onGenerateCharacterPortrait: async (name) => {
        onGenerateCharacterPortrait(name);
      },
      onToggleAgentSyncCharacter,
      onAgentDraftChange,
      runPhase2: async () => {
        onRunPhase2();
      },
    },
    review: {
      onWorldPatchChange,
      onWorldviewPatchChange,
      onEventsChange: onEventsGraphChange,
      onLorebooksChange,
      onEventGraphLayoutChange,
      saveDraft: async () => {
        await persistDraft();
        setNotice('Draft saved.');
      },
      publishDraft,
      backToEdit: () => onStepChange('DRAFT'),
    },
    maintain: {
      onWorldPatchChange,
      onWorldviewPatchChange,
      onEventsChange: onEventsGraphChange,
      onLorebooksChange,
      onEventGraphLayoutChange,
      onEventSyncModeChange: async () => undefined,
      saveMaintenance: async () => undefined,
      syncEvents: async () => undefined,
      syncLorebooks: async () => undefined,
      deleteFirstEvent: async () => undefined,
      deleteFirstLorebook: async () => undefined,
      createAgentsFromDrafts: async () => undefined,
      updateCreatorAgentMetadata: async () => undefined,
      setSectionDirty: () => undefined,
      syncMediaBindings: async () => undefined,
      refreshResources: async () => undefined,
      reloadRemote: async () => undefined,
      adoptRemoteSnapshot: () => undefined,
    },
    routing: {
      onRouteSourceChange: () => undefined,
      onRouteConnectorChange: () => undefined,
      onRouteModelChange: () => undefined,
      onClearRouteBinding: () => undefined,
      onRebuildEmbeddingIndex: async () => undefined,
      onSetExpertMode: (value) => patchSnapshot({ taskState: { expertMode: value } }),
    },
    task: {
      pauseTask: () => false,
      resumeTask: async () => false,
      cancelTask: () => false,
    },
  };

  return {
    workflow,
    main,
    routing,
    status,
    actions,
    clearNotice: () => setNotice(null),
  };
}
