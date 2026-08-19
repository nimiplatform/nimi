import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import {
  Surface,
  cn,
  } from '@nimiplatform/kit/ui';
import {
  type RuntimeConfigStateV11,
} from './runtime-config-state-types';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { describeRuntimeDaemonIssue } from './runtime-daemon-guidance';
import { Button, DaemonStatusBadge, SectionTitle } from './runtime-config-primitives';
import {
  StatusDot,
  TOKEN_PANEL_CARD,
  TOKEN_TEXT_MUTED,
  TOKEN_TEXT_PRIMARY,
  TOKEN_TEXT_SECONDARY,
  TONE_STYLES,
} from './runtime-config-runtime-page-ui';
import { RuntimePageShell } from './runtime-config-page-shell';
import { OverviewLoadUsageSection } from './runtime-config-overview-load-usage';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service';
import {
  BoxIcon,
  ChevronRightIcon,
  CloudIcon,
  KeyRoundIcon,
  ScrollTextIcon,
  ServerIcon,
  SlidersIcon,
} from './runtime-config-overview-icons';
import { useCountUp, useOverviewReveal } from './runtime-config-overview-motion';

type OverviewPageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

function IconChip({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]">
      {children}
    </span>
  );
}

function StatValue({ value }: { value: number }) {
  const counted = useCountUp(value);
  return <>{Math.round(counted)}</>;
}

function StatTile({
  icon,
  title,
  value,
  subtitle,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  value: number | null;
  subtitle: string;
  onClick?: () => void;
}) {
  const content = (
    <div className="flex items-center gap-3">
      <IconChip>{icon}</IconChip>
      <div className="min-w-0 flex-1 text-left">
        <p className={cn('truncate text-xs', TOKEN_TEXT_MUTED)}>{title}</p>
        <p className={cn('mt-0.5 text-2xl font-bold leading-tight tabular-nums', TOKEN_TEXT_PRIMARY)}>
          {value === null ? '—' : <StatValue value={value} />}
        </p>
        <p className={cn('mt-0.5 truncate text-xs', TOKEN_TEXT_MUTED)}>{subtitle}</p>
      </div>
      {onClick ? (
        <ChevronRightIcon className="shrink-0 text-[var(--nimi-text-muted)] transition-all duration-[var(--nimi-motion-fast)] group-hover:translate-x-0.5 group-hover:text-[var(--nimi-action-primary-bg)]" />
      ) : null}
    </div>
  );

  const className = cn(
    TOKEN_PANEL_CARD,
    'group w-full min-w-0 p-4',
    onClick && 'transition-colors hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_45%,transparent)]',
  );

  if (onClick) {
    return (
      <Surface
        as="button"
        type="button"
        tone="card"
        interactive
        className={className}
        onClick={onClick}
      >
        {content}
      </Surface>
    );
  }

  return (
    <Surface tone="card" className={className}>
      {content}
    </Surface>
  );
}

function QuickLinkCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <Surface
      as="button"
      type="button"
      tone="card"
      interactive
      className="group w-full min-w-0 rounded-xl p-3.5 text-left transition-colors hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_45%,transparent)]"
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <IconChip>{icon}</IconChip>
        <div className="min-w-0 flex-1">
          <p className={cn('truncate text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>{title}</p>
          <p className={cn('mt-0.5 text-xs break-words [overflow-wrap:anywhere]', TOKEN_TEXT_MUTED)}>{description}</p>
        </div>
        <ChevronRightIcon className="shrink-0 text-[var(--nimi-text-muted)] transition-all duration-[var(--nimi-motion-fast)] group-hover:translate-x-0.5 group-hover:text-[var(--nimi-action-primary-bg)]" />
      </div>
    </Surface>
  );
}

function DaemonMetaItem({ label, value, mono = false }: { label: string; value: string | number; mono?: boolean }) {
  const text = String(value);
  return (
    <div className="min-w-0">
      <p className={cn('text-[length:var(--nimi-type-caption-size)] font-medium uppercase tracking-[var(--nimi-type-overline-letter-spacing)]', TOKEN_TEXT_MUTED)}>{label}</p>
      <p className={cn('mt-1 truncate text-sm', mono && 'font-mono', TOKEN_TEXT_PRIMARY)} title={text}>{text}</p>
    </div>
  );
}

