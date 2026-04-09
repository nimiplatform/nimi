/**
 * World Maintain Page — MAINTAIN pipeline wrapper (FG-WORLD-004)
 *
 * Imports World-Studio's MaintainWorkbench via @world-engine alias,
 * wires it to Forge's creator-world-store and world-data-client.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
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
  toForgeWorkspaceSnapshot,
  toWorldStudioWorkspacePatch,
  type ForgeWorkspacePatch,
} from '@renderer/state/creator-world-workspace.js';
import {
  useWorldResourceQueries,
  type WorldMaintenanceTimelineItem,
} from '@renderer/hooks/use-world-queries.js';
import type { JsonObject } from '@renderer/bridge/types.js';
import { useWorldCommitActions } from '@renderer/hooks/use-world-commit-actions.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { useAgentListQuery } from '@renderer/hooks/use-agent-queries.js';
import {
  getWorldTruth,
  getWorldviewTruth,
  listAgentRules,
  listWorldRules,
  rollbackWorldRelease,
  retryOfficialFactoryBatchRun,
} from '@renderer/data/world-data-client.js';
import { ForgeEmptyState, ForgeLoadingSpinner } from '@renderer/components/page-layout.js';
import { ForgeStatusBadge } from '@renderer/components/status-indicators.js';
import { WorldRuleTruthPanel } from './world-rule-truth-panel.js';
import {
  asRecord,
  getTimeFlowRatioFromWorldviewPatch,
  getWorkspaceStateDraft,
  requireWorkspaceSessionId,
  requireWorkspaceStateRef,
  toEventNodeDraft,
  toHistoryAppend,
  type MaintainTab,
} from './world-maintain-page-helpers.js';

type WorldMaintainPageViewProps = {
  embedded?: boolean;
  worldIdOverride?: string;
  backTo?: string;
  title?: string;
};

type CompareAnchor = {
  lineageKey: string;
  releaseId: string | null;
  runId: string | null;
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return 'Not recorded';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

function formatActorLabel(value: string | null | undefined): string {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(0, 12) : 'unknown';
}

function releaseStatusTone(status: string): 'success' | 'warning' | 'info' | 'neutral' {
  if (status === 'PUBLISHED') return 'success';
  if (status === 'FROZEN') return 'warning';
  if (status === 'DRAFT') return 'info';
  return 'neutral';
}

export function WorldMaintainPageView({
  embedded = false,
  worldIdOverride,
  backTo = '/worlds/library',
  title,
}: WorldMaintainPageViewProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { worldId = '' } = useParams<{ worldId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const effectiveWorldId = worldIdOverride || worldId;
  const queryClient = useQueryClient();

  // Auth
  const userId = useAppStore((s) => s.auth?.user?.id || '');

  // Store bindings
  const snapshot = useCreatorWorldStore((s) => s.snapshot);
  const workspaceSnapshot = toForgeWorkspaceSnapshot(snapshot);
  const patchSnapshot = useCreatorWorldStore((s) => s.patchSnapshot);
  const patchPanel = useCreatorWorldStore((s) => s.patchPanel);
  const hydrateForUser = useCreatorWorldStore((s) => s.hydrateForUser);
  const persistForUser = useCreatorWorldStore((s) => s.persistForUser);
  const patchWorkspaceSnapshot = useCallback((patch: ForgeWorkspacePatch) => {
    patchSnapshot(toWorldStudioWorkspacePatch(patch));
  }, [patchSnapshot]);

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
  const {
    stateQuery,
    historyQuery,
    lorebooksQuery,
    maintenanceTimeline,
    releasesQuery,
    titleLineageQuery,
    batchRunsQuery,
  } = useWorldResourceQueries({
    enabled: Boolean(effectiveWorldId),
    worldId: effectiveWorldId,
  });

  // Mutations
  const commitActions = useWorldCommitActions();
  const agentListQuery = useAgentListQuery(Boolean(effectiveWorldId));

  // Local UI state
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTruthAgentId, setSelectedTruthAgentId] = useState('');
  const [rollbackingReleaseId, setRollbackingReleaseId] = useState<string | null>(null);
  const [retryingBatchRunId, setRetryingBatchRunId] = useState<string | null>(null);
  const [expandedReleases, setExpandedReleases] = useState<Record<string, boolean>>({});
  const [expandedBatchRuns, setExpandedBatchRuns] = useState<Record<string, boolean>>({});
  const [activeCompareAnchor, setActiveCompareAnchor] = useState<CompareAnchor | null>(null);
  const releaseCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const batchRunCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const eventSyncMode = 'merge' as const;

  const worldTruthQuery = useQuery({
    queryKey: ['forge', 'world', 'truth', effectiveWorldId],
    enabled: Boolean(effectiveWorldId),
    retry: false,
    queryFn: async () => await getWorldTruth(effectiveWorldId),
  });

  const worldviewTruthQuery = useQuery({
    queryKey: ['forge', 'world', 'truth-worldview', effectiveWorldId],
    enabled: Boolean(effectiveWorldId),
    retry: false,
    queryFn: async () => await getWorldviewTruth(effectiveWorldId),
  });

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
    const workspaceState = getWorkspaceStateDraft(stateQuery.data);
    if (!workspaceState) return;
    patchWorkspaceSnapshot({
      worldStateDraft: workspaceState.worldStateDraft,
      workspaceVersion: workspaceState.workspaceVersion,
    });
  }, [stateQuery.data, patchWorkspaceSnapshot]);

  useEffect(() => {
    if (getWorkspaceStateDraft(stateQuery.data)) return;
    const truth = worldTruthQuery.data;
    if (!truth || typeof truth !== 'object') return;
    patchWorkspaceSnapshot({ worldStateDraft: asRecord(truth) });
  }, [worldTruthQuery.data, stateQuery.data, patchWorkspaceSnapshot]);

  useEffect(() => {
    const truth = worldviewTruthQuery.data;
    if (!truth || typeof truth !== 'object') return;
    patchWorkspaceSnapshot({ worldviewPatch: asRecord(truth) });
  }, [worldviewTruthQuery.data, patchWorkspaceSnapshot]);

  // Hydrate events from server
  useEffect(() => {
    const history = historyQuery.data;
    if (!history) return;
    const primary = history.filter((entry) => entry.level === 'PRIMARY').map((event) => toEventNodeDraft(event));
    const secondary = history.filter((entry) => entry.level === 'SECONDARY').map((event) => toEventNodeDraft(event));
    patchWorkspaceSnapshot({ eventsDraft: { primary, secondary } });
  }, [historyQuery.data, patchWorkspaceSnapshot]);

  // Hydrate lorebooks from server
  useEffect(() => {
    const lorebooks = lorebooksQuery.data;
    if (!lorebooks || !Array.isArray(lorebooks)) return;
    patchWorkspaceSnapshot({
      lorebooksDraft: lorebooks.filter((item): item is WorldLorebookDraftRow => Boolean(item && typeof item === 'object')),
    });
  }, [lorebooksQuery.data, patchWorkspaceSnapshot]);

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
  const onWorldStateDraftChange = useCallback((value: JsonObject) =>
    patchWorkspaceSnapshot({ worldStateDraft: value }), [patchWorkspaceSnapshot]);

  const onWorldviewPatchChange = useCallback((_value: JsonObject) => {
    setNotice('Worldview is now a read-only projection. Edit World Rules in the Rule Truth panel.');
  }, []);

  const onEventsChange = useCallback((next: { primary: EventNodeDraft[]; secondary: EventNodeDraft[] }) =>
    patchWorkspaceSnapshot({ eventsDraft: next }), [patchWorkspaceSnapshot]);

  const onEventGraphLayoutChange = useCallback((next: { selectedEventId: string; expandedPrimaryIds: string[] }) =>
    patchWorkspaceSnapshot({ eventGraphLayout: next }), [patchWorkspaceSnapshot]);

  const onLorebooksChange = useCallback((_value: WorldLorebookDraftRow[]) => {
    setNotice('Lorebooks are read-only projections. Edit World Rules or Agent Rules in the Rule Truth panel.');
  }, []);

  // Sync operations
  const onSyncEvents = useCallback(async () => {
    if (!effectiveWorldId) return;
    try {
      const relatedStateRef = requireWorkspaceStateRef(stateQuery.data);
      const upserts = [
        ...snapshot.eventsDraft.primary,
        ...snapshot.eventsDraft.secondary,
      ].map((event) => toHistoryAppend(event, [relatedStateRef]));

      await commitActions.syncEventsMutation.mutateAsync({
        worldId: effectiveWorldId,
        historyAppends: upserts,
        reason: 'Forge manual sync',
        sessionId: requireWorkspaceSessionId(workspaceSnapshot.workspaceVersion),
      });
      await queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'history', effectiveWorldId] });
      setNotice('Events synced successfully');
    } catch (err) {
      setError(`Failed to sync events: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [effectiveWorldId, snapshot.eventsDraft, commitActions.syncEventsMutation, queryClient, stateQuery.data]);

  const onSyncLorebooks = useCallback(async () => {
    setNotice('Lorebooks are read-only projections. Edit WorldRule or AgentRule instead.');
  }, []);

  const invalidateTruthQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'state', effectiveWorldId] }),
      queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'lorebooks', effectiveWorldId] }),
      queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'rules', effectiveWorldId] }),
      queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'agent-rules', effectiveWorldId] }),
    ]);
  }, [queryClient, effectiveWorldId]);

  const invalidateGovernanceQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'releases', effectiveWorldId] }),
      queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'title-lineage', effectiveWorldId] }),
      queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'batch-runs', effectiveWorldId] }),
      queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'state', effectiveWorldId] }),
      queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'truth', effectiveWorldId] }),
      queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'truth-worldview', effectiveWorldId] }),
      queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'history', effectiveWorldId] }),
      queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'lorebooks', effectiveWorldId] }),
      queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'rules', effectiveWorldId] }),
      queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'agent-rules', effectiveWorldId] }),
    ]);
  }, [effectiveWorldId, queryClient]);

  const onRollbackRelease = useCallback(async (releaseId: string, releaseVersion: number) => {
    if (!effectiveWorldId) return;
    if (!userId) {
      setError('Rollback requires an authenticated Forge operator.');
      return;
    }
    setRollbackingReleaseId(releaseId);
    setError(null);
    setNotice(null);
    try {
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
      const result = await rollbackWorldRelease(effectiveWorldId, releaseId, {
        governance: {
          officialOwnerId: userId,
          editorialOperatorId: userId,
          reviewerId: userId,
          publisherId: userId,
          publishActorId: userId,
          sourceProvenance: 'release-rollback',
          reviewVerdict: 'approved',
          releaseTag: `rollback-v${releaseVersion}-${timestamp}`,
          releaseSummary: `Rollback to release v${releaseVersion}`,
          changeSummary: `Forge maintain page rollback to release ${releaseId}`,
        },
      });
      await invalidateGovernanceQueries();
      setNotice(`Rollback published as release v${result.release.version}.`);
    } catch (err) {
      setError(`Rollback failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRollbackingReleaseId(null);
    }
  }, [effectiveWorldId, invalidateGovernanceQueries, userId]);

  const onRetryBatchRun = useCallback(async (runId: string) => {
    setRetryingBatchRunId(runId);
    setError(null);
    setNotice(null);
    try {
      const result = await retryOfficialFactoryBatchRun(runId, {
        reason: 'Retry requested from Forge maintain page',
      });
      await invalidateGovernanceQueries();
      setNotice(`Batch run ${result.name} re-queued for retry.`);
    } catch (err) {
      setError(`Batch retry failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRetryingBatchRunId(null);
    }
  }, [invalidateGovernanceQueries]);

  const toggleBatchRunDetails = useCallback((runId: string) => {
    setExpandedBatchRuns((current) => ({
      ...current,
      [runId]: !current[runId],
    }));
  }, []);

  const toggleReleaseDetails = useCallback((releaseId: string) => {
    setExpandedReleases((current) => ({
      ...current,
      [releaseId]: !current[releaseId],
    }));
  }, []);

  // Derived
  const working = commitActions.saveMaintenanceMutation.isPending
    || commitActions.syncEventsMutation.isPending
    || commitActions.syncResourceBindingsMutation.isPending;
  const truthWorking = worldRulesQuery.isFetching
    || agentRulesQuery.isFetching
    || commitActions.createWorldRuleMutation.isPending
    || commitActions.updateWorldRuleMutation.isPending
    || commitActions.deprecateWorldRuleMutation.isPending
    || commitActions.archiveWorldRuleMutation.isPending
    || commitActions.createAgentRuleMutation.isPending
    || commitActions.updateAgentRuleMutation.isPending
    || commitActions.deprecateAgentRuleMutation.isPending
    || commitActions.archiveAgentRuleMutation.isPending;

  const mutationsList: WorldMaintenanceTimelineItem[] = maintenanceTimeline;
  const releaseItems = releasesQuery.data ?? [];
  const titleLineageItems = titleLineageQuery.data ?? [];
  const relevantBatchRuns = (batchRunsQuery.data ?? []).filter((run) =>
    run.items.some((item) => item.worldId === effectiveWorldId),
  );
  const latestReleaseId = releaseItems[0]?.id ?? null;
  const dirtyLabels = Object.entries(workspaceSnapshot.unsavedChangesByPanel)
    .filter(([, dirty]) => dirty)
    .map(([key]) => key);

  const syncCompareAnchorToUrl = useCallback((anchor: CompareAnchor) => {
    const next = new URLSearchParams(searchParams);
    next.set('lineageKey', anchor.lineageKey);
    if (anchor.releaseId) {
      next.set('releaseId', anchor.releaseId);
    } else {
      next.delete('releaseId');
    }
    if (anchor.runId) {
      next.set('runId', anchor.runId);
    } else {
      next.delete('runId');
    }
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  const applyCompareAnchor = useCallback((anchor: CompareAnchor) => {
    if (anchor.releaseId) {
      setExpandedReleases((current) => ({
        ...current,
        [anchor.releaseId!]: true,
      }));
    }
    if (anchor.runId) {
      setExpandedBatchRuns((current) => ({
        ...current,
        [anchor.runId!]: true,
      }));
    }
    setActiveCompareAnchor(anchor);
  }, []);

  const onOpenLineageAnchor = useCallback((entry: typeof titleLineageItems[number]) => {
    const matchedRun = relevantBatchRuns.find((run) =>
      run.id === entry.runId
      || run.items.some((item) =>
        item.id === entry.itemId
        || item.titleLineageKey === entry.titleLineageKey
        || (entry.releaseId ? item.releaseId === entry.releaseId : false),
      ),
    ) ?? null;
    const matchedReleaseId = entry.releaseId
      ?? matchedRun?.items.find((item) => item.titleLineageKey === entry.titleLineageKey)?.releaseId
      ?? null;
    const matchedRunId = matchedRun?.id ?? null;

    const anchor = {
      lineageKey: entry.titleLineageKey,
      releaseId: matchedReleaseId,
      runId: matchedRunId,
    };
    applyCompareAnchor(anchor);
    syncCompareAnchorToUrl(anchor);
  }, [applyCompareAnchor, relevantBatchRuns, syncCompareAnchorToUrl, titleLineageItems]);

  useEffect(() => {
    const requestedLineageKey = String(searchParams.get('lineageKey') || '').trim();
    const requestedReleaseId = String(searchParams.get('releaseId') || '').trim() || null;
    const requestedRunId = String(searchParams.get('runId') || '').trim() || null;
    if (!requestedLineageKey && !requestedReleaseId && !requestedRunId) {
      return;
    }

    const matchedLineage = titleLineageItems.find((entry) =>
      (requestedLineageKey && entry.titleLineageKey === requestedLineageKey)
      || (requestedReleaseId && entry.releaseId === requestedReleaseId)
      || (requestedRunId && entry.runId === requestedRunId),
    );
    const matchedRun = relevantBatchRuns.find((run) =>
      run.id === requestedRunId
      || run.items.some((item) =>
        (requestedLineageKey && item.titleLineageKey === requestedLineageKey)
        || (requestedReleaseId && item.releaseId === requestedReleaseId),
      ),
    ) ?? null;
    const nextAnchor = {
      lineageKey: matchedLineage?.titleLineageKey ?? requestedLineageKey,
      releaseId: requestedReleaseId ?? matchedLineage?.releaseId ?? null,
      runId: requestedRunId ?? matchedRun?.id ?? null,
    };
    if (!nextAnchor.lineageKey && !nextAnchor.releaseId && !nextAnchor.runId) {
      return;
    }
    if (
      activeCompareAnchor?.lineageKey === nextAnchor.lineageKey
      && activeCompareAnchor?.releaseId === nextAnchor.releaseId
      && activeCompareAnchor?.runId === nextAnchor.runId
    ) {
      return;
    }
    applyCompareAnchor(nextAnchor);
  }, [activeCompareAnchor, applyCompareAnchor, relevantBatchRuns, searchParams, titleLineageItems]);

  useEffect(() => {
    if (!activeCompareAnchor) {
      return;
    }
    const target = (activeCompareAnchor.releaseId
      ? releaseCardRefs.current[activeCompareAnchor.releaseId]
      : null)
      ?? (activeCompareAnchor.runId ? batchRunCardRefs.current[activeCompareAnchor.runId] : null);
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeCompareAnchor]);

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
    selectedAgentSyncCharacters: workspaceSnapshot.agentSync.selectedCharacterIds,
    truthDerivedAgentDraftsByCharacter: workspaceSnapshot.agentSync.draftsByCharacter,
    eventsGraph: workspaceSnapshot.eventsDraft,
    timeFlowRatio: getTimeFlowRatioFromWorldviewPatch(workspaceSnapshot.worldviewPatch),
    importSubview: 'PREPARE',
    reviewSubview: 'EDIT',
    working,
    creatorAgents: [],
    selectedCreatorAgent: null,
    resourceBindings: [],
  };

  const status: WorldStudioStatusSlice = {
    landingLoading: false,
    activeTask: workspaceSnapshot.taskState.activeTask,
    recentTasks: workspaceSnapshot.taskState.recentTasks,
    expertMode: workspaceSnapshot.taskState.expertMode,
    localWorkspaceSavedAt: null,
    notice,
    error,
    conflictReloadSummary: null,
    hasMaintenanceConflict: false,
    maintenanceEditorSnapshotVersion: workspaceSnapshot.workspaceVersion,
    mutations: mutationsList,
    storyProjectionCount: 0,
    storyProjectionMissingContextCount: 0,
    storyProjectionLatestAt: '',
    primaryEventCount: workspaceSnapshot.eventsDraft.primary.length,
    secondaryEventCount: workspaceSnapshot.eventsDraft.secondary.length,
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
      onWorldPatchChange: onWorldStateDraftChange,
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
      onWorldPatchChange: onWorldStateDraftChange,
      onWorldviewPatchChange,
      onEventsChange,
      onLorebooksChange,
      onEventGraphLayoutChange,
      onEventSyncModeChange: () => undefined,
      saveLocalWorkspace: async () => undefined,
      syncToRemote: async () => undefined,
      syncWorkspaceToRemote: async () => undefined,
      saveMaintenance: async () => {
        await commitActions.saveMaintenanceMutation.mutateAsync({
          worldId: effectiveWorldId,
          worldState: workspaceSnapshot.worldStateDraft,
          reason: 'Forge manual save',
          sessionId: requireWorkspaceSessionId(workspaceSnapshot.workspaceVersion),
          ifSnapshotVersion: workspaceSnapshot.workspaceVersion || undefined,
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
      syncResourceBindings: async () => undefined,
      refreshResources: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'state', effectiveWorldId] }),
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'truth', effectiveWorldId] }),
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'truth-worldview', effectiveWorldId] }),
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'history', effectiveWorldId] }),
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'lorebooks', effectiveWorldId] }),
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'rules', effectiveWorldId] }),
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'agent-rules', effectiveWorldId] }),
        ]);
      },
      reloadRemote: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'state', effectiveWorldId] }),
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'truth', effectiveWorldId] }),
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'truth-worldview', effectiveWorldId] }),
        ]);
      },
      reloadFromRemote: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'state', effectiveWorldId] }),
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'truth', effectiveWorldId] }),
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'truth-worldview', effectiveWorldId] }),
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'history', effectiveWorldId] }),
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'lorebooks', effectiveWorldId] }),
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'rules', effectiveWorldId] }),
          queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'agent-rules', effectiveWorldId] }),
        ]);
      },
      adoptRemoteSnapshot: () => undefined,
    },
    routing: {
      onRouteSourceChange: () => undefined,
      onRouteConnectorChange: () => undefined,
      onRouteModelChange: () => undefined,
      onClearRouteBinding: () => undefined,
      onRebuildEmbeddingIndex: async () => undefined,
      onSetExpertMode: (value) => patchWorkspaceSnapshot({ taskState: { expertMode: value } }),
    },
    task: {
      pauseTask: () => false,
      resumeTask: async () => false,
      cancelTask: () => false,
    },
  };

  const loading = stateQuery.isLoading
    || worldTruthQuery.isLoading
    || worldviewTruthQuery.isLoading
    || historyQuery.isLoading
    || lorebooksQuery.isLoading;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <ForgeLoadingSpinner />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      {!embedded ? (
        <div className="flex items-center justify-between border-b border-[var(--nimi-border-subtle)] px-4 py-3">
          <div className="flex items-center gap-3">
            <Button
              tone="ghost"
              size="sm"
              onClick={() => navigate(backTo)}
            >
              &larr; {t('worlds.backToList', 'Back')}
            </Button>
            <h1 className="text-lg font-semibold text-[var(--nimi-text-primary)]">
              {title || t('pages.worldMaintain', 'Maintain World')}
            </h1>
            <span className="text-xs text-[var(--nimi-text-muted)]">{effectiveWorldId.slice(0, 8)}</span>
          </div>
          <Button
            tone="primary"
            size="sm"
            disabled={working || truthWorking}
            onClick={async () => {
              if (!effectiveWorldId) return;
              try {
                await commitActions.saveMaintenanceMutation.mutateAsync({
                  worldId: effectiveWorldId,
                  worldState: workspaceSnapshot.worldStateDraft,
                  reason: 'Forge manual save',
                  sessionId: requireWorkspaceSessionId(workspaceSnapshot.workspaceVersion),
                  ifSnapshotVersion: workspaceSnapshot.workspaceVersion || undefined,
                });
                await queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'state', effectiveWorldId] });
                setNotice('Saved successfully');
              } catch (err) {
                setError(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
              }
            }}
          >
            {t('maintain.save', 'Save')}
          </Button>
        </div>
      ) : null}

      {/* Notice/Error banners */}
      {error && (
        <div className="flex items-center justify-between border-b border-[var(--nimi-status-danger)]/20 bg-[var(--nimi-status-danger)]/10 px-4 py-2 text-sm text-[var(--nimi-status-danger)]">
          <span>{error}</span>
          <Button tone="ghost" size="sm" onClick={() => setError(null)}>&times;</Button>
        </div>
      )}
      {notice && !error && (
        <div className="flex items-center justify-between border-b border-[var(--nimi-status-success)]/20 bg-[var(--nimi-status-success)]/10 px-4 py-2 text-sm text-[var(--nimi-status-success)]">
          <span>{notice}</span>
          <Button tone="ghost" size="sm" onClick={() => setNotice(null)}>&times;</Button>
        </div>
      )}

      <div className="grid gap-4 border-b border-[var(--nimi-border-subtle)] px-4 py-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Surface tone="card" padding="md" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--nimi-text-primary)]">Official Releases</h2>
              <p className="text-xs text-[var(--nimi-text-muted)]">
                Governed publish history and rollback surface for this world.
              </p>
            </div>
            <span className="text-xs text-[var(--nimi-text-muted)]">{releaseItems.length} tracked</span>
          </div>
          {releasesQuery.isLoading ? (
            <ForgeLoadingSpinner />
          ) : releaseItems.length === 0 ? (
            <ForgeEmptyState message="No official releases yet." />
          ) : (
            <div className="space-y-2">
              {releaseItems.slice(0, 5).map((release) => {
                const isCurrent = latestReleaseId === release.id;
                const detailsExpanded = Boolean(expandedReleases[release.id]);
                const publishedAt = release.publishedAt ?? release.createdAt;
                const summaryText = release.diffSummary?.summaryText ?? release.description ?? 'No change summary.';
                const highlighted = activeCompareAnchor?.releaseId === release.id;
                return (
                  <div
                    key={release.id}
                    ref={(node) => {
                      releaseCardRefs.current[release.id] = node;
                    }}
                    className={`rounded-xl border bg-[var(--nimi-surface-panel)]/60 p-3 ${
                      highlighted
                        ? 'border-[var(--nimi-accent-primary)] ring-1 ring-[var(--nimi-accent-primary)]/40'
                        : 'border-[var(--nimi-border-subtle)]'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                            v{release.version} {release.tag ? `· ${release.tag}` : ''}
                          </p>
                          <ForgeStatusBadge domain="generic" status={release.status} tone={releaseStatusTone(release.status)} />
                          <ForgeStatusBadge domain="generic" status={release.releaseType} tone="neutral" />
                        </div>
                        <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                          {summaryText}
                        </p>
                        <p className="mt-2 text-xs text-[var(--nimi-text-muted)]">
                          Published {formatDateTime(publishedAt)} · pkg {release.packageVersion ?? 'n/a'} · actor {formatActorLabel(release.publishActorId ?? release.createdBy)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          tone="ghost"
                          size="sm"
                          onClick={() => toggleReleaseDetails(release.id)}
                        >
                          {detailsExpanded ? 'Hide Details' : 'Show Details'}
                        </Button>
                        <Button
                          tone={isCurrent ? 'ghost' : 'secondary'}
                          size="sm"
                          disabled={isCurrent || rollbackingReleaseId !== null}
                          onClick={() => void onRollbackRelease(release.id, release.version)}
                        >
                          {rollbackingReleaseId === release.id ? 'Rolling back…' : isCurrent ? 'Current' : 'Rollback'}
                        </Button>
                      </div>
                    </div>
                    {detailsExpanded ? (
                      <div className="mt-3 space-y-3 border-t border-[var(--nimi-border-subtle)] pt-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--nimi-text-muted)]">
                            Release Diff
                          </p>
                          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                            world rules {release.diffSummary?.worldRuleDelta ?? 0} · agent snapshots {release.diffSummary?.agentRuleSnapshotDelta ?? 0} · worldview {release.diffSummary?.worldviewChanged ? 'changed' : 'stable'} · lorebook {release.diffSummary?.lorebookChanged ? 'changed' : 'stable'}
                          </p>
                          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                            previous {release.diffSummary?.previousReleaseId ?? 'none'} · rollback target {release.diffSummary?.rollbackTargetReleaseId ?? 'none'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--nimi-text-muted)]">
                            Governance
                          </p>
                          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                            owner {formatActorLabel(release.officialOwnerId)} · editor {formatActorLabel(release.editorialOperatorId)} · reviewer {formatActorLabel(release.reviewerId)}
                          </p>
                          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                            publisher {formatActorLabel(release.publisherId)} · actor {formatActorLabel(release.publishActorId ?? release.createdBy)} · verdict {release.reviewVerdict ?? 'n/a'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--nimi-text-muted)]">
                            Release Lineage
                          </p>
                          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                            source {release.sourceProvenance ?? 'n/a'} · supersedes {release.supersedesReleaseId ?? 'none'} · rollback from {release.rollbackFromReleaseId ?? 'none'}
                          </p>
                          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                            checksum {release.ruleChecksum} · worldview {release.worldviewChecksum ?? 'n/a'} · lorebook {release.lorebookChecksum ?? 'n/a'}
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </Surface>

        <Surface tone="card" padding="md" className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--nimi-text-primary)]">Title Lineage</h2>
            <p className="text-xs text-[var(--nimi-text-muted)]">
              Canonical title tracking for compare and release operations.
            </p>
          </div>
          {titleLineageQuery.isLoading ? (
            <ForgeLoadingSpinner />
          ) : titleLineageItems.length === 0 ? (
            <ForgeEmptyState message="No title lineage records yet." />
          ) : (
            <div className="space-y-2">
              {titleLineageItems.slice(0, 5).map((entry) => (
                <div
                  key={entry.id}
                  className={`rounded-xl border bg-[var(--nimi-surface-panel)]/60 p-3 ${
                    activeCompareAnchor?.lineageKey === entry.titleLineageKey
                      ? 'border-[var(--nimi-accent-primary)] ring-1 ring-[var(--nimi-accent-primary)]/40'
                      : 'border-[var(--nimi-border-subtle)]'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{entry.canonicalTitle}</p>
                      <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                        source {entry.sourceTitle} · pkg {entry.packageVersion ?? 'n/a'}
                      </p>
                      <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                        anchor release {entry.releaseId ?? 'n/a'} · run {entry.runId ?? 'n/a'} · item {entry.itemId ?? 'n/a'}
                      </p>
                      <p className="mt-2 text-xs text-[var(--nimi-text-muted)]">
                        {entry.reason ?? 'Recorded from official publish flow.'}
                      </p>
                      <p className="mt-2 text-xs text-[var(--nimi-text-muted)]">
                        {formatDateTime(entry.createdAt)} · actor {formatActorLabel(entry.recordedBy)}
                      </p>
                    </div>
                    <Button
                      tone="ghost"
                      size="sm"
                      onClick={() => onOpenLineageAnchor(entry)}
                    >
                      Open Related
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Surface>
      </div>

      <div className="border-b border-[var(--nimi-border-subtle)] px-4 py-4">
        <Surface tone="card" padding="md" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--nimi-text-primary)]">Factory Runs</h2>
              <p className="text-xs text-[var(--nimi-text-muted)]">
                Official batch execution records linked to this world.
              </p>
            </div>
            <span className="text-xs text-[var(--nimi-text-muted)]">{relevantBatchRuns.length} tracked</span>
          </div>
          {batchRunsQuery.isLoading ? (
            <ForgeLoadingSpinner />
          ) : relevantBatchRuns.length === 0 ? (
            <ForgeEmptyState message="No official factory batch runs for this world yet." />
          ) : (
            <div className="space-y-2">
              {relevantBatchRuns.slice(0, 4).map((run) => {
                const retryable = run.items.some((item) => item.status === 'FAILED' || item.status === 'SKIPPED');
                const detailsExpanded = Boolean(expandedBatchRuns[run.id]);
                const highlighted = activeCompareAnchor?.runId === run.id;
                return (
                  <div
                    key={run.id}
                    ref={(node) => {
                      batchRunCardRefs.current[run.id] = node;
                    }}
                    className={`rounded-xl border bg-[var(--nimi-surface-panel)]/60 p-3 ${
                      highlighted
                        ? 'border-[var(--nimi-accent-primary)] ring-1 ring-[var(--nimi-accent-primary)]/40'
                        : 'border-[var(--nimi-border-subtle)]'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{run.name}</p>
                          <ForgeStatusBadge domain="generic" status={run.status} />
                          {run.qualityGateStatus ? (
                            <ForgeStatusBadge domain="generic" status={run.qualityGateStatus} />
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                          {run.pipelineStages.join(' -> ')}
                        </p>
                        <p className="mt-2 text-xs text-[var(--nimi-text-muted)]">
                          success {run.successCount} · failed {run.failureCount} · retry {run.retryCount}/{run.retryLimit}
                        </p>
                        {run.lastError ? (
                          <p className="mt-2 text-xs text-[var(--nimi-status-danger)]">{run.lastError}</p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          tone="ghost"
                          size="sm"
                          onClick={() => toggleBatchRunDetails(run.id)}
                        >
                          {detailsExpanded ? 'Hide Details' : 'Show Details'}
                        </Button>
                        <Button
                          tone="secondary"
                          size="sm"
                          disabled={!retryable || retryingBatchRunId !== null}
                          onClick={() => void onRetryBatchRun(run.id)}
                        >
                          {retryingBatchRunId === run.id ? 'Retrying…' : 'Retry Failed'}
                        </Button>
                      </div>
                    </div>
                    {detailsExpanded ? (
                      <div className="mt-3 space-y-3 border-t border-[var(--nimi-border-subtle)] pt-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--nimi-text-muted)]">
                            Pipeline Stages
                          </p>
                          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                            {run.pipelineStages.join(' -> ')}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--nimi-text-muted)]">
                            Quality Findings
                          </p>
                          {run.qualityGateSummary?.findings?.length ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {run.qualityGateSummary.findings.map((finding) => (
                                <span
                                  key={finding}
                                  className="rounded-full border border-[var(--nimi-border-subtle)] px-2 py-1 text-xs text-[var(--nimi-text-muted)]"
                                >
                                  {finding}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                              No quality findings recorded.
                            </p>
                          )}
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--nimi-text-muted)]">
                            Item Lineage
                          </p>
                          <div className="mt-2 space-y-2">
                            {run.items.map((item) => (
                              <div
                                key={`${run.id}-${item.id}`}
                                className="rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/40 p-3"
                              >
                                <p className="text-xs text-[var(--nimi-text-muted)]">
                                  {item.canonicalTitle} · slug {item.slug} · source {item.sourceMode}
                                </p>
                                <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                                  package {item.packageVersion ?? 'pending'} · release {item.releaseId ?? 'pending'}
                                </p>
                                <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                                  lineage {item.titleLineageKey} · started {item.startedAt ?? 'not-started'} · finished {item.finishedAt ?? 'not-finished'}
                                </p>
                                {item.lastError ? (
                                  <p className="mt-2 text-xs text-[var(--nimi-status-danger)]">
                                    {item.lastError}
                                  </p>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </Surface>
      </div>

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
          await commitActions.createWorldRuleMutation.mutateAsync({ worldId: effectiveWorldId, payload });
          await invalidateTruthQueries();
        }}
        onUpdateWorldRule={async (ruleId, payload) => {
          await commitActions.updateWorldRuleMutation.mutateAsync({ worldId: effectiveWorldId, ruleId, payload });
          await invalidateTruthQueries();
        }}
        onDeprecateWorldRule={async (ruleId) => {
          await commitActions.deprecateWorldRuleMutation.mutateAsync({ worldId: effectiveWorldId, ruleId });
          await invalidateTruthQueries();
        }}
        onArchiveWorldRule={async (ruleId) => {
          await commitActions.archiveWorldRuleMutation.mutateAsync({ worldId: effectiveWorldId, ruleId });
          await invalidateTruthQueries();
        }}
        onCreateAgentRule={async (agentId, payload) => {
          await commitActions.createAgentRuleMutation.mutateAsync({ worldId: effectiveWorldId, agentId, payload });
          await invalidateTruthQueries();
        }}
        onUpdateAgentRule={async (agentId, ruleId, payload) => {
          await commitActions.updateAgentRuleMutation.mutateAsync({ worldId: effectiveWorldId, agentId, ruleId, payload });
          await invalidateTruthQueries();
        }}
        onDeprecateAgentRule={async (agentId, ruleId) => {
          await commitActions.deprecateAgentRuleMutation.mutateAsync({ worldId: effectiveWorldId, agentId, ruleId });
          await invalidateTruthQueries();
        }}
        onArchiveAgentRule={async (agentId, ruleId) => {
          await commitActions.archiveAgentRuleMutation.mutateAsync({ worldId: effectiveWorldId, agentId, ruleId });
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
