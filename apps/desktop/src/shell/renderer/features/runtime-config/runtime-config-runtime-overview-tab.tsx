import { useTranslation } from 'react-i18next';
import { Surface, cn } from '@nimiplatform/kit/ui';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { describeRuntimeDaemonIssue } from './runtime-daemon-guidance';
import {
  StatusDot,
  TOKEN_PANEL_CARD,
  TOKEN_TEXT_MUTED,
  TOKEN_TEXT_PRIMARY,
  TONE_STYLES,
} from './runtime-config-runtime-page-ui';

type RuntimeOverviewTabProps = {
  model: RuntimeConfigPanelControllerModel;
};

export function RuntimeOverviewTab({ model }: RuntimeOverviewTabProps) {
  const i18n = useDesktopI18nResource();
  const { t } = useTranslation();
  const daemonRunning = model.runtimeDaemonStatus?.running === true;
  const daemonIssue = describeRuntimeDaemonIssue({
    status: model.runtimeDaemonStatus,
    runtimeDaemonError: model.runtimeDaemonError,
  }, t);

  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'col-span-2 p-5')}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <StatusDot tone={daemonRunning ? 'success' : 'danger'} pulse={daemonRunning} />
                <h2 className={cn('text-base font-semibold', TOKEN_TEXT_PRIMARY)}>
                  {daemonRunning
                    ? t('runtimeConfig.runtime.daemonIsRunning', { defaultValue: 'Daemon is running' })
                    : t('runtimeConfig.runtime.daemonIsStopped', { defaultValue: 'Daemon is stopped' })}
                </h2>
              </div>
              {model.runtimeDaemonUpdatedAt ? (
                <p className={cn('mt-1.5 text-xs', TOKEN_TEXT_MUTED)}>
                  {t('runtimeConfig.overview.lastCheck', { defaultValue: 'Last check' })}
                  {': '}
                  {i18n.formatDateTime(model.runtimeDaemonUpdatedAt)}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Daemon lifecycle actions are single-homed on the Overview
                  page; this tab keeps the read-only projection and routes. */}
              <button
                type="button"
                data-testid="runtime-service-manage"
                onClick={() => model.onChangePage('overview')}
                className="text-[length:var(--nimi-type-body-sm-size)] font-medium text-[var(--nimi-action-primary-bg)] hover:underline"
              >
                {t('runtimeConfig.runtime.manageDaemon', { defaultValue: 'Manage in Overview' })}
              </button>
            </div>
          </div>

          {(() => {
            const toneStyle = TONE_STYLES[daemonRunning ? 'success' : 'danger'];
            const entries = [
              {
                key: 'grpc',
                label: t('runtimeConfig.runtime.grpcBind', { defaultValue: 'gRPC Bind' }),
                value: model.runtimeDaemonStatus?.grpcAddr || '-',
              },
              {
                key: 'pid',
                label: t('runtimeConfig.overview.pid', { defaultValue: 'PID' }),
                value: model.runtimeDaemonStatus?.pid ? String(model.runtimeDaemonStatus.pid) : '-',
              },
              {
                key: 'mode',
                label: t('runtimeConfig.runtime.mode', { defaultValue: 'Mode' }),
                value: model.runtimeDaemonStatus?.launchMode || '-',
              },
            ];
            return (
              <Surface
                tone="card"
                className={cn('mt-5 rounded-xl border px-5 py-4', toneStyle.surface)}
              >
                <div className="grid grid-cols-3 gap-4">
                  {entries.map((entry) => (
                    <div key={entry.key} className="min-w-0">
                      <p className={cn('text-[length:var(--nimi-type-caption-size)] font-medium uppercase tracking-[var(--nimi-type-overline-letter-spacing)]', TOKEN_TEXT_MUTED)}>{entry.label}</p>
                      <p className={cn('mt-1 truncate font-mono text-sm', TOKEN_TEXT_PRIMARY)}>
                        {entry.value}
                      </p>
                    </div>
                  ))}
                </div>
              </Surface>
            );
          })()}

          {daemonIssue ? (
            <div className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] px-3 py-3">
              <p className="text-sm font-medium text-[var(--nimi-status-warning)]">{daemonIssue.title}</p>
              <p className="mt-1 text-xs text-[color-mix(in_srgb,var(--nimi-status-warning)_80%,var(--nimi-text-secondary))]">{daemonIssue.message}</p>
              <p className="mt-2 text-[length:var(--nimi-type-caption-size)] text-[color-mix(in_srgb,var(--nimi-status-warning)_75%,var(--nimi-text-secondary))]">{daemonIssue.rawError}</p>
            </div>
          ) : model.runtimeDaemonError ? <p className="mt-4 text-xs text-[var(--nimi-status-danger)]">{model.runtimeDaemonError}</p> : null}
        </Surface>

        <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'group p-5')}>
          <p className={cn('text-[length:var(--nimi-type-caption-size)] font-semibold uppercase tracking-[var(--nimi-type-overline-letter-spacing)]', TOKEN_TEXT_MUTED)}>
            {t('runtimeConfig.runtime.localEndpointShort', { defaultValue: 'Runtime Endpoint' })}
          </p>
          <p className={cn('mt-3 break-all font-mono text-sm', TOKEN_TEXT_PRIMARY)}>
            {model.runtimeDaemonStatus?.grpcAddr || '-'}
          </p>
          <p className={cn('mt-3 text-xs', TOKEN_TEXT_MUTED)}>
            {t('runtimeConfig.runtime.endpointProjectionCurrent', { defaultValue: 'Runtime service controls this endpoint.' })}
          </p>
        </Surface>
      </div>

    </>
  );
}