export function OverviewPage({ model, state }: OverviewPageProps) {
  const i18n = useDesktopI18nResource();
  const { t } = useTranslation();
  const modelAssetsClient = useRuntimeConfigLocalEnvironmentClient();
  const [installedAssetCount, setInstalledAssetCount] = useState<number | null>(null);
  const reveal = useOverviewReveal();

  useEffect(() => {
    let active = true;
    void modelAssetsClient.listModelAssets().then((assets) => {
      if (active) setInstalledAssetCount(assets.length);
    }).catch(() => {
      if (active) setInstalledAssetCount(null);
    });
    return () => { active = false; };
  }, [modelAssetsClient]);

  const daemonRunning = model.runtimeDaemonStatus?.running === true;
  const daemonBusy = model.runtimeDaemonBusyAction !== null;
  const daemonIssue = describeRuntimeDaemonIssue({
    status: model.runtimeDaemonStatus,
    runtimeDaemonError: model.runtimeDaemonError,
  }, t);
  const daemonToneStyle = TONE_STYLES[daemonRunning ? 'success' : 'danger'];
  const daemonGlowColor = daemonRunning ? 'var(--nimi-status-success)' : 'var(--nimi-status-danger)';

  return (
    <RuntimePageShell>
      <motion.div {...reveal(0)}>
        <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'relative overflow-hidden')}>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full opacity-[0.14] blur-3xl"
            style={{ background: daemonGlowColor }}
          />
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
      </motion.div>

      <motion.section {...reveal(1)}>
        <SectionTitle>
          {t('runtimeConfig.overview.snapshotTitle', { defaultValue: 'Overview Snapshot' })}
        </SectionTitle>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile
            icon={<BoxIcon />}
            title={t('runtimeConfig.overview.installedAssets', { defaultValue: 'Installed Assets' })}
            value={installedAssetCount}
            subtitle={t('runtimeConfig.overview.runtimeManagedInventory', { defaultValue: 'ModelAsset inventory' })}
            onClick={() => model.onChangePage('localModels')}
          />
          <StatTile
            icon={<CloudIcon />}
            title={t('runtimeConfig.overview.cloudConfigurations', { defaultValue: 'Cloud Configurations' })}
            value={state.connectors.length}
            subtitle={t('runtimeConfig.overview.runtimeManagedConfiguration', { defaultValue: 'Runtime-managed configuration' })}
            onClick={() => model.onChangePage('cloud')}
          />
          <StatTile
            icon={<KeyRoundIcon />}
            title={t('runtimeConfig.overview.vaultEntries', { defaultValue: 'Vault Entries' })}
            value={model.vaultEntryCount}
            subtitle={t('runtimeConfig.overview.credentialsStored', { defaultValue: 'credentials stored' })}
          />
        </div>
      </motion.section>

      <motion.div {...reveal(2)}>
        <OverviewLoadUsageSection />
      </motion.div>

      <motion.section {...reveal(3)}>
        <SectionTitle>
          {t('runtimeConfig.overview.quickNavigationTitle', { defaultValue: 'Quick Navigation' })}
        </SectionTitle>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <QuickLinkCard
            icon={<BoxIcon />}
            title={t('runtimeConfig.overview.manageModels', { defaultValue: 'Manage Models' })}
            description={t('runtimeConfig.overview.manageModelsDescription', { defaultValue: 'Import, install, and manage ModelAssets' })}
            onClick={() => model.onChangePage('localModels')}
          />
          <QuickLinkCard
            icon={<SlidersIcon />}
            title={t('runtimeConfig.overview.configureCloud', { defaultValue: 'Configure Cloud' })}
            description={t('runtimeConfig.overview.configureCloudDescription', { defaultValue: 'API keys and connectors' })}
            onClick={() => model.onChangePage('cloud')}
          />
          <QuickLinkCard
            icon={<ScrollTextIcon />}
            title={t('runtimeConfig.overview.runtimeAudit', { defaultValue: 'Runtime & Audit' })}
            description={t('runtimeConfig.overview.runtimeAuditDescription', { defaultValue: 'Health, logs, EAA tokens' })}
            onClick={() => model.onChangePage('environment')}
          />
        </div>
      </motion.section>
    </RuntimePageShell>
  );
}
