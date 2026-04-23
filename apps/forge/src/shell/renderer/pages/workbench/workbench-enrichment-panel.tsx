import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { ForgeEmptyState } from '@renderer/components/page-layout.js';
import { ForgeEntityAvatar } from '@renderer/components/card-list.js';
import { formatDate } from '@renderer/components/format-utils.js';
import { useWorldOwnedAgentRosterQuery } from '@renderer/hooks/use-agent-queries.js';
import { useWorldResourceQueries } from '@renderer/hooks/use-world-queries.js';
import { useAssetOpsBatchQueue } from '@renderer/hooks/use-asset-ops-batch-queue.js';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';
import {
  resolveWorkbenchAgentPublishAssets,
  resolveWorkbenchWorldPublishAssets,
} from './workbench-asset-publish.js';

export function WorkbenchEnrichmentPanel({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const userId = useAppStore((state) => state.auth?.user?.id ?? '');
  const snapshot = useForgeWorkspaceStore((state) => state.workspaces[workspaceId]);
  const batchQueue = useAssetOpsBatchQueue(workspaceId);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const worldId = snapshot?.worldDraft.worldId ?? '';
  const worldResourceQueries = useWorldResourceQueries({
    enabled: Boolean(worldId),
    worldId,
    enableCollections: false,
    enableGovernance: false,
  });
  const worldOwnedAgentRosterQuery = useWorldOwnedAgentRosterQuery(worldId, Boolean(worldId));

  if (!snapshot) {
    return <ForgeEmptyState message="Workspace not found." />;
  }

  const publishContext = useMemo(() => ({
    worldDeliverables: worldResourceQueries.worldDeliverables,
    agentRoster: worldOwnedAgentRosterQuery.data ?? null,
  }), [worldOwnedAgentRosterQuery.data, worldResourceQueries.worldDeliverables]);

  const worldAssets = useMemo(() => resolveWorkbenchWorldPublishAssets({
    worldDraft: snapshot.worldDraft,
    context: publishContext,
  }), [publishContext, snapshot.worldDraft]);

  const worldOwnedAgentDrafts = useMemo(
    () => Object.values(snapshot.agentDrafts).filter((draft) => draft.ownershipType === 'WORLD_OWNED'),
    [snapshot.agentDrafts],
  );
  const activeBatchRuns = batchQueue.runs.filter((run) => run.worldId === worldId || (!run.worldId && !worldId));

  const handleQueueWorldBatch = async () => {
    const result = batchQueue.queueMissingWorldDeliverables({
      workspaceId,
      worldDraft: snapshot.worldDraft,
      worldDeliverables: worldResourceQueries.worldDeliverables,
    });
    if (!result.run) {
      setBatchNotice('No missing world families to queue.');
      return;
    }
    setBatchNotice(
      `Queued ${result.counts.pendingCount} world batch item${result.counts.pendingCount === 1 ? '' : 's'}${result.counts.skippedCount ? ` · ${result.counts.skippedCount} skipped` : ''}.`,
    );
  };

  const handleQueueAgentBatch = async () => {
    const result = batchQueue.queueMissingAgentDeliverables({
      workspaceId,
      worldDraft: snapshot.worldDraft,
      agentDrafts: snapshot.agentDrafts,
      roster: worldOwnedAgentRosterQuery.data ?? null,
    });
    if (!result.run) {
      setBatchNotice('No missing agent deliverables to queue.');
      return;
    }
    setBatchNotice(
      `Queued ${result.counts.pendingCount} agent batch item${result.counts.pendingCount === 1 ? '' : 's'}${result.counts.skippedCount ? ` · ${result.counts.skippedCount} skipped` : ''}.`,
    );
  };

  return (
    <section className="mx-auto max-w-6xl space-y-6 p-8">
      <Surface tone="card" material="glass-regular" padding="md">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">Canonical Review Handoff</h2>
            <p className="mt-2 text-sm text-[var(--nimi-text-muted)]">
              Workbench enrichment no longer batch-generates final publish truth. Use the dedicated world and agent asset ops surfaces to review, confirm, and bind publish-facing assets.
            </p>
            <p className="mt-3 text-xs uppercase tracking-[0.18em] text-[var(--nimi-text-muted)]">
              Updated {formatDate(snapshot.updatedAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              tone="secondary"
              size="sm"
              onClick={() => navigate(`/workbench/${workspaceId}?panel=WORLD_TRUTH`)}
            >
              Open World Editor
            </Button>
            {worldId ? (
              <Button
                tone="primary"
                size="sm"
                onClick={() => navigate(`/worlds/${worldId}/assets`)}
              >
                Open World Asset Hub
              </Button>
            ) : null}
          </div>
        </div>
      </Surface>

      <Surface tone="card" material="glass-thin" padding="md">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--nimi-text-secondary)]">
              Batch Handoff Queue
            </h3>
            <p className="mt-2 text-sm text-[var(--nimi-text-muted)]">
              Batch generation now queues explicit asset-ops tasks. It generates candidates into canonical review flows only; it does not auto-approve, auto-confirm, or auto-bind.
            </p>
            {batchNotice ? (
              <p className="mt-3 text-sm text-[var(--nimi-text-secondary)]">{batchNotice}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              tone="secondary"
              size="sm"
              onClick={() => void handleQueueWorldBatch()}
              disabled={!worldId || worldResourceQueries.resourceBindingsQuery.isPending}
            >
              Queue Missing World Families
            </Button>
            <Button
              tone="primary"
              size="sm"
              onClick={() => void handleQueueAgentBatch()}
              disabled={!worldId || worldOwnedAgentRosterQuery.isPending}
            >
              Queue Missing Agent Deliverables
            </Button>
          </div>
        </div>

        {activeBatchRuns.length > 0 ? (
          <div className="mt-5 space-y-3">
            {activeBatchRuns.map((run) => (
              <Surface key={run.id} tone="panel" padding="sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{run.label}</p>
                    <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                      {run.status} · pending {run.items.filter((item) => item.status === 'PENDING').length}
                      {' '}· running {run.items.filter((item) => item.status === 'RUNNING').length}
                      {' '}· succeeded {run.items.filter((item) => item.status === 'SUCCEEDED').length}
                      {' '}· failed {run.items.filter((item) => item.status === 'FAILED').length}
                      {' '}· skipped {run.items.filter((item) => item.status === 'SKIPPED').length}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {run.status === 'PENDING' ? (
                      <Button tone="secondary" size="sm" onClick={() => void batchQueue.resumeRun(run.id)}>
                        Resume Queue
                      </Button>
                    ) : null}
                    {run.items.some((item) => item.status === 'FAILED') ? (
                      <Button tone="secondary" size="sm" onClick={() => void batchQueue.retryRun(run.id)}>
                        Retry Failed
                      </Button>
                    ) : null}
                    {run.status === 'SUCCEEDED' || run.status === 'FAILED' ? (
                      <Button tone="ghost" size="sm" onClick={() => batchQueue.clearRun(run.id)}>
                        Clear Run
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  {run.items.slice(0, 8).map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-[var(--nimi-text-primary)]">{item.label}</p>
                        <span className="rounded-full bg-[var(--nimi-surface-panel)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--nimi-text-secondary)]">
                          {item.status}
                        </span>
                      </div>
                      {item.lastError ? (
                        <p className="mt-2 text-xs text-[var(--nimi-status-danger)]">{item.lastError}</p>
                      ) : item.resultSummary ? (
                        <p className="mt-2 text-xs text-[var(--nimi-text-muted)]">{item.resultSummary}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </Surface>
            ))}
          </div>
        ) : (
          <div className="mt-5">
            <ForgeEmptyState message="No asset-ops batch runs for this workspace yet." />
          </div>
        )}
      </Surface>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <Surface tone="card" material="glass-regular" padding="md">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--nimi-text-secondary)]">
                World Asset Review
              </h3>
              <p className="mt-2 text-sm text-[var(--nimi-text-muted)]">
                Cover and icon publish readiness now come from the canonical world asset ops flow.
              </p>
            </div>
            {worldId ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  tone="ghost"
                  size="sm"
                  onClick={() => navigate(`/content/images?target=world-banner&worldId=${worldId}&worldName=${encodeURIComponent(snapshot.worldDraft.name || snapshot.workspace.title)}`)}
                >
                  Create Cover Candidate
                </Button>
                <Button
                  tone="ghost"
                  size="sm"
                  onClick={() => navigate(`/content/images?target=world-icon&worldId=${worldId}&worldName=${encodeURIComponent(snapshot.worldDraft.name || snapshot.workspace.title)}`)}
                >
                  Create Icon Candidate
                </Button>
              </div>
            ) : null}
          </div>

          {!worldId ? (
            <ForgeEmptyState message="Save or create the world first, then review cover and icon from the canonical world asset hub." />
          ) : null}

          {worldId ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <AssetCard
                label="Cover"
                status={
                  worldResourceQueries.resourceBindingsQuery.isPending
                    ? 'Checking...'
                    : worldAssets.coverUrl && worldAssets.coverResourceId
                      ? 'Bound'
                      : 'Needs Review'
                }
                previewUrl={worldAssets.coverUrl || snapshot.worldDraft.bannerUrl}
                emptyLabel="No canonical cover bound yet"
                issues={worldAssets.issues.filter((issue) => issue.toLowerCase().includes('cover'))}
              />
              <AssetCard
                label="Icon"
                status={
                  worldResourceQueries.resourceBindingsQuery.isPending
                    ? 'Checking...'
                    : worldAssets.iconUrl && worldAssets.iconResourceId
                      ? 'Bound'
                      : 'Needs Review'
                }
                previewUrl={worldAssets.iconUrl || snapshot.worldDraft.iconUrl}
                emptyLabel="No canonical icon bound yet"
                issues={worldAssets.issues.filter((issue) => issue.toLowerCase().includes('icon'))}
              />
            </div>
          ) : null}
        </Surface>

        <Surface tone="card" material="glass-thin" padding="md">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--nimi-text-secondary)]">
                Agent Asset Review
              </h3>
              <p className="mt-2 text-sm text-[var(--nimi-text-muted)]">
                Avatar, greeting, and voice demo must route through the canonical agent asset ops surfaces before publish.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {worldOwnedAgentDrafts.length === 0 ? (
              <ForgeEmptyState message="No world-owned draft agents yet." />
            ) : worldOwnedAgentDrafts.map((agentDraft) => {
              const publishAssets = resolveWorkbenchAgentPublishAssets({
                userId,
                agentDraft,
                context: publishContext,
              });
              const avatarBlocked = publishAssets.issues.some((issue) => issue.toLowerCase().includes('avatar'));
              const greetingBlocked = publishAssets.issues.some((issue) => issue.toLowerCase().includes('greeting'));
              const voiceDemoBlocked = publishAssets.issues.some((issue) => issue.toLowerCase().includes('voice demo'));
              const agentId = agentDraft.sourceAgentId ?? '';
              const studioQuery = agentId
                ? `/content/images?target=agent-avatar&agentId=${agentId}&agentName=${encodeURIComponent(agentDraft.displayName)}&worldId=${encodeURIComponent(worldId)}&worldName=${encodeURIComponent(snapshot.worldDraft.name || snapshot.workspace.title)}`
                : '';
              return (
                <Surface key={agentDraft.draftAgentId} tone="panel" padding="sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <ForgeEntityAvatar src={publishAssets.avatarUrl || agentDraft.avatarUrl} name={agentDraft.displayName} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">
                          {agentDraft.displayName}
                        </p>
                        <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                          @{agentDraft.handle}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        tone="secondary"
                        size="sm"
                        onClick={() => navigate(`/workbench/${workspaceId}/agents/${agentDraft.draftAgentId}`)}
                      >
                        Open Agent
                      </Button>
                      {agentId ? (
                        <Button
                          tone="primary"
                          size="sm"
                          onClick={() => navigate(`/agents/${agentId}/assets`)}
                        >
                          Open Asset Hub
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <StatusBlock
                      label="Avatar"
                      value={publishAssets.avatarUrl && !avatarBlocked ? 'Ready' : 'Needs Review'}
                      detail={publishAssets.avatarUrl && !avatarBlocked ? 'Canonical agent profile has an explicit bound avatar winner.' : 'Route avatar review through the agent asset hub.'}
                    />
                    <StatusBlock
                      label="Greeting"
                      value={publishAssets.greeting && !greetingBlocked ? 'Ready' : 'Needs Review'}
                      detail={publishAssets.greeting && !greetingBlocked ? publishAssets.greeting : 'Confirm a canonical greeting before publish.'}
                    />
                    <StatusBlock
                      label="Voice Demo"
                      value={publishAssets.voiceDemoUrl && publishAssets.voiceDemoResourceId && !voiceDemoBlocked ? 'Bound' : 'Needs Review'}
                      detail={
                        publishAssets.voiceDemoUrl && publishAssets.voiceDemoResourceId && !voiceDemoBlocked
                          ? publishAssets.voiceDemoResourceId
                          : 'Canonical voice-demo bind is required before publish.'
                      }
                    />
                  </div>

                  {publishAssets.issues.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {publishAssets.issues.map((issue) => (
                        <span
                          key={issue}
                          className="rounded-full bg-[var(--nimi-surface-canvas)] px-2 py-1 text-xs text-[var(--nimi-text-secondary)]"
                        >
                          {issue}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {agentId ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button tone="ghost" size="sm" onClick={() => navigate(studioQuery)}>
                        Create Avatar Candidate
                      </Button>
                      <Button tone="ghost" size="sm" onClick={() => navigate(`/agents/${agentId}/assets/agent-greeting-primary`)}>
                        Open Greeting Review
                      </Button>
                      <Button tone="ghost" size="sm" onClick={() => navigate(`/agents/${agentId}/assets/agent-voice-demo`)}>
                        Open Voice Demo Review
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-[var(--nimi-text-muted)]">
                      Create or link the world-owned agent record first. Asset review surfaces open only after the canonical agent id exists.
                    </p>
                  )}
                </Surface>
              );
            })}
          </div>
        </Surface>
      </div>
    </section>
  );
}

function AssetCard(input: {
  label: string;
  status: string;
  previewUrl: string | null;
  emptyLabel: string;
  issues: string[];
}) {
  return (
    <Surface tone="panel" padding="sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-[var(--nimi-text-primary)]">{input.label}</p>
        <span className="rounded-full bg-[var(--nimi-surface-canvas)] px-2 py-1 text-xs text-[var(--nimi-text-secondary)]">
          {input.status}
        </span>
      </div>
      <div className="mt-3 overflow-hidden rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)]">
        {input.previewUrl ? (
          <img
            src={input.previewUrl}
            alt=""
            className={`${input.label === 'Cover' ? 'aspect-video' : 'aspect-square'} w-full object-cover`}
          />
        ) : (
          <div className={`${input.label === 'Cover' ? 'aspect-video' : 'aspect-square'} flex items-center justify-center text-sm text-[var(--nimi-text-muted)]`}>
            {input.emptyLabel}
          </div>
        )}
      </div>
      {input.issues.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {input.issues.map((issue) => (
            <span
              key={issue}
              className="rounded-full bg-[var(--nimi-surface-canvas)] px-2 py-1 text-xs text-[var(--nimi-text-secondary)]"
            >
              {issue}
            </span>
          ))}
        </div>
      ) : null}
    </Surface>
  );
}

function StatusBlock(input: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] p-3">
      <p className="text-xs uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">{input.label}</p>
      <p className="mt-2 text-sm font-medium text-[var(--nimi-text-primary)]">{input.value}</p>
      <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{input.detail}</p>
    </div>
  );
}
