import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useState } from 'react';
import type { TFunction } from 'i18next';

import type { NimiRuntimeLocalTransferProgressEvent } from '@nimiplatform/sdk/runtime';
import {
  FolderOpenIcon,
  DownloadIcon,
} from './runtime-config-local-model-center-helpers';
import { DownloadMetrics } from '../../components/download-metrics.js';
import { Button } from './runtime-config-primitives';
import { downloadStateLabel, formatDownloadPhaseLabel, formatImportPhaseLabel, transferDisplayLabel } from './runtime-config-model-center-utils';
import { formatBytes } from '../../components/download-format.js';
import { ModelTransferRecoveryActions } from './model-transfer-recovery-actions.js';

type TransferCardProps = {
  event: NimiRuntimeLocalTransferProgressEvent;
  observedAt?: number;
  t: TFunction;
  runtimeWritesDisabled: boolean;
  onPause: (installSessionId: string) => void;
  onResume: (installSessionId: string) => void;
  onCancel: (installSessionId: string) => void;
  onDismiss: (installSessionId: string) => void;
  onReimport?: () => void;
};

// Every control is rendered only from the Runtime's typed available_actions;
// paused/retryable alone never implies that a task can continue.
function hasTransferAction(event: NimiRuntimeLocalTransferProgressEvent, action: NimiRuntimeLocalTransferProgressEvent['availableActions'][number]): boolean {
  return event.availableActions.includes(action);
}

function TransferReuseNote({ event, t }: { event: NimiRuntimeLocalTransferProgressEvent; t: TFunction }) {
  if (!event.bytesReused && !event.relatedInstallSessionId && !event.cleanupPending) return null;
  return (
    <div className="mb-2 space-y-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
      {event.bytesReused ? (
        <p>{t('runtimeConfig.localModelCenter.reusedBytes', { size: formatBytes(event.bytesReused), defaultValue: '{{size}} reused from local content' })}</p>
      ) : null}
      {event.relatedInstallSessionId ? (
        <p>{t('runtimeConfig.localModelCenter.relatedTransfer', { defaultValue: 'Another task already owns this content; continue that task first.' })}</p>
      ) : null}
      {event.cleanupPending ? (
        <p>{t('runtimeConfig.localModelCenter.cleanupPending', { defaultValue: 'Temporary files are still being released.' })}</p>
      ) : null}
    </div>
  );
}

