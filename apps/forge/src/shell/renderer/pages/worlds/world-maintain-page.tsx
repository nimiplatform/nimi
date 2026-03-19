/**
 * World Maintain Page — MAINTAIN pipeline wrapper (FG-WORLD-004)
 *
 * Imports World-Studio's MaintainWorkbench via @world-engine alias,
 * wires it to Forge's creator-world-store and world-data-client.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MaintainWorkbench } from '@world-engine/ui/maintain/maintain-workbench.js';
import type {
  EventNodeDraft,
  WorldLorebookDraftRow,
} from '@world-engine/contracts.js';
import type {
  WorldStudioActionsSlice,
  WorldStudioLayoutSlice,
  WorldStudioMainSlice,
  WorldStudioStatusSlice,
  WorldStudioWorkflowSlice,
} from '@world-engine/controllers/world-studio-screen-model.js';
import { useCreatorWorldStore } from '@renderer/state/creator-world-store.js';
import {
  useWorldResourceQueries,
  type WorldMutationSummary,
} from '@renderer/hooks/use-world-queries.js';
import type { JsonObject } from '@renderer/bridge/types.js';
import { useWorldMutations } from '@renderer/hooks/use-world-mutations.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { useAgentListQuery } from '@renderer/hooks/use-agent-queries.js';
import { listAgentRules, listWorldRules } from '@renderer/data/world-data-client.js';
import { WorldRuleTruthPanel } from './world-rule-truth-panel.js';

type MaintainTab = 'WORLD' | 'WORLDVIEW' | 'EVENTS' | 'LOREBOOKS';

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function getTimeFlowRatioFromWorldviewPatch(worldviewPatch: JsonObject): string {
  const timeModel = asRecord(worldviewPatch.timeModel);
  const ratio = timeModel.timeFlowRatio;
  if (typeof ratio === 'number' && Number.isFinite(ratio)) {
    return String(ratio);
  }
  return '1';
}

function toEventNodeDraft(event: {
  id: string;
  timelineSeq: number;
  level: 'PRIMARY' | 'SECONDARY';
  eventHorizon: 'PAST' | 'ONGOING' | 'FUTURE';
  parentEventId: string | null;
  title: string;
  summary: string | null;
  cause: string | null;
  process: string | null;
  result: string | null;
  timeRef: string | null;
  locationRefs: string[];
  characterRefs: string[];
  dependsOnEventIds: string[];
  evidenceRefs: unknown[];
  confidence: number;
  needsEvidence: boolean;
}): EventNodeDraft {
  return {
    ...event,
    summary: event.summary ?? undefined,
    cause: event.cause ?? undefined,
    process: event.process ?? undefined,
    result: event.result ?? undefined,
    timeRef: event.timeRef ?? undefined,
  } as EventNodeDraft;
}

type WorldMaintainPageViewProps = {
  embedded?: boolean;
  worldIdOverride?: string;
  backTo?: string;
  title?: string;
};

export function WorldMaintainPageView({
  embedded = false,
  worldIdOverride,
  backTo = '/worlds/library',
  title,
}: WorldMaintainPageViewProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { worldId = '' } = useParams<{ worldId: string }>();
  const effectiveWorldId = worldIdOverride || worldId;
  const queryClient = useQueryClient();

  // Auth
  const userId = useAppStore((s) => s.auth?.user?.id || '');

  // Store bindings
  const snapshot = useCreatorWorldStore((s) => s.snapshot);
  const patchSnapshot = useCreatorWorldStore((s) => s.patchSnapshot);
  const patchPanel = useCreatorWorldStore((s) => s.patchPanel);
  const hydrateForUser = useCreatorWorldStore((s) => s.hydrateForUser);
  const persistForUser = useCreatorWorldStore((s) => s.persistForUser);

  // Hydrate on mount
  useEffect(() => {
    if (userId) hydrateForUser(userId);
  }, [hydrateForUser, userId]);

  // Set selected world
  useEffect(() => {
    if (effectiveWorldId && snapshot.panel.selectedWorldId !== effectiveWorldId) {
      patchPanel({ selectedWorldId: effectiveWorldId, activeDomain: 'WORLD' });
    }
  }, [effectiveWorldId, snapshot.panel.selectedWorldId, patchPanel]);

  // Persist on snapshot change
  useEffect(() => {
    if (userId) persistForUser(userId);
  }, [persistForUser, snapshot, userId]);

  // Queries
  const { maintenanceQuery, eventsQuery, lorebooksQuery, mutationsQuery } = useWorldResourceQueries({
    enabled: Boolean(effectiveWorldId),
    worldId: effectiveWorldId,
  });

  // Mutations
  const mutations = useWorldMutations();
  const agentListQuery = useAgentListQuery(Boolean(effectiveWorldId));

  // Local UI state
  const [eventSyncMode, setEventSyncMode] = useState<'merge' | 'replace'>('merge');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTruthAgentId, setSelectedTruthAgentId] = useState('');

  const worldRulesQuery = useQuery({
    queryKey: ['forge', 'world', 'rules', effectiveWorldId, 'ACTIVE'],
    enabled: Boolean(effectiveWorldId),
    retry: false,
    queryFn: async () => await listWorldRules(effectiveWorldId, 'ACTIVE'),
  });

  const worldOwnedAgents = (agentListQuery.data || []).filter((agent) => agent.worldId === effectiveWorldId);

  useEffect(() => {
    if (!selectedTruthAgentId && worldOwnedAgents.length > 0) {
      setSelectedTruthAgentId(worldOwnedAgents[0]!.id);
      return;
    }
    if (
      selectedTruthAgentId &&
      worldOwnedAgents.length > 0 &&
      !worldOwnedAgents.some((agent) => agent.id === selectedTruthAgentId)
    ) {
      setSelectedTruthAgentId(worldOwnedAgents[0]!.id);
    }
  }, [selectedTruthAgentId, worldOwnedAgents]);

  const agentRulesQuery = useQuery({
    queryKey: ['forge', 'world', 'agent-rules', effectiveWorldId, selectedTruthAgentId, 'ACTIVE'],
    enabled: Boolean(effectiveWorldId && selectedTruthAgentId),
    retry: false,
    queryFn: async () => await listAgentRules(effectiveWorldId, selectedTruthAgentId, { status: 'ACTIVE' }),
  });

  // Hydrate snapshot from server data
  useEffect(() => {
    const maint = maintenanceQuery.data;
    if (!maint || typeof maint !== 'object') return;
    const record = asRecord(maint);
    const worldProjection = record.world && typeof record.world === 'object'
      ? record.world
      : record.worldPatch;
    if (worldProjection && typeof worldProjection === 'object') {
      patchSnapshot({
        worldPatch: asRecord(worldProjection),
        editorSnapshotVersion: String(record.editorSnapshotVersion || ''),
      });
    }
    const worldviewProjection = record.worldview && typeof record.worldview === 'object'
      ? record.worldview
      : record.worldviewPatch;
    if (worldviewProjection && typeof worldviewProjection === 'object') {
      patchSnapshot({
        worldviewPatch: asRecord(worldviewProjection),
      });
    }
  }, [maintenanceQuery.data, patchSnapshot]);

  // Hydrate events from server
  useEffect(() => {
    const events = eventsQuery.data;
    if (!events) return;
    const primary = events.filter((e) => e.level === 'PRIMARY').map((event) => toEventNodeDraft(event));
    const secondary = events.filter((e) => e.level === 'SECONDARY').map((event) => toEventNodeDraft(event));
    patchSnapshot({ eventsDraft: { primary, secondary } });
  }, [eventsQuery.data, patchSnapshot]);

  // Hydrate lorebooks from server
  useEffect(() => {
    const lorebooks = lorebooksQuery.data;
    if (!lorebooks || !Array.isArray(lorebooks)) return;
    patchSnapshot({
      lorebooksDraft: lorebooks.filter((item): item is WorldLorebookDraftRow => Boolean(item && typeof item === 'object')),
    });
  }, [lorebooksQuery.data, patchSnapshot]);

  // Tab management
  const activeSection = snapshot.panel.activeSection;
  const activeTab: MaintainTab = activeSection === 'WORLDVIEW'
    ? 'WORLDVIEW'
    : activeSection === 'WORLD_EVENTS'
      ? 'EVENTS'
      : activeSection === 'LOREBOOKS'
        ? 'LOREBOOKS'
        : 'WORLD';
  const onTabChange = useCallback((tab: MaintainTab) => {
    patchPanel({
      activeDomain: 'WORLD',
      activeSection: tab === 'WORLD'
        ? 'BASE'
        : tab === 'EVENTS'
          ? 'WORLD_EVENTS'
          : tab,
    });
  }, [patchPanel]);

  // Data callbacks
  const onWorldPatchChange = useCallback((value: JsonObject) =>
    patchSnapshot({ worldPatch: value }), [patchSnapshot]);

  const onWorldviewPatchChange = useCallback((_value: JsonObject) => {
    setNotice('Worldview is now a read-only projection. Edit World Rules in the Rule Truth panel.');
  }, []);

  const onEventsChange = useCallback((next: { primary: EventNodeDraft[]; secondary: EventNodeDraft[] }) =>
    patchSnapshot({ eventsDraft: next }), [patchSnapshot]);

  const onEventGraphLayoutChange = useCallback((next: { selectedEventId: string; expandedPrimaryIds: string[] }) =>
    patchSnapshot({ eventGraphLayout: next }), [patchSnapshot]);

  const onLorebooksChange = useCallback((_value: WorldLorebookDraftRow[]) => {
    setNotice('Lorebooks are read-only projections. Edit World Rules or Agent Rules in the Rule Truth panel.');
  }, []);

  // Sync operations
  const onSyncEvents = useCallback(async () => {
    if (!effectiveWorldId) return;
    try {
      const upserts = [
        ...snapshot.eventsDraft.primary,
        ...snapshot.eventsDraft.secondary,
      ].map((event) => asRecord(event));

      await mutations.syncEventsMutation.mutateAsync({
        worldId: effectiveWorldId,
        eventUpserts: upserts,
        reason: 'Forge manual sync',
        mode: eventSyncMode,
      });
      await queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'events', effectiveWorldId] });
      setNotice('Events synced successfully');
    } catch (err) {
      setError(`Failed to sync events: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [effectiveWorldId, snapshot.eventsDraft, mutations.syncEventsMutation, queryClient, eventSyncMode]);

  const onSyncLorebooks = useCallback(async () => {
    setNotice('Lorebooks are read-only projections. Edit WorldRule or AgentRule instead.');
  }, []);

  const invalidateTruthQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'maintenance', effectiveWorldId] }),
      queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'lorebooks', effectiveWorldId] }),
      queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'rules', effectiveWorldId] }),
      queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'agent-rules', effectiveWorldId] }),
    ]);
  }, [queryClient, effectiveWorldId]);

  // Derived
  const working = mutations.saveMaintenanceMutation.isPending
    || mutations.syncEventsMutation.isPending
    || mutations.syncMediaBindingsMutation.isPending;
  const truthWorking = worldRulesQuery.isFetching
    || agentRulesQuery.isFetching
    || mutations.createWorldRuleMutation.isPending
    || mutations.updateWorldRuleMutation.isPending
    || mutations.deprecateWorldRuleMutation.isPending
    || mutations.archiveWorldRuleMutation.isPending
    || mutations.createAgentRuleMutation.isPending
    || mutations.updateAgentRuleMutation.isPending
    || mutations.deprecateAgentRuleMutation.isPending
    || mutations.archiveAgentRuleMutation.isPending;

  const mutationsList: WorldMutationSummary[] = mutationsQuery.data || [];
  const dirtyLabels = Object.entries(snapshot.unsavedChangesByPanel)
    .filter(([, dirty]) => dirty)
    .map(([key]) => key);

  const layout: WorldStudioLayoutSlice = {
    title: 'Forge World Maintenance',
    subtitle: 'Maintain the selected world',
    currentObjectLabel: effectiveWorldId || 'World',
    dirtySummary: {
      hasDirty: dirtyLabels.length > 0,
      count: dirtyLabels.length,
      labels: dirtyLabels,
      shortLabel: dirtyLabels.length > 0 ? `${dirtyLabels.length} dirty` : 'Saved',
    },
    settingsDrawerOpen: false,
    setSettingsDrawerOpen: () => undefined,
    toggleSettingsDrawer: () => undefined,
  };

  const workflow: WorldStudioWorkflowSlice = {
    landing: { target: 'MAINTAIN', worldId: effectiveWorldId || null, reason: null },
    landingTarget: 'MAINTAIN',
    worlds: [],
    drafts: [],
    primaryWorld: null,
    latestDraft: null,
    selectedWorldId: effectiveWorldId,
    selectedDraftId: '',
    createDisplayStage: 'IMPORT',
    createStageAccess: {
      IMPORT: { enabled: true, reason: null },
      CURATE: { enabled: true, reason: null },
      GENERATE: { enabled: true, reason: null },
      REVIEW: { enabled: true, reason: null },
    },
    activeDomain: 'WORLD',
    activeSection: activeTab === 'WORLD'
      ? 'BASE'
      : activeTab === 'EVENTS'
        ? 'WORLD_EVENTS'
        : activeTab,
    selectedAgentId: '',
  };

  const main: WorldStudioMainSlice = {
    snapshot,
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
    eventSyncMode,
    selectedAgentSyncCharacters: snapshot.agentSync.selectedCharacterIds,
    truthDerivedAgentDraftsByCharacter: snapshot.agentSync.draftsByCharacter,
    eventsGraph: snapshot.eventsDraft,
    timeFlowRatio: getTimeFlowRatioFromWorldviewPatch(snapshot.worldviewPatch),
    importSubview: 'PREPARE',
    reviewSubview: 'EDIT',
    working,
    creatorAgents: [],
    selectedCreatorAgent: null,
    mediaBindings: [],
  };

  const status: WorldStudioStatusSlice = {
    landingLoading: false,
    activeTask: snapshot.taskState.activeTask,
    recentTasks: snapshot.taskState.recentTasks,
    expertMode: snapshot.taskState.expertMode,
    notice,
    error,
    conflictReloadSummary: null,
    hasMaintenanceConflict: false,
    maintenanceEditorSnapshotVersion: snapshot.editorSnapshotVersion,
    mutations: mutationsList,
    storyProjectionCount: 0,
    storyProjectionMissingContextCount: 0,
    storyProjectionLatestAt: '',
    primaryEventCount: snapshot.eventsDraft.primary.length,
    secondaryEventCount: snapshot.eventsDraft.secondary.length,
    missingPrimaryEvidenceCount: 0,
    eventCharacterCoverage: 0,
    eventLocationCoverage: 0,
    terminalChunkSuccess: 0,
    terminalChunkTotal: 0,
    terminalChunkFailed: 0,
    terminalTopFailure: null,
  };

  const actions: WorldStudioActionsSlice = {
    workflow: {
      loadLanding: async () => undefined,
      openMaintenance: () => undefined,
      openCreate: () => undefined,
      selectCreateDisplayStage: () => undefined,
      selectMaintainDomain: () => undefined,
      selectMaintainSection: (section) => {
        if (section === 'BASE') onTabChange('WORLD');
        else if (section === 'WORLD_EVENTS') onTabChange('EVENTS');
        else if (section === 'WORLDVIEW' || section === 'LOREBOOKS') onTabChange(section);
      },
      selectMaintainAgent: () => undefined,
      refreshWorkspace: async () => undefined,
    },
    source: {
      onSourceTextChange: () => undefined,
      onSourceRefChange: () => undefined,
      onSourceEncodingChange: () => undefined,
      onSelectSourceFile: async () => undefined,
      startExtraction: async () => undefined,
      retryFailed: async () => undefined,
      retryFailedByErrorCode: async () => undefined,
      clearRetryErrorCode: () => undefined,
      setRetryWithFineRoute: () => undefined,
      setRetryScope: () => undefined,
      setRetryConcurrency: () => undefined,
    },
    curate: {
      onSelectStartTimeId: () => undefined,
      onToggleCharacter: () => undefined,
      onEventsGraphChange: () => undefined,
      onEventGraphLayoutChange: () => undefined,
      refreshQualityGate: () => undefined,
      continueToGenerate: async () => undefined,
    },
    generate: {
      onTimeFlowRatioChange: () => undefined,
      onFutureEventsTextChange: () => undefined,
      onGenerateWorldCover: async () => undefined,
      onGenerateCharacterPortrait: async () => undefined,
      onToggleAgentSyncCharacter: () => undefined,
      onAgentDraftChange: () => undefined,
      runPhase2: async () => undefined,
    },
    review: {
      onWorldPatchChange,
      onWorldviewPatchChange,
      onRuleTruthDraftChange: () => undefined,
      onEventsChange,
      onLorebooksChange,
      onEventGraphLayoutChange,
      saveDraft: async () => undefined,
      publishDraft: async () => undefined,
      backToEdit: () => undefined,
    },
    maintain: {
      onWorldPatchChange,
      onWorldviewPatchChange,
      onEventsChange,
      onLorebooksChange,
      onEventGraphLayoutChange,
      onEventSyncModeChange: setEventSyncMode,
      saveMaintenance: async () => {
        await mutations.saveMaintenanceMutation.mutateAsync({
          worldId: effectiveWorldId,
          worldPatch: snapshot.worldPatch,
          reason: 'Forge manual save',
          ifSnapshotVersion: snapshot.editorSnapshotVersion || undefined,
        });
      },
      syncEvents: async () => {
        await onSyncEvents();
      },
      syncLorebooks: async () => {
        await onSyncLorebooks();
      },
      deleteFirstEvent: async () => undefined,
      deleteFirstLorebook: async () => undefined,
      createAgentsFromDrafts: async () => undefined,
      updateCreatorAgentMetadata: async () => undefined,
      setSectionDirty: () => undefined,
      syncMediaBindings: async () => undefined,
      refreshResources: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'maintenance', effectiveWorldId] }),
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'events', effectiveWorldId] }),
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'lorebooks', effectiveWorldId] }),
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'rules', effectiveWorldId] }),
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'agent-rules', effectiveWorldId] }),
        ]);
      },
      reloadRemote: async () => {
        await queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'maintenance', effectiveWorldId] });
      },
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

  const loading = maintenanceQuery.isLoading || eventsQuery.isLoading || lorebooksQuery.isLoading;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      {!embedded ? (
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(backTo)}
              className="text-sm text-neutral-400 hover:text-white transition-colors"
            >
              &larr; {t('worlds.backToList', 'Back')}
            </button>
            <h1 className="text-lg font-semibold text-white">
              {title || t('pages.worldMaintain', 'Maintain World')}
            </h1>
            <span className="text-xs text-neutral-500">{effectiveWorldId.slice(0, 8)}</span>
          </div>
          <button
            onClick={async () => {
              if (!effectiveWorldId) return;
              try {
                await mutations.saveMaintenanceMutation.mutateAsync({
                  worldId: effectiveWorldId,
                  worldPatch: snapshot.worldPatch,
                  reason: 'Forge manual save',
                  ifSnapshotVersion: snapshot.editorSnapshotVersion || undefined,
                });
                await queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'maintenance', effectiveWorldId] });
                setNotice('Saved successfully');
              } catch (err) {
                setError(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
              }
            }}
            disabled={working || truthWorking}
            className="rounded-lg bg-white px-4 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors"
          >
            {t('maintain.save', 'Save')}
          </button>
        </div>
      ) : null}

      {/* Notice/Error banners */}
      {error && (
        <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 text-sm text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400/60 hover:text-red-400">&times;</button>
        </div>
      )}
      {notice && !error && (
        <div className="bg-green-500/10 border-b border-green-500/20 px-4 py-2 text-sm text-green-400 flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-green-400/60 hover:text-green-400">&times;</button>
        </div>
      )}

      <WorldRuleTruthPanel
        worldRules={Array.isArray(worldRulesQuery.data) ? worldRulesQuery.data : []}
        worldRulesLoading={worldRulesQuery.isLoading}
        worldAgents={worldOwnedAgents}
        selectedAgentId={selectedTruthAgentId}
        onSelectedAgentIdChange={setSelectedTruthAgentId}
        agentRules={Array.isArray(agentRulesQuery.data) ? agentRulesQuery.data : []}
        agentRulesLoading={agentRulesQuery.isLoading}
        working={working || truthWorking}
        onCreateWorldRule={async (payload) => {
          await mutations.createWorldRuleMutation.mutateAsync({ worldId: effectiveWorldId, payload });
          await invalidateTruthQueries();
        }}
        onUpdateWorldRule={async (ruleId, payload) => {
          await mutations.updateWorldRuleMutation.mutateAsync({ worldId: effectiveWorldId, ruleId, payload });
          await invalidateTruthQueries();
        }}
        onDeprecateWorldRule={async (ruleId) => {
          await mutations.deprecateWorldRuleMutation.mutateAsync({ worldId: effectiveWorldId, ruleId });
          await invalidateTruthQueries();
        }}
        onArchiveWorldRule={async (ruleId) => {
          await mutations.archiveWorldRuleMutation.mutateAsync({ worldId: effectiveWorldId, ruleId });
          await invalidateTruthQueries();
        }}
        onCreateAgentRule={async (agentId, payload) => {
          await mutations.createAgentRuleMutation.mutateAsync({ worldId: effectiveWorldId, agentId, payload });
          await invalidateTruthQueries();
        }}
        onUpdateAgentRule={async (agentId, ruleId, payload) => {
          await mutations.updateAgentRuleMutation.mutateAsync({ worldId: effectiveWorldId, agentId, ruleId, payload });
          await invalidateTruthQueries();
        }}
        onDeprecateAgentRule={async (agentId, ruleId) => {
          await mutations.deprecateAgentRuleMutation.mutateAsync({ worldId: effectiveWorldId, agentId, ruleId });
          await invalidateTruthQueries();
        }}
        onArchiveAgentRule={async (agentId, ruleId) => {
          await mutations.archiveAgentRuleMutation.mutateAsync({ worldId: effectiveWorldId, agentId, ruleId });
          await invalidateTruthQueries();
        }}
        setNotice={setNotice}
        setError={setError}
      />

      {/* Workbench */}
      <div className="min-h-0 flex-1">
        <MaintainWorkbench
          layout={layout}
          workflow={workflow}
          main={main}
          status={status}
          actions={actions}
        />
      </div>
    </div>
  );
}

export default function WorldMaintainPage() {
  return <WorldMaintainPageView />;
}
