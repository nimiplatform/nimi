import { useTranslation } from 'react-i18next';
import { Surface, cn } from '@nimiplatform/kit/ui';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { describeRuntimeDaemonIssue } from './runtime-daemon-guidance';
import { Button, DaemonStatusBadge } from './runtime-config-primitives';
import {
  StatusDot,
  TOKEN_PANEL_CARD,
  TOKEN_TEXT_MUTED,
  TOKEN_TEXT_PRIMARY,
  TOKEN_TEXT_SECONDARY,
  TONE_STYLES,
} from './runtime-config-runtime-page-ui';
import { ServerIcon } from './runtime-config-diagnostics-icons';

function DaemonMetaItem({ label, value, mono = false }: { label: string; value: string | number; mono?: boolean }) {
  const text = String(value);
  return (
    <div className="min-w-0">
      <p className={cn('text-[length:var(--nimi-type-caption-size)] font-medium uppercase tracking-[var(--nimi-type-overline-letter-spacing)]', TOKEN_TEXT_MUTED)}>{label}</p>
      <p className={cn('mt-1 truncate text-sm', mono && 'font-mono', TOKEN_TEXT_PRIMARY)} title={text}>{text}</p>
    </div>
  );
}

/**
 * Runtime daemon service card: status, start/restart/refresh, and the issue
 * projection. This is the only daemon lifecycle surface; there is no stop
 * action by design.
 */
export function RuntimeDaemonServiceCard(props: {
  readonly model: Pick<RuntimeConfigPanelControllerModel,
    | 'runtimeDaemonStatus'
    | 'runtimeDaemonBusyAction'
    | 'runtimeDaemonError'
    | 'runtimeDaemonUpdatedAt'
    | 'refreshRuntimeDaemonStatus'
    | 'startRuntimeDaemon'
    | 'restartRuntimeDaemon'>;
}) {
  const { model } = props;
  const i18n = useDesktopI18nResource();
  const { t } = useTranslation();
  const daemonRunning = model.runtimeDaemonStatus?.running === true;
  const daemonBusy = model.runtimeDaemonBusyAction !== null;
  const daemonIssue = describeRuntimeDaemonIssue({
    status: model.runtimeDaemonStatus,
    runtimeDaemonError: model.runtimeDaemonError,
  }, t);
  const daemonToneStyle = TONE_STYLES[daemonRunning ? 'success' : 'danger'];

  return (
    <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'relative overflow-hidden')} data-testid="runtime-daemon-service-card">
      <div className="relative flex min-w-0 flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl', daemonToneStyle.surface, daemonToneStyle.subtleText)}>
            <ServerIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className={cn('truncate text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>
                {t('runtimeConfig.overview.runtimeDaemonTitle', { defaultValue: 'Runtime Daemon' })}
              </h2>
              <DaemonStatusBadge running={daemonRunning} />
            </div>
            <p className={cn('mt-0.5 flex items-center gap-1.5 text-xs', TOKEN_TEXT_SECONDARY)}>
              <StatusDot tone={daemonRunning ? 'success' : 'danger'} />
              {t('runtimeConfig.overview.runtimeDaemonStatus', { defaultValue: 'Local AI runtime daemon status' })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button data-testid="runtime-service-refresh" variant="secondary" size="sm" disabled={daemonBusy} onClick={() => void model.refreshRuntimeDaemonStatus()}>
            {daemonBusy
              ? t('runtimeConfig.overview.working', { defaultValue: 'Working...' })
              : t('runtimeConfig.overview.refresh', { defaultValue: 'Refresh' })}
          </Button>
          <Button variant="secondary" size="sm" disabled={daemonBusy || daemonRunning} onClick={() => void model.startRuntimeDaemon()}>
            {t('runtimeConfig.overview.start', { defaultValue: 'Start' })}
          </Button>
          <Button data-testid="runtime-service-restart" variant="secondary" size="sm" disabled={daemonBusy || !daemonRunning} onClick={() => void model.restartRuntimeDaemon()}>
            {t('runtimeConfig.overview.restart', { defaultValue: 'Restart' })}
          </Button>
        </div>
      </div>

      <div className="relative mx-5 mt-4 grid grid-cols-1 gap-x-4 gap-y-3 border-t border-[var(--nimi-border-subtle)] py-3.5 sm:grid-cols-3">
        <DaemonMetaItem
          label={t('runtimeConfig.overview.grpc', { defaultValue: 'gRPC' })}
          value={model.runtimeDaemonStatus?.grpcAddr || '—'}
          mono
        />
        <DaemonMetaItem
          label={t('runtimeConfig.overview.pid', { defaultValue: 'PID' })}
          value={model.runtimeDaemonStatus?.pid || '-'}
          mono
        />
        <DaemonMetaItem
          label={t('runtimeConfig.overview.lastCheck', { defaultValue: 'Last check' })}
          value={model.runtimeDaemonUpdatedAt ? i18n.formatDateTime(model.runtimeDaemonUpdatedAt) : '-'}
        />
      </div>

      {daemonIssue ? (
        <div className="relative mx-5 mb-4 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] px-3 py-3">
          <p className="text-sm font-medium text-[var(--nimi-status-warning)]">{daemonIssue.title}</p>
          <p className="mt-1 text-xs text-[color-mix(in_srgb,var(--nimi-status-warning)_80%,var(--nimi-text-secondary))]">{daemonIssue.message}</p>
          <p className="mt-2 text-[length:var(--nimi-type-caption-size)] break-words [overflow-wrap:anywhere] text-[color-mix(in_srgb,var(--nimi-status-warning)_75%,var(--nimi-text-secondary))]">{daemonIssue.rawError}</p>
        </div>
      ) : model.runtimeDaemonError ? (
        <p className="relative mx-5 mb-4 text-xs text-[var(--nimi-status-danger)]">{model.runtimeDaemonError}</p>
      ) : null}
    </Surface>
  );
}
