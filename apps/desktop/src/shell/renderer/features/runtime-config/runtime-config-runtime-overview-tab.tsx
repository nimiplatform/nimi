import { useTranslation } from 'react-i18next';
import type { NimiRuntimeRouteCapabilityCoverageProjection } from '@nimiplatform/sdk/runtime';
import { Surface, StatusBadge as KitStatusBadge, cn } from '@nimiplatform/kit/ui';
import { desktopBridge } from '@renderer/bridge';
import { formatLocaleDateTime } from '@renderer/i18n';
import { SectionTitle } from '@renderer/features/settings/settings-layout-components';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { Button } from './runtime-config-primitives';
import { describeRuntimeDaemonIssue } from './runtime-daemon-guidance';
import {
  KeyIcon,
  IconButton,
  PlusIcon,
  StatusDot,
  TOKEN_PANEL_CARD,
  TOKEN_TEXT_MUTED,
  TOKEN_TEXT_PRIMARY,
  TOKEN_TEXT_SECONDARY,
  TONE_STYLES,
  type RuntimeTone,
} from './runtime-config-runtime-page-ui';

type RuntimeOverviewTabProps = {
  model: RuntimeConfigPanelControllerModel;
  capabilitySummary: NimiRuntimeRouteCapabilityCoverageProjection[];
  availableCapabilityCount: number;
  onOpenHealth: () => void;
};

