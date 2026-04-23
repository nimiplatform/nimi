import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import {
  useAgentListQuery,
  useWorldOwnedAgentRosterQuery,
} from '@renderer/hooks/use-agent-queries.js';
import { useWorldCommitActions } from '@renderer/hooks/use-world-commit-actions.js';
import { useWorldResourceQueries } from '@renderer/hooks/use-world-queries.js';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';
import { WorldCreatePageView } from '@renderer/pages/worlds/world-create-page.js';
import { WorldMaintainPageView } from '@renderer/pages/worlds/world-maintain-page.js';
import { WorkbenchEnrichmentPanel } from '@renderer/pages/workbench/workbench-enrichment-panel.js';
import { useImageGeneration } from '@renderer/hooks/use-image-generation.js';
import { buildWorkbenchWorldPackage } from '@renderer/data/workbench-world-package-builder.js';
import { ForgeFullscreenState } from '@renderer/components/page-layout.js';
import { WorkbenchPageAgentsPanel } from './workbench-page-agents-panel.js';
import { WorkbenchPageImportPanel } from './workbench-page-import-panel.js';
import { WorkbenchPageOverviewPanel } from './workbench-page-overview-panel.js';
import { WorkbenchPagePublishPanel } from './workbench-page-publish-panel.js';
import { WorkbenchPageReviewPanel } from './workbench-page-review-panel.js';
import { WorkbenchPageSidebar } from './workbench-page-sidebar.js';
import {
  PANELS,
  buildWorkbenchCompletenessIssues,
  buildWorkbenchWorldImageContext,
  isWorkbenchReviewReady,
  type WorkbenchPanel,
} from './workbench-page-shared.js';

