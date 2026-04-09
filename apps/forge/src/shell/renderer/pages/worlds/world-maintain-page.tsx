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
import { MaintainWorkbench } from '@world-engine/ui/maintain/maintain-workbench.js';
import type {
  EventNodeDraft,
  WorldLorebookDraftRow,
} from '@world-engine/contracts.js';
import type {
  WorldStudioActionsSlice,
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
import { ForgeLoadingSpinner } from '@renderer/components/page-layout.js';
import {
  WorldMaintainGovernancePanels,
  type CompareAnchor,
} from './world-maintain-governance-panels.js';
import {
  WorldMaintainAlerts,
  WorldMaintainHeader,
  WorldMaintainTruthPanelSection,
} from './world-maintain-shell-sections.js';
import { buildWorldMaintainWorkbenchState } from './world-maintain-workbench-state.js';
import {
  asRecord,
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

  const { layout, workflow, main, status } = buildWorldMaintainWorkbenchState({
    activeTab,
    dirtyLabels,
    effectiveWorldId,
    error,
    mutationsList,
    notice,
    snapshot,
    working,
    workspaceSnapshot,
  });

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
        <WorldMaintainHeader
          backTo={backTo}
          effectiveWorldId={effectiveWorldId}
          onBack={() => navigate(backTo)}
          onSave={() => {
            void (async () => {
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
            })();
          }}
          title={title}
          translate={t}
          working={working || truthWorking}
        />
      ) : null}

      {/* Notice/Error banners */}
      <WorldMaintainAlerts
        error={error}
        notice={notice}
        onClearError={() => setError(null)}
        onClearNotice={() => setNotice(null)}
      />

      <WorldMaintainGovernancePanels
        activeCompareAnchor={activeCompareAnchor}
        batchRunsLoading={batchRunsQuery.isLoading}
        expandedBatchRuns={expandedBatchRuns}
        expandedReleases={expandedReleases}
        latestReleaseId={latestReleaseId}
        registerBatchRunCard={(runId, node) => {
          batchRunCardRefs.current[runId] = node;
        }}
        registerReleaseCard={(releaseId, node) => {
          releaseCardRefs.current[releaseId] = node;
        }}
        releaseItems={releaseItems}
        releasesLoading={releasesQuery.isLoading}
        relevantBatchRuns={relevantBatchRuns}
        retryingBatchRunId={retryingBatchRunId}
        rollbackingReleaseId={rollbackingReleaseId}
        titleLineageItems={titleLineageItems}
        titleLineageLoading={titleLineageQuery.isLoading}
        onOpenLineageAnchor={onOpenLineageAnchor}
        onRetryBatchRun={(runId) => void onRetryBatchRun(runId)}
        onRollbackRelease={(releaseId, releaseVersion) => void onRollbackRelease(releaseId, releaseVersion)}
        onToggleBatchRunDetails={toggleBatchRunDetails}
        onToggleReleaseDetails={toggleReleaseDetails}
      />

      <WorldMaintainTruthPanelSection
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