function LocalTransferDownloadCard(props: TransferCardProps) {
  const { event, t } = props;
  const isRunning = event.state === 'running';
  const isPaused = event.state === 'paused';
  const isFailed = event.state === 'failed';
  const isCancelled = event.state === 'cancelled';
  const canPause = hasTransferAction(event, 'pause');
  const canResume = hasTransferAction(event, 'resume');
  const canCancel = hasTransferAction(event, 'cancel');
  const phaseLabel = formatDownloadPhaseLabel(event.phase, t);
  return (
    <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 shadow-[var(--nimi-elevation-base)]">
      <div className="mb-2 flex items-center gap-3">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isFailed ? 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] text-[var(--nimi-status-danger)]' : 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] text-[var(--nimi-action-primary-bg)]'}`}>
          <DownloadIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{transferDisplayLabel(event)}</p>
          <p className="text-xs text-[var(--nimi-text-muted)]">{phaseLabel}</p>
          {event.phase !== 'download' && event.message ? <p className="truncate text-[length:var(--nimi-type-caption-size)] text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">{event.message}</p> : null}
        </div>
        <span className={`rounded-full px-2 py-1 text-[length:var(--nimi-type-caption-size)] font-medium ${
          isFailed ? 'bg-[var(--nimi-status-danger-soft-bg)] text-[var(--nimi-status-danger-soft-text)]' :
          isPaused ? 'bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)]' :
          isRunning ? 'bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info-soft-text)]' :
          'bg-[var(--nimi-status-neutral-soft-bg)] text-[var(--nimi-status-neutral-soft-text)]'
        }`}>
          {downloadStateLabel(event.state, t)}
        </span>
        {isFailed || isCancelled ? (
          <button
            type="button"
            aria-label={t('runtimeConfig.localModelCenter.dismissTransfer', { defaultValue: 'Dismiss transfer' })}
            className="ml-1 rounded-md px-1.5 py-0.5 text-xs text-[var(--nimi-text-muted)] hover:bg-[var(--nimi-surface-hover)] hover:text-[var(--nimi-text-secondary)]"
            onClick={() => props.onDismiss(event.installSessionId)}
          >
            {'\u00d7'}
          </button>
        ) : null}
      </div>
      <div className="mb-3">
        <DownloadMetrics name={transferDisplayLabel(event)} received={event.bytesReceived + event.bytesReused} total={event.bytesTotal}
          speed={event.speedBytesPerSec} eta={event.etaSeconds} observedAt={props.observedAt}
          available={!props.runtimeWritesDisabled} transferring={isRunning && event.phase === 'download'}
          activity={event.phase === 'verify' || event.phase === 'scan' ? 'verify' : event.sessionKind === 'import' ? 'local' : 'download'}
          idleLabel={isPaused ? t('runtimeConfig.localModelCenter.downloadState.paused') : undefined} />
      </div>
      <TransferReuseNote event={event} t={t} />
      <div className="flex flex-wrap items-center gap-2">
        {canPause ? <button type="button" disabled={props.runtimeWritesDisabled} onClick={() => props.onPause(event.installSessionId)} className="rounded border border-[var(--nimi-border-subtle)] px-2 py-1 text-xs text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] disabled:opacity-50">{t('runtimeConfig.localModelCenter.pause', { defaultValue: 'Pause' })}</button> : null}
        {canResume ? <Button size="sm" disabled={props.runtimeWritesDisabled} onClick={() => props.onResume(event.installSessionId)}>{t('runtimeConfig.localModelCenter.resume', { defaultValue: 'Resume' })}</Button> : null}
        <ModelTransferRecoveryActions event={event} disabled={props.runtimeWritesDisabled} />
        {canCancel ? <button type="button" disabled={props.runtimeWritesDisabled} onClick={() => props.onCancel(event.installSessionId)} className="rounded border border-[var(--nimi-border-subtle)] px-2 py-1 text-xs text-[var(--nimi-text-secondary)] hover:border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] hover:text-[var(--nimi-status-danger)] disabled:opacity-50">{t('Common.cancel', { defaultValue: 'Cancel' })}</button> : null}
      </div>
    </div>
  );
}

function LocalTransferImportCard(props: TransferCardProps) {
  const { event, t } = props;
  const isRunning = event.state === 'running';
  const isPaused = event.state === 'paused';
  const isFailed = event.state === 'failed';
  const isCancelled = event.state === 'cancelled';
  const canPause = hasTransferAction(event, 'pause');
  const canResume = hasTransferAction(event, 'resume');
  const canCancel = hasTransferAction(event, 'cancel');
  const phaseLabel = formatImportPhaseLabel(event.phase, t);
  return (
    <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 shadow-[var(--nimi-elevation-base)]">
      <div className="mb-2 flex items-center gap-3">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isFailed ? 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] text-[var(--nimi-status-danger)]' : 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]'}`}>
          <FolderOpenIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{transferDisplayLabel(event)}</p>
          <p className="text-xs text-[var(--nimi-text-muted)]">{phaseLabel}</p>
          <p className="truncate text-[length:var(--nimi-type-caption-size)] text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">
            {event.message || t('runtimeConfig.localModelCenter.localImportSession', { defaultValue: 'Importing local file into managed storage.' })}
          </p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[length:var(--nimi-type-caption-size)] font-medium ${
          isFailed ? 'bg-[var(--nimi-status-danger-soft-bg)] text-[var(--nimi-status-danger-soft-text)]' :
          isPaused ? 'bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)]' :
          isRunning ? 'bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info-soft-text)]' :
          'bg-[var(--nimi-status-neutral-soft-bg)] text-[var(--nimi-status-neutral-soft-text)]'
        }`}>
          {downloadStateLabel(event.state, t)}
        </span>
        {isFailed || isCancelled ? (
          <button
            type="button"
            aria-label={t('runtimeConfig.localModelCenter.dismissTransfer', { defaultValue: 'Dismiss transfer' })}
            className="ml-1 rounded-md px-1.5 py-0.5 text-xs text-[var(--nimi-text-muted)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] hover:text-[var(--nimi-text-secondary)]"
            onClick={() => props.onDismiss(event.installSessionId)}
          >
            {'\u00d7'}
          </button>
        ) : null}
        {canPause ? (
          <button
            type="button"
            disabled={props.runtimeWritesDisabled}
            className="ml-1 rounded border border-[var(--nimi-border-subtle)] px-2 py-1 text-xs text-[var(--nimi-text-secondary)] disabled:opacity-50"
            onClick={() => props.onPause(event.installSessionId)}
          >
            {t('runtimeConfig.localModelCenter.pause', { defaultValue: 'Pause' })}
          </button>
        ) : null}
        {canResume ? (
          <Button size="sm" disabled={props.runtimeWritesDisabled} onClick={() => props.onResume(event.installSessionId)}>
            {t('runtimeConfig.localModelCenter.resume', { defaultValue: 'Resume' })}
          </Button>
        ) : null}
        <ModelTransferRecoveryActions event={event} disabled={props.runtimeWritesDisabled} />
        {canCancel ? (
          <button
            type="button"
            disabled={props.runtimeWritesDisabled}
            className="ml-1 rounded border border-[var(--nimi-border-subtle)] px-2 py-1 text-xs text-[var(--nimi-text-secondary)] hover:border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] hover:text-[var(--nimi-status-danger)] disabled:opacity-50"
            onClick={() => props.onCancel(event.installSessionId)}
          >
            {t('Common.cancel', { defaultValue: 'Cancel' })}
          </button>
        ) : null}
      </div>
      <div className="mb-3">
        <DownloadMetrics name={transferDisplayLabel(event)} received={event.phase === 'scan' || event.phase === 'verify' ? event.bytesVerified : event.bytesReceived + event.bytesReused} total={event.bytesTotal}
          speed={event.speedBytesPerSec} eta={event.etaSeconds} observedAt={props.observedAt}
          available={!props.runtimeWritesDisabled} transferring={isRunning && event.phase === 'copy'}
          activity={event.phase === 'verify' || event.phase === 'scan' ? 'verify' : 'local'}
          idleLabel={isPaused ? t('runtimeConfig.localModelCenter.downloadState.paused') : undefined} />
      </div>
      <TransferReuseNote event={event} t={t} />
    </div>
  );
}

type InProgressSectionProps = {
  downloads: NimiRuntimeLocalTransferProgressEvent[];
  observedAtBySessionId?: Readonly<Record<string, number>>;
  imports: NimiRuntimeLocalTransferProgressEvent[];
  terminalDownloads: NimiRuntimeLocalTransferProgressEvent[];
  terminalImports: NimiRuntimeLocalTransferProgressEvent[];
  runtimeWritesDisabled: boolean;
  onPause: (installSessionId: string) => void;
  onResume: (installSessionId: string) => void;
  onCancel: (installSessionId: string) => void;
  onDismiss: (installSessionId: string) => void;
  onReimport?: () => void;
};

function LocalModelCenterInProgressSection(props: InProgressSectionProps) {
  const i18n = useDesktopI18nResource().instance;
  const t = i18n.t.bind(i18n);
  const [recentOpen, setRecentOpen] = useState(false);
  const activeCount = props.downloads.length + props.imports.length;
  const terminalCount = props.terminalDownloads.length + props.terminalImports.length;
  if (activeCount === 0 && terminalCount === 0) {
    return null;
  }

  const clearAllTerminal = () => {
    for (const event of [...props.terminalDownloads, ...props.terminalImports]) {
      props.onDismiss(event.installSessionId);
    }
  };

  const transferCardCallbacks = {
    t,
    runtimeWritesDisabled: props.runtimeWritesDisabled,
    onPause: props.onPause,
    onResume: props.onResume,
    onCancel: props.onCancel,
    onDismiss: props.onDismiss,
    onReimport: props.onReimport,
  };

  return (
    <section className="overflow-visible rounded-2xl bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-raised)] ring-1 ring-[var(--nimi-border-subtle)]">
      <div className="flex items-center gap-3 border-b border-[var(--nimi-border-subtle)] px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] text-[var(--nimi-action-primary-bg)]">
          <DownloadIcon className="h-4 w-4" />
        </div>
        <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('runtimeConfig.localModelCenter.inProgress', { defaultValue: 'In Progress' })}
        </h3>
        {activeCount > 0 ? (
          <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[var(--nimi-action-primary-bg)]">
            {activeCount}
          </span>
        ) : null}
      </div>
      {activeCount > 0 ? (
        <div className="space-y-3 px-5 py-4">
          {props.downloads.map((event) => (
            <LocalTransferDownloadCard key={event.installSessionId} event={event} observedAt={props.observedAtBySessionId?.[event.installSessionId]} {...transferCardCallbacks} />
          ))}
          {props.imports.map((event) => (
            <LocalTransferImportCard key={event.installSessionId} event={event} observedAt={props.observedAtBySessionId?.[event.installSessionId]} {...transferCardCallbacks} />
          ))}
        </div>
      ) : null}
      {terminalCount > 0 ? (
        <div className={activeCount > 0 ? 'border-t border-[var(--nimi-border-subtle)]' : ''}>
          <div className="flex items-center justify-between px-5 py-3">
            <button
              type="button"
              onClick={() => setRecentOpen((value) => !value)}
              aria-expanded={recentOpen}
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]"
            >
              <span aria-hidden="true" className={`inline-block transition-transform ${recentOpen ? 'rotate-90' : ''}`}>{'\u25b8'}</span>
              {t('runtimeConfig.localModelCenter.recentTasks', {
                count: terminalCount,
                defaultValue: 'Recent Tasks ({{count}})',
              })}
            </button>
            <button
              type="button"
              onClick={clearAllTerminal}
              className="text-xs font-medium text-[var(--nimi-text-muted)] hover:text-[var(--nimi-status-danger)]"
            >
              {t('runtimeConfig.localModelCenter.clearAll', { defaultValue: 'Clear all' })}
            </button>
          </div>
          {recentOpen ? (
            <div className="space-y-3 px-5 pb-4">
              {props.terminalDownloads.map((event) => (
                <LocalTransferDownloadCard key={event.installSessionId} event={event} observedAt={props.observedAtBySessionId?.[event.installSessionId]} {...transferCardCallbacks} />
              ))}
              {props.terminalImports.map((event) => (
                <LocalTransferImportCard key={event.installSessionId} event={event} observedAt={props.observedAtBySessionId?.[event.installSessionId]} {...transferCardCallbacks} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export {
  LocalModelCenterInProgressSection,
};
