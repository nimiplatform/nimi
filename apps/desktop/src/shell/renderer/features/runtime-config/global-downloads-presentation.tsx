import { ProgressIndicator } from '@nimiplatform/kit/ui';
import type {
  NimiRuntimeLocalEnvironmentDependencyJob,
  NimiRuntimeLocalTransferSessionSummary,
  NimiRuntimeLocalVerifiedAssetDescriptor,
} from '@nimiplatform/sdk/runtime';
import { isNimiRuntimeLocalEnvironmentDependencyJobActiveState } from '@nimiplatform/sdk/runtime';
import { AppPackageJobPhase } from '@nimiplatform/sdk/runtime/wire-types';
import { CircleAlert, LoaderCircle, PauseCircle, Settings2 } from 'lucide-react';
import type { PropsWithChildren, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes, formatDurationShort, formatTransferRate } from '../../components/download-format.js';
import { IdentityTile } from '../../components/identity-tile.js';
import { loadoutModelPresentation } from './runtime-config-loadout-model-display.js';
import type { RuntimeSetupTask } from './runtime-setup-task-store.js';

export type DownloadsLane = 'active' | 'attention' | 'history';
export function transferLane(state: NimiRuntimeLocalTransferSessionSummary['state']): DownloadsLane {
  return state === 'failed'
    ? 'attention'
    : state === 'completed' || state === 'cancelled'
      ? 'history'
      : 'active';
}
export function environmentLane(item: NimiRuntimeLocalEnvironmentDependencyJob): DownloadsLane {
  return isNimiRuntimeLocalEnvironmentDependencyJobActiveState(item.state)
    ? 'active'
    : ['failed', 'blocked', 'unsupported'].includes(item.state)
      ? 'attention'
      : 'history';
}
export function appJobLane(phase: AppPackageJobPhase): DownloadsLane {
  return phase === AppPackageJobPhase.FAILED
    ? 'attention'
    : [AppPackageJobPhase.COMPLETED, AppPackageJobPhase.CANCELED].includes(phase)
      ? 'history'
      : 'active';
}
export function setupTaskLane(task: RuntimeSetupTask): DownloadsLane {
  return ['failed', 'needs-attention'].includes(task.status)
    ? 'attention'
    : ['done', 'stopped'].includes(task.status)
      ? 'history'
      : 'active';
}
export function downloadModelName(
  modelId: string,
  catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[],
): string | null {
  const item = catalog.find(
    (item) => item.logicalModelId === modelId || item.templateId === modelId || item.assetId === modelId,
  );
  return item ? loadoutModelPresentation({ title: item.title, variantLabel: item.entry }).headline : null;
}

/**
 * Only revisions of one operation share an identity. A source label, final
 * asset or conflict relationship never merges independent operations.
 */
