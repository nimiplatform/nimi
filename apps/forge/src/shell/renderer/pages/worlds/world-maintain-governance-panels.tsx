import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgeEmptyState, ForgeLoadingSpinner } from '@renderer/components/page-layout.js';
import { ForgeStatusBadge } from '@renderer/components/status-indicators.js';
import type {
  ForgeOfficialFactoryBatchRun,
  ForgeOfficialWorldTitleLineage,
  ForgeWorldRelease,
} from '@renderer/data/world-data-client.js';

export type CompareAnchor = {
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

type WorldMaintainReleasePanelProps = {
  activeCompareAnchor: CompareAnchor | null;
  expandedReleases: Record<string, boolean>;
  latestReleaseId: string | null;
  releaseItems: ForgeWorldRelease[];
  releasesLoading: boolean;
  rollbackingReleaseId: string | null;
  onRollbackRelease: (releaseId: string, releaseVersion: number) => void;
  onToggleReleaseDetails: (releaseId: string) => void;
  registerReleaseCard: (releaseId: string, node: HTMLDivElement | null) => void;
};

function WorldMaintainReleasePanel({
  activeCompareAnchor,
  expandedReleases,
  latestReleaseId,
  releaseItems,
  releasesLoading,
  rollbackingReleaseId,
  onRollbackRelease,
  onToggleReleaseDetails,
  registerReleaseCard,
}: WorldMaintainReleasePanelProps) {
  return (
    <Surface tone="card" material="glass-regular" padding="md" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--nimi-text-primary)]">Official Releases</h2>
          <p className="text-xs text-[var(--nimi-text-muted)]">
            Governed publish history and rollback surface for this world.
          </p>
        </div>
        <span className="text-xs text-[var(--nimi-text-muted)]">{releaseItems.length} tracked</span>
      </div>
      {releasesLoading ? (
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
                  registerReleaseCard(release.id, node);
                }}
                className={`rounded-xl border bg-[color-mix(in_srgb,var(--nimi-surface-panel)_60%,transparent)] p-3 ${
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
                      onClick={() => onToggleReleaseDetails(release.id)}
                    >
                      {detailsExpanded ? 'Hide Details' : 'Show Details'}
                    </Button>
                    <Button
                      tone={isCurrent ? 'ghost' : 'secondary'}
                      size="sm"
                      disabled={isCurrent || rollbackingReleaseId !== null}
                      onClick={() => onRollbackRelease(release.id, release.version)}
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
  );
}

type WorldMaintainTitleLineagePanelProps = {
  activeCompareAnchor: CompareAnchor | null;
  titleLineageItems: ForgeOfficialWorldTitleLineage[];
  titleLineageLoading: boolean;
  onOpenLineageAnchor: (entry: ForgeOfficialWorldTitleLineage) => void;
};

function WorldMaintainTitleLineagePanel({
  activeCompareAnchor,
  titleLineageItems,
  titleLineageLoading,
  onOpenLineageAnchor,
}: WorldMaintainTitleLineagePanelProps) {
  return (
    <Surface tone="card" material="glass-regular" padding="md" className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-[var(--nimi-text-primary)]">Title Lineage</h2>
        <p className="text-xs text-[var(--nimi-text-muted)]">
          Canonical title tracking for compare and release operations.
        </p>
      </div>
      {titleLineageLoading ? (
        <ForgeLoadingSpinner />
      ) : titleLineageItems.length === 0 ? (
        <ForgeEmptyState message="No title lineage records yet." />
      ) : (
        <div className="space-y-2">
          {titleLineageItems.slice(0, 5).map((entry) => (
            <div
              key={entry.id}
              className={`rounded-xl border bg-[color-mix(in_srgb,var(--nimi-surface-panel)_60%,transparent)] p-3 ${
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
  );
}

type WorldMaintainBatchRunsPanelProps = {
  activeCompareAnchor: CompareAnchor | null;
  batchRunsLoading: boolean;
  expandedBatchRuns: Record<string, boolean>;
  relevantBatchRuns: ForgeOfficialFactoryBatchRun[];
  retryingBatchRunId: string | null;
  onRetryBatchRun: (runId: string) => void;
  onToggleBatchRunDetails: (runId: string) => void;
  registerBatchRunCard: (runId: string, node: HTMLDivElement | null) => void;
};

function WorldMaintainBatchRunsPanel({
  activeCompareAnchor,
  batchRunsLoading,
  expandedBatchRuns,
  relevantBatchRuns,
  retryingBatchRunId,
  onRetryBatchRun,
  onToggleBatchRunDetails,
  registerBatchRunCard,
}: WorldMaintainBatchRunsPanelProps) {
  return (
    <Surface tone="card" material="glass-regular" padding="md" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--nimi-text-primary)]">Factory Runs</h2>
          <p className="text-xs text-[var(--nimi-text-muted)]">
            Official batch execution records linked to this world.
          </p>
        </div>
        <span className="text-xs text-[var(--nimi-text-muted)]">{relevantBatchRuns.length} tracked</span>
      </div>
      {batchRunsLoading ? (
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
                  registerBatchRunCard(run.id, node);
                }}
                className={`rounded-xl border bg-[color-mix(in_srgb,var(--nimi-surface-panel)_60%,transparent)] p-3 ${
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
                      onClick={() => onToggleBatchRunDetails(run.id)}
                    >
                      {detailsExpanded ? 'Hide Details' : 'Show Details'}
                    </Button>
                    <Button
                      tone="secondary"
                      size="sm"
                      disabled={!retryable || retryingBatchRunId !== null}
                      onClick={() => onRetryBatchRun(run.id)}
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
                            className="rounded-lg border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_45%,transparent)] p-3"
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
  );
}

type WorldMaintainGovernancePanelsProps = {
  activeCompareAnchor: CompareAnchor | null;
  batchRunsLoading: boolean;
  expandedBatchRuns: Record<string, boolean>;
  expandedReleases: Record<string, boolean>;
  latestReleaseId: string | null;
  registerBatchRunCard: (runId: string, node: HTMLDivElement | null) => void;
  registerReleaseCard: (releaseId: string, node: HTMLDivElement | null) => void;
  releaseItems: ForgeWorldRelease[];
  releasesLoading: boolean;
  relevantBatchRuns: ForgeOfficialFactoryBatchRun[];
  retryingBatchRunId: string | null;
  rollbackingReleaseId: string | null;
  titleLineageItems: ForgeOfficialWorldTitleLineage[];
  titleLineageLoading: boolean;
  onOpenLineageAnchor: (entry: ForgeOfficialWorldTitleLineage) => void;
  onRetryBatchRun: (runId: string) => void;
  onRollbackRelease: (releaseId: string, releaseVersion: number) => void;
  onToggleBatchRunDetails: (runId: string) => void;
  onToggleReleaseDetails: (releaseId: string) => void;
};

export function WorldMaintainGovernancePanels({
  activeCompareAnchor,
  batchRunsLoading,
  expandedBatchRuns,
  expandedReleases,
  latestReleaseId,
  registerBatchRunCard,
  registerReleaseCard,
  releaseItems,
  releasesLoading,
  relevantBatchRuns,
  retryingBatchRunId,
  rollbackingReleaseId,
  titleLineageItems,
  titleLineageLoading,
  onOpenLineageAnchor,
  onRetryBatchRun,
  onRollbackRelease,
  onToggleBatchRunDetails,
  onToggleReleaseDetails,
}: WorldMaintainGovernancePanelsProps) {
  return (
    <>
      <div className="grid gap-4 border-b border-[var(--nimi-border-subtle)] px-4 py-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <WorldMaintainReleasePanel
          activeCompareAnchor={activeCompareAnchor}
          expandedReleases={expandedReleases}
          latestReleaseId={latestReleaseId}
          releaseItems={releaseItems}
          releasesLoading={releasesLoading}
          rollbackingReleaseId={rollbackingReleaseId}
          onRollbackRelease={onRollbackRelease}
          onToggleReleaseDetails={onToggleReleaseDetails}
          registerReleaseCard={registerReleaseCard}
        />
        <WorldMaintainTitleLineagePanel
          activeCompareAnchor={activeCompareAnchor}
          titleLineageItems={titleLineageItems}
          titleLineageLoading={titleLineageLoading}
          onOpenLineageAnchor={onOpenLineageAnchor}
        />
      </div>

      <div className="border-b border-[var(--nimi-border-subtle)] px-4 py-4">
        <WorldMaintainBatchRunsPanel
          activeCompareAnchor={activeCompareAnchor}
          batchRunsLoading={batchRunsLoading}
          expandedBatchRuns={expandedBatchRuns}
          relevantBatchRuns={relevantBatchRuns}
          retryingBatchRunId={retryingBatchRunId}
          onRetryBatchRun={onRetryBatchRun}
          onToggleBatchRunDetails={onToggleBatchRunDetails}
          registerBatchRunCard={registerBatchRunCard}
        />
      </div>
    </>
  );
}
