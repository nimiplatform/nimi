/**
 * World Create Page — CREATE pipeline wrapper (FG-WORLD-003)
 *
 * Imports World-Studio's CreateWorkbench via @world-engine alias,
 * wires it to Forge's creator-world-store and world-data-client.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { CreateWorkbench } from '@world-engine/ui/create/create-workbench.js';
import { useWorldCommitActions } from '@renderer/hooks/use-world-commit-actions.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { ForgeStatusBadge } from '@renderer/components/status-indicators.js';
import { useWorldCreatePageModel } from './world-create-page-controller.js';
import { WorldCreateRuleTruthPreview } from './world-create-rule-truth-preview.js';

type WorldCreatePageViewProps = {
  embedded?: boolean;
  resumeDraftId?: string;
  backTo?: string;
  title?: string;
};

export function WorldCreatePageView({
  embedded = false,
  resumeDraftId: resumeDraftIdProp,
  backTo = '/worlds/library',
  title,
}: WorldCreatePageViewProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const [searchParams] = useSearchParams();
  const resumeDraftId = resumeDraftIdProp ?? (searchParams.get('draftId') || '');
  const userId = useAppStore((state) => state.auth?.user?.id || '');
  const commitActions = useWorldCommitActions();
  const navigateWithinForge = (to: string) => {
    if (embedded && workspaceId && to.startsWith('/worlds/')) {
      const [, queryString = ''] = to.split('?');
      const next = new URLSearchParams(queryString);
      next.set('panel', 'WORLD_TRUTH');
      navigate(`/workbench/${workspaceId}?${next.toString()}`);
      return;
    }
    navigate(to);
  };
  const [operationsExpanded, setOperationsExpanded] = useState(false);

  const {
    actions,
    clearNotice,
    main,
    publishOperation,
    retryPublishOperation,
    routing,
    status,
    workflow,
  } = useWorldCreatePageModel({
    commitActions,
    navigate: navigateWithinForge,
    resumeDraftId,
    userId,
  });
  const retryablePublishItems = publishOperation.batchRun?.items.some((item) => item.status === 'FAILED' || item.status === 'SKIPPED') ?? false;
  const publishRetryWorking = commitActions.retryBatchRunMutation?.isPending
    || commitActions.publishPackageMutation?.isPending
    || commitActions.reportBatchItemFailureMutation?.isPending;
  const primaryPublishedItem = publishOperation.batchRun?.items.find((item) => item.releaseId) ?? publishOperation.batchRun?.items[0] ?? null;

  return (
    <div className="flex h-full flex-col">
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
              {title || t('pages.worldCreate', 'Create World')}
            </h1>
          </div>
        </div>
      ) : null}

      {publishOperation.batchRun ? (
        <div className="border-b border-[var(--nimi-border-subtle)] px-4 py-3">
          <Surface tone="card" material="glass-thin" padding="md" className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                    {publishOperation.batchRun.name}
                  </p>
                  <ForgeStatusBadge domain="generic" status={publishOperation.batchRun.status} />
                  {publishOperation.batchRun.qualityGateStatus ? (
                    <ForgeStatusBadge domain="generic" status={publishOperation.batchRun.qualityGateStatus} />
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                  run {publishOperation.batchRun.id.slice(0, 8)} · success {publishOperation.batchRun.successCount} · failed {publishOperation.batchRun.failureCount}
                </p>
                {publishOperation.batchRun.lastError ? (
                  <p className="mt-2 text-xs text-[var(--nimi-status-danger)]">
                    {publishOperation.batchRun.lastError}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  tone="ghost"
                  size="sm"
                  onClick={() => setOperationsExpanded((value) => !value)}
                >
                  {operationsExpanded ? 'Hide Details' : 'Show Details'}
                </Button>
                {publishOperation.publishedWorldId ? (
                  <Button
                    tone="secondary"
                    size="sm"
                    onClick={() => {
                      const next = new URLSearchParams();
                      if (primaryPublishedItem?.titleLineageKey) {
                        next.set('lineageKey', primaryPublishedItem.titleLineageKey);
                      }
                      if (primaryPublishedItem?.releaseId) {
                        next.set('releaseId', primaryPublishedItem.releaseId);
                      }
                      if (publishOperation.batchRun?.id) {
                        next.set('runId', publishOperation.batchRun.id);
                      }
                      const query = next.toString();
                      navigateWithinForge(`/worlds/${publishOperation.publishedWorldId}/maintain${query ? `?${query}` : ''}`);
                    }}
                  >
                    Open Release v{publishOperation.publishedReleaseVersion ?? '?'}
                  </Button>
                ) : retryablePublishItems ? (
                  <Button
                    tone="secondary"
                    size="sm"
                    disabled={Boolean(publishRetryWorking)}
                    onClick={() => void retryPublishOperation()}
                  >
                    {publishRetryWorking ? 'Retrying…' : 'Retry Failed'}
                  </Button>
                ) : null}
              </div>
            </div>
            {publishOperation.batchRun.items.length > 0 ? (
              <div className="space-y-2 border-t border-[var(--nimi-border-subtle)] pt-3">
                {publishOperation.batchRun.items.slice(0, 3).map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_60%,transparent)] p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-[var(--nimi-text-primary)]">
                            {item.canonicalTitle}
                          </p>
                          <ForgeStatusBadge domain="generic" status={item.status} />
                          {item.qualityGateStatus ? (
                            <ForgeStatusBadge domain="generic" status={item.qualityGateStatus} />
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                          retry {item.retryCount} · release {item.releaseVersion ?? 'pending'} · lineage {item.titleLineageKey}
                        </p>
                        {item.lastError ? (
                          <p className="mt-2 text-xs text-[var(--nimi-status-danger)]">
                            {item.lastError}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {operationsExpanded ? (
              <div className="space-y-3 border-t border-[var(--nimi-border-subtle)] pt-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--nimi-text-muted)]">
                    Pipeline Stages
                  </p>
                  <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                    {publishOperation.batchRun.pipelineStages.join(' -> ')}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--nimi-text-muted)]">
                    Quality Findings
                  </p>
                  {publishOperation.batchRun.qualityGateSummary?.findings?.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {publishOperation.batchRun.qualityGateSummary.findings.map((finding) => (
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
                    {publishOperation.batchRun.items.slice(0, 3).map((item) => (
                      <div
                        key={`${item.id}-details`}
                        className="rounded-lg border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_45%,transparent)] p-3"
                      >
                        <p className="text-xs text-[var(--nimi-text-muted)]">
                          slug {item.slug} · source {item.sourceMode}
                        </p>
                        <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                          package {item.packageVersion ?? 'pending'} · release {item.releaseId ?? 'pending'}
                        </p>
                        <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                          started {item.startedAt ?? 'not-started'} · finished {item.finishedAt ?? 'not-finished'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </Surface>
        </div>
      ) : null}

      {status.notice ? (
        <div className="flex items-center justify-between border-b border-[var(--nimi-status-warning)]/20 bg-[var(--nimi-status-warning)]/10 px-4 py-2 text-sm text-[var(--nimi-status-warning)]">
          <span>{status.notice}</span>
          <Button tone="ghost" size="sm" onClick={clearNotice}>
            &times;
          </Button>
        </div>
      ) : null}

      {workflow.createDisplayStage === 'REVIEW' ? (
        <WorldCreateRuleTruthPreview snapshot={main.snapshot} />
      ) : null}

      <div className="min-h-0 flex-1">
        <CreateWorkbench
          workflow={workflow}
          main={main}
          routing={routing}
          status={status}
          actions={actions}
        />
      </div>
    </div>
  );
}

export default function WorldCreatePage() {
  return <WorldCreatePageView />;
}