export function RuntimeOverviewTab({
  model,
  capabilitySummary,
  availableCapabilityCount,
  onOpenHealth,
}: RuntimeOverviewTabProps) {
  const { t } = useTranslation();
  const daemonRunning = model.runtimeDaemonStatus?.running === true;
  const daemonBusy = model.runtimeDaemonBusyAction !== null;
  const canManageDaemon = desktopBridge.hasTauriInvoke();
  const daemonIssue = describeRuntimeDaemonIssue({
    status: model.runtimeDaemonStatus,
    runtimeDaemonError: model.runtimeDaemonError,
  });

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
                  {formatLocaleDateTime(model.runtimeDaemonUpdatedAt)}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button data-testid="runtime-service-refresh" variant="secondary" size="sm" disabled={daemonBusy} onClick={() => void model.refreshRuntimeDaemonStatus()}>
                {daemonBusy
                  ? t('runtimeConfig.overview.working', { defaultValue: 'Working...' })
                  : t('runtimeConfig.runtime.refresh', { defaultValue: 'Refresh' })}
              </Button>
              {daemonRunning ? (
                <Button data-testid="runtime-service-restart" variant="secondary" size="sm" disabled={!canManageDaemon || daemonBusy} onClick={() => void model.restartRuntimeDaemon()}>
                  {t('runtimeConfig.overview.restart', { defaultValue: 'Restart' })}
                </Button>
              ) : (
                <Button variant="secondary" size="sm" disabled={!canManageDaemon || daemonBusy} onClick={() => void model.startRuntimeDaemon()}>
                  {t('runtimeConfig.overview.start', { defaultValue: 'Start' })}
                </Button>
              )}
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
                      <p className={cn('text-[10px] font-medium uppercase tracking-[0.14em]', TOKEN_TEXT_MUTED)}>{entry.label}</p>
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
              <p className="mt-2 text-[11px] text-[color-mix(in_srgb,var(--nimi-status-warning)_75%,var(--nimi-text-secondary))]">{daemonIssue.rawError}</p>
            </div>
          ) : model.runtimeDaemonError ? <p className="mt-4 text-xs text-[var(--nimi-status-danger)]">{model.runtimeDaemonError}</p> : null}
        </Surface>

        <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'group p-5')}>
          <p className={cn('text-[10px] font-semibold uppercase tracking-[0.16em]', TOKEN_TEXT_MUTED)}>
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

      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <SectionTitle>
            {t('runtimeConfig.runtime.capabilities', { defaultValue: 'Capabilities' })}
          </SectionTitle>
          <span className={cn('text-xs', TOKEN_TEXT_MUTED)}>
            <span className={cn('font-medium', TOKEN_TEXT_PRIMARY)}>{availableCapabilityCount}</span>
            <span>{` / ${capabilitySummary.length} `}</span>
            {t('runtimeConfig.runtime.active', { defaultValue: 'active' })}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {capabilitySummary.map((item) => {
            const available = item.localAvailable || item.cloudAvailable;
            const errored = !available && Boolean(item.errorReason);
            const tone: RuntimeTone = item.localAvailable
              ? 'success'
              : item.cloudAvailable
                ? 'warning'
                : errored
                  ? 'danger'
                  : 'neutral';
            const toneStyle = TONE_STYLES[tone];

            if (available) {
              return (
                <Surface
                  key={`cap-runtime-${item.capability}`}
                  tone="card"
                  className={cn(
                    TOKEN_PANEL_CARD,
                    'flex min-h-[92px] flex-col border p-4 transition-all duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[0_12px_28px_rgba(15,23,42,0.08)]',
                    toneStyle.surface,
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <StatusDot tone={item.localAvailable ? 'success' : 'warning'} pulse={item.localAvailable} />
                      <span className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>{item.capability}</span>
                    </div>
                    <KitStatusBadge tone={toneStyle.badge}>
                      {item.localAvailable
                        ? t('runtimeConfig.runtime.badgeLocal', { defaultValue: 'local' })
                        : t('runtimeConfig.runtime.badgeCloud', { defaultValue: 'cloud' })}
                    </KitStatusBadge>
                  </div>
                  {item.localProvider ? (
                    <p className={cn('mt-3 text-xs', TOKEN_TEXT_SECONDARY)}>
                      <span className={TOKEN_TEXT_MUTED}>
                        {t('runtimeConfig.runtime.modelLabel', { defaultValue: 'Model' })}
                        {': '}
                      </span>
                      <span className={cn('font-mono', TOKEN_TEXT_PRIMARY)}>{item.localProvider}</span>
                    </p>
                  ) : null}
                </Surface>
              );
            }

            if (errored) {
              return (
                <Surface
                  key={`cap-runtime-${item.capability}`}
                  tone="card"
                  className={cn(
                    TOKEN_PANEL_CARD,
                    'flex min-h-[92px] flex-col border p-4 transition-all duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[0_14px_30px_rgba(220,38,38,0.12)]',
                    toneStyle.surface,
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <StatusDot tone="danger" pulse />
                      <span className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>{item.capability}</span>
                    </div>
                    <KitStatusBadge tone={toneStyle.badge}>
                      {t('runtimeConfig.runtime.badgeError', { defaultValue: 'error' })}
                    </KitStatusBadge>
                  </div>
                  <p className={cn('mt-2 text-xs', toneStyle.subtleText)}>
                    {item.errorReason}
                  </p>
                  <button
                    type="button"
                    onClick={onOpenHealth}
                    className={cn('mt-auto self-start pt-3 text-xs font-medium underline underline-offset-4 transition-colors hover:no-underline', toneStyle.subtleText)}
                  >
                    {t('runtimeConfig.runtime.viewLogs', { defaultValue: 'View logs' })}
                  </button>
                </Surface>
              );
            }

            return (
              <Surface
                key={`cap-runtime-${item.capability}`}
                tone="card"
                className={cn(
                  TOKEN_PANEL_CARD,
                  'group flex min-h-[92px] flex-col items-center justify-center border border-dashed p-4 text-center transition-all duration-200 ease-out hover:-translate-y-[1px] hover:border-solid hover:border-[color-mix(in_srgb,var(--nimi-status-success)_55%,transparent)] hover:bg-[color-mix(in_srgb,var(--nimi-status-success)_6%,var(--nimi-surface-card))] hover:shadow-[0_12px_26px_rgba(15,23,42,0.06)]',
                  toneStyle.surface,
                )}
              >
                <p className={cn('text-sm font-medium transition-colors group-hover:text-[var(--nimi-text-primary)]', TOKEN_TEXT_SECONDARY)}>
                  {item.capability}
                </p>
                <p className={cn('mt-1 text-xs', TOKEN_TEXT_MUTED)}>
                  {t('runtimeConfig.runtime.capabilityNotConfigured', { defaultValue: 'Not configured' })}
                </p>
                <div className="mt-3 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => model.onChangePage('models')}
                    className={cn('inline-flex items-center gap-1 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[color-mix(in_srgb,var(--nimi-status-success)_55%,transparent)] hover:text-[var(--nimi-status-success)]', TOKEN_TEXT_SECONDARY)}
                  >
                    <PlusIcon />
                    {t('runtimeConfig.runtime.installModel', { defaultValue: 'Install Model' })}
                  </button>
                  <IconButton
                    icon={<KeyIcon />}
                    title={t('runtimeConfig.runtime.addApiKey', { defaultValue: 'Add API Key' })}
                    onClick={() => model.onChangePage('cloud')}
                  />
                </div>
              </Surface>
            );
          })}
        </div>
      </section>
    </>
  );
}