export default function WorkbenchPage() {
  const navigate = useNavigate();
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPanel = (searchParams.get('panel') || 'OVERVIEW').toUpperCase() as WorkbenchPanel;
  const panel = PANELS.includes(requestedPanel) ? requestedPanel : 'OVERVIEW';

  const snapshot = useForgeWorkspaceStore((state) => state.workspaces[workspaceId]);
  const setActiveWorkspace = useForgeWorkspaceStore((state) => state.setActiveWorkspace);
  const setWorkspacePanel = useForgeWorkspaceStore((state) => state.setWorkspacePanel);
  const patchWorldDraft = useForgeWorkspaceStore((state) => state.patchWorldDraft);
  const updateReviewWorldRule = useForgeWorkspaceStore((state) => state.updateReviewWorldRule);
  const updateReviewAgentRule = useForgeWorkspaceStore((state) => state.updateReviewAgentRule);
  const updateAgentDraft = useForgeWorkspaceStore((state) => state.updateAgentDraft);
  const attachMasterAgentClone = useForgeWorkspaceStore((state) => state.attachMasterAgentClone);
  const buildPublishPlan = useForgeWorkspaceStore((state) => state.buildPublishPlan);
  const markPublished = useForgeWorkspaceStore((state) => state.markPublished);
  const userId = useAppStore((state) => state.auth?.user?.id || '');
  const commitActions = useWorldCommitActions();

  const masterAgentsQuery = useAgentListQuery(true);
  const masterAgents = useMemo(
    () => (masterAgentsQuery.data || []).filter((agent) => agent.ownershipType === 'MASTER_OWNED'),
    [masterAgentsQuery.data],
  );

  const [publishError, setPublishError] = useState<string | null>(null);
  const imageGen = useImageGeneration();
  const [visualPrompt, setVisualPrompt] = useState('');
  const worldId = snapshot?.worldDraft.worldId ?? '';

  const worldResourceQueries = useWorldResourceQueries({
    enabled: Boolean(snapshot) && Boolean(worldId),
    worldId,
    enableCollections: false,
    enableGovernance: false,
  });
  const worldOwnedAgentRosterQuery = useWorldOwnedAgentRosterQuery(worldId, Boolean(snapshot) && Boolean(worldId));

  if (!snapshot) {
    return (
      <ForgeFullscreenState
        title="Workspace not found"
        message="The local Forge workspace snapshot is missing or was removed."
        action="Back to Workbench"
        onAction={() => navigate('/workbench')}
      />
    );
  }

  useEffect(() => {
    setActiveWorkspace(workspaceId);
  }, [setActiveWorkspace, workspaceId]);

  useEffect(() => {
    if (snapshot.workspace.activePanel !== panel) {
      setWorkspacePanel(workspaceId, panel);
    }
  }, [panel, setWorkspacePanel, snapshot.workspace.activePanel, workspaceId]);

  const openPanel = (nextPanel: WorkbenchPanel) => {
    setWorkspacePanel(workspaceId, nextPanel);
    setSearchParams({ panel: nextPanel });
  };

  const reviewReady = useMemo(() => isWorkbenchReviewReady(snapshot), [snapshot]);
  const publishContext = useMemo(() => ({
    worldDeliverables: worldResourceQueries.worldDeliverables,
    agentRoster: worldOwnedAgentRosterQuery.data ?? null,
  }), [worldOwnedAgentRosterQuery.data, worldResourceQueries.worldDeliverables]);
  const completenessIssues = useMemo(() => buildWorkbenchCompletenessIssues({
    snapshot,
    userId,
    publishContext,
    worldAssetsLoading: worldResourceQueries.resourceBindingsQuery.isPending,
    worldAssetsFailed: worldResourceQueries.resourceBindingsQuery.isError,
    agentRosterLoading: worldOwnedAgentRosterQuery.isPending,
    agentRosterFailed: worldOwnedAgentRosterQuery.isError,
  }), [
    publishContext,
    snapshot,
    worldOwnedAgentRosterQuery.isError,
    worldOwnedAgentRosterQuery.isPending,
    worldResourceQueries.resourceBindingsQuery.isError,
    worldResourceQueries.resourceBindingsQuery.isPending,
  ]);

  const publishReady = reviewReady && completenessIssues.length === 0 && Boolean(userId);

  const patchCurrentWorldDraft = (patch: Partial<typeof snapshot.worldDraft>) => {
    patchWorldDraft(workspaceId, patch);
  };

  const buildWorldImageContext = (target: 'world-banner' | 'world-icon') => (
    buildWorkbenchWorldImageContext(snapshot, visualPrompt, target)
  );

  const openCharacterCardImport = () => {
    navigate(`/workbench/${workspaceId}/import/character-card`);
  };

  const openNovelImport = () => {
    navigate(`/workbench/${workspaceId}/import/novel`);
  };

  const openAgentDraft = (draftAgentId: string) => {
    navigate(`/workbench/${workspaceId}/agents/${draftAgentId}`);
  };

  const handlePublish = async () => {
    setPublishError(null);
    if (!userId) {
      setPublishError('Authenticated user is required before official publish.');
      return;
    }
    if (!reviewReady) {
      setPublishError('Review guards must pass before official publish.');
      return;
    }
    if (completenessIssues.length > 0) {
      setPublishError(completenessIssues[0] || 'Completeness gate failed.');
      return;
    }
    let batchRunId: string | null = null;
    let batchItemId: string | null = null;
    try {
      buildPublishPlan(workspaceId);
      const qualityGate = completenessIssues.length === 0
        ? {
            status: 'PASS' as const,
            findingCount: 0,
          }
        : {
            status: 'FAIL' as const,
            findingCount: completenessIssues.length,
            findings: completenessIssues,
          };
      const pkg = buildWorkbenchWorldPackage({
        workspaceId,
        userId,
        snapshot,
        publishContext,
      });
      const packageWorld = pkg.truth.world.record;
      const batchRun = await commitActions.createBatchRunMutation.mutateAsync({
        name: `${packageWorld.name} publish`,
        requestKey: `${workspaceId}:${pkg.meta.version}`,
        pipelineStages: ['workbench-completeness-gate', 'package-publish'],
        retryLimit: 1,
        executionNotes: 'Forge workbench package publish',
        items: [{
          slug: pkg.slug,
          sourceTitle: pkg.meta.sourceTitle,
          canonicalTitle: packageWorld.name,
          sourceMode: pkg.meta.sourceMode,
          worldId: snapshot.worldDraft.worldId ?? undefined,
          qualityGate,
        }],
      });
      const batchItem = batchRun.items[0];
      if (!batchItem) {
        throw new Error('FORGE_WORKBENCH_BATCH_ITEM_REQUIRED');
      }
      batchRunId = batchRun.id;
      batchItemId = batchItem.id;
      const result = await commitActions.publishPackageMutation.mutateAsync({
        package: pkg,
        governance: {
          officialOwnerId: userId,
          editorialOperatorId: userId,
          reviewerId: userId,
          publisherId: userId,
          publishActorId: userId,
          sourceProvenance: snapshot.worldDraft.sourceType === 'NOVEL' ? 'forge-file-source' : 'forge-text-source',
          reviewVerdict: 'approved',
          releaseTag: `workbench-${pkg.meta.version}`,
          releaseSummary: 'Forge workbench package publish',
          changeSummary: 'Workbench enriched official package publish',
        },
        operations: {
          batchRunId: batchRun.id,
          batchItemId: batchItem.id,
          qualityGate,
          titleLineageReason: 'Forge workbench package publish',
        },
      });
      markPublished(workspaceId, {
        worldId: result.worldId,
      });
      navigate(`/worlds/${result.worldId}/maintain`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (batchRunId && batchItemId) {
        try {
          await commitActions.reportBatchItemFailureMutation.mutateAsync({
            runId: batchRunId,
            itemId: batchItemId,
            payload: {
              reason: message,
              qualityGate: {
                status: 'FAIL',
                findingCount: 1,
                findings: [message],
              },
            },
          });
        } catch {
          // Surface the primary publish error below.
        }
      }
      setPublishError(message);
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      <WorkbenchPageSidebar
        snapshot={snapshot}
        panel={panel}
        onBack={() => navigate('/workbench')}
        onOpenPanel={openPanel}
      />

      <main className="min-w-0 flex-1 overflow-auto">
        {panel === 'OVERVIEW' ? (
          <WorkbenchPageOverviewPanel
            snapshot={snapshot}
            imageGen={imageGen}
            visualPrompt={visualPrompt}
            onVisualPromptChange={setVisualPrompt}
            onPatchWorldDraft={patchCurrentWorldDraft}
            onOpenPanel={openPanel}
            onOpenCharacterCardImport={openCharacterCardImport}
            onOpenNovelImport={openNovelImport}
            buildWorldImageContext={buildWorldImageContext}
          />
        ) : null}

        {panel === 'WORLD_TRUTH' ? (
          snapshot.worldDraft.worldId ? (
            <WorldMaintainPageView
              embedded
              worldIdOverride={snapshot.worldDraft.worldId}
              title={snapshot.workspace.title}
            />
          ) : (
            <WorldCreatePageView
              embedded
              resumeDraftId={snapshot.worldDraft.draftId || ''}
              title={snapshot.workspace.title}
            />
          )
        ) : null}

        {panel === 'ENRICHMENT' ? (
          <WorkbenchEnrichmentPanel workspaceId={workspaceId} />
        ) : null}

        {panel === 'IMPORT' ? (
          <WorkbenchPageImportPanel
            snapshot={snapshot}
            onOpenPanel={openPanel}
            onOpenCharacterCardImport={openCharacterCardImport}
            onOpenNovelImport={openNovelImport}
          />
        ) : null}

        {panel === 'REVIEW' ? (
          <WorkbenchPageReviewPanel
            snapshot={snapshot}
            reviewReady={reviewReady}
            onOpenPublish={() => openPanel('PUBLISH')}
            onOpenAgentDraft={openAgentDraft}
            onUpdateWorldRule={(index, patch) => updateReviewWorldRule(workspaceId, index, patch)}
            onUpdateAgentRule={(draftAgentId, index, patch) => updateReviewAgentRule(workspaceId, draftAgentId, index, patch)}
          />
        ) : null}

        {panel === 'AGENTS' ? (
          <WorkbenchPageAgentsPanel
            snapshot={snapshot}
            masterAgents={masterAgents}
            onOpenAgentDraft={openAgentDraft}
            onAttachMasterAgentClone={(input) => attachMasterAgentClone(workspaceId, input)}
          />
        ) : null}

        {panel === 'PUBLISH' ? (
          <WorkbenchPagePublishPanel
            snapshot={snapshot}
            userId={userId}
            publishReady={publishReady}
            publishPending={commitActions.publishPackageMutation.isPending}
            completenessIssues={completenessIssues}
            publishError={publishError}
            onPublish={() => void handlePublish()}
          />
        ) : null}
      </main>
    </div>
  );
}