export function groupTransferAttempts(
  transfers: readonly NimiRuntimeLocalTransferSessionSummary[],
): readonly { latest: NimiRuntimeLocalTransferSessionSummary; attempts: readonly NimiRuntimeLocalTransferSessionSummary[] }[] {
  const byModel = new Map<string, NimiRuntimeLocalTransferSessionSummary[]>();
  for (const item of transfers) {
    const key = item.installSessionId;
    byModel.set(key, [...(byModel.get(key) ?? []), item]);
  }
  return [...byModel.values()].map((attempts) => {
    const sorted = [...attempts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return { latest: sorted[0]!, attempts: sorted };
  });
}

export type DownloadStage = 'queued' | 'downloading' | 'verifying' | 'installing' | 'paused' | 'done' | 'interrupted' | 'cancelled';

export function transferStage(item: Pick<NimiRuntimeLocalTransferSessionSummary, 'state' | 'phase'>): DownloadStage {
  if (item.state === 'completed') return 'done';
  if (item.state === 'cancelled') return 'cancelled';
  if (item.state === 'failed') return 'interrupted';
  if (item.state === 'paused') return 'paused';
  if (item.state === 'queued') return 'queued';
  if (item.phase === 'verify' || item.phase === 'scan') return 'verifying';
  return item.phase === 'register' ? 'installing' : 'downloading';
}

export function environmentStage(item: Pick<NimiRuntimeLocalEnvironmentDependencyJob, 'state'>): DownloadStage {
  if (item.state === 'queued') return 'queued';
  if (item.state === 'downloading') return 'downloading';
  if (item.state === 'verifying') return 'verifying';
  if (item.state === 'installing') return 'installing';
  if (item.state === 'cancelled') return 'cancelled';
  if (['failed', 'blocked', 'unsupported'].includes(item.state)) return 'interrupted';
  return 'done';
}

/** Plain-language reason for an interrupted transfer; raw text stays in details. */
export function interruptionReasonKey(raw: string | undefined): string {
  const text = (raw ?? '').toLowerCase();
  if (!text) return 'runtimeConfig.downloads.reason.unknown';
  if (text.includes('no space') || text.includes('enospc') || text.includes('disk full')) return 'runtimeConfig.downloads.reason.disk';
  if (text.includes('checksum') || text.includes('hash') || text.includes('verif')) return 'runtimeConfig.downloads.reason.verify';
  if (text.includes('context canceled') || text.includes('cancel')) return 'runtimeConfig.downloads.reason.stopped';
  if (text.includes('timeout') || text.includes('network') || text.includes('connection') || text.includes('econn') || text.includes('eof') || text.includes('reset'))
    return 'runtimeConfig.downloads.reason.network';
  if (text.includes('403') || text.includes('401') || text.includes('unauthorized') || text.includes('forbidden')) return 'runtimeConfig.downloads.reason.forbidden';
  if (text.includes('404') || text.includes('not found')) return 'runtimeConfig.downloads.reason.missing';
  return 'runtimeConfig.downloads.reason.unknown';
}

export function DownloadTaskRow(
  props: PropsWithChildren<{
    title: string;
    kind: 'model' | 'app' | 'environment';
    stage: DownloadStage;
    lane: DownloadsLane;
    bytes: number;
    total?: number;
    speedBytesPerSec?: number;
    etaSeconds?: number;
    reason?: string;
    technical?: string;
    at?: string;
    attempts?: number;
    testId: string;
    /** A real face for the object: app artwork, model tile, component tile. */
    leading?: ReactNode;
  }>,
) {
  const { t } = useTranslation();
  const stamp = props.at ? new Date(props.at) : null;
  const date = stamp && Number.isFinite(stamp.getTime()) ? stamp.toLocaleString() : '';
  const active = props.lane === 'active';
  const stageLabel = t(`runtimeConfig.downloads.stage.${props.stage}`);
  const StageIcon = props.stage === 'interrupted' ? CircleAlert : props.stage === 'paused' ? PauseCircle : active ? LoaderCircle : null;
  const known = typeof props.total === 'number' && props.total > 0;
  return (
    <article
      id={props.testId}
      tabIndex={-1}
      className="flex gap-3 border-b border-[var(--nimi-border-subtle)] py-4 last:border-b-0 sm:gap-4"
      data-testid={props.testId}
    >
      {props.leading ?? <IdentityTile seed={props.title} label={props.title} size="md" icon={props.kind === 'environment' ? Settings2 : undefined} className="mt-0.5" />}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="break-words text-sm font-semibold">{props.title}</h3>
            <p className="mt-0.5 text-xs text-[var(--nimi-text-secondary)]">
              {t(`runtimeConfig.product.downloadKind.${props.kind}`)}
              {date ? ` · ${date}` : ''}
              {props.attempts && props.attempts > 1 ? ` · ${t('runtimeConfig.downloads.attempts', { count: props.attempts })}` : ''}
            </p>
          </div>
          <span
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${props.stage === 'interrupted' ? 'bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)]' : active ? 'bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info-soft-text)]' : 'bg-[var(--nimi-surface-active)] text-[var(--nimi-text-secondary)]'}`}
          >
            {StageIcon ? <StageIcon size={13} className={active && props.stage !== 'paused' ? 'animate-spin' : ''} /> : null}
            {stageLabel}
          </span>
        </div>
        {props.stage === 'interrupted' && props.reason ? (
          <p className="text-sm text-[var(--nimi-text-secondary)]">{props.reason}</p>
        ) : null}
        {active && known ? (
          <ProgressIndicator value={props.bytes} max={props.total} aria-label={props.title} showValue />
        ) : null}
        {props.stage === 'interrupted' && known && props.bytes > 0 ? (
          <ProgressIndicator value={props.bytes} max={props.total} aria-label={props.title} className="opacity-40" />
        ) : null}
        {props.bytes > 0 || known ? (
          <p className="flex flex-wrap gap-x-3 text-xs tabular-nums text-[var(--nimi-text-secondary)]">
            <span>
              {formatBytes(props.bytes)}
              {known ? ` / ${formatBytes(props.total)}` : ''}
            </span>
            {active && props.speedBytesPerSec ? <span>{formatTransferRate(props.speedBytesPerSec)}</span> : null}
            {active && props.etaSeconds ? <span>{t('runtimeConfig.setupTask.stages.eta', { time: formatDurationShort(props.etaSeconds) })}</span> : null}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {props.children}
          {props.technical ? (
            <details className="min-w-0 text-xs text-[var(--nimi-text-secondary)]">
              <summary className="cursor-pointer">{t('runtimeConfig.profiles.technicalDetails')}</summary>
              <p className="mt-2 max-w-2xl break-all whitespace-pre-wrap">{props.technical}</p>
            </details>
          ) : null}
        </div>
      </div>
    </article>
  );
}
