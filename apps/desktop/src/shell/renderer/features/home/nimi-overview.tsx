import { Button, InlineAlert, LoadingSkeleton, ScrollArea } from '@nimiplatform/kit/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ArrowUp, ArrowUpCircle, CircleAlert, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { formatBytes, formatTransferRate } from '../../components/download-format.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { useDesktopRendererCommands, useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { hasAvailableCatalogUpdate } from '../apps/apps-card-actions.js';
import { AppArtworkIcon } from '../apps/apps-card-visuals.js';
import { useAppsOverview } from '../apps/use-apps-overview.js';
import { useGlobalDownloads } from '../runtime-config/global-downloads-context.js';
import {
  capabilityPreparationState,
  useCapabilityInventory,
} from '../runtime-config/runtime-capability-inventory.js';
import { displayRuntimeConfigCapabilityLabel } from '../runtime-config/runtime-config-capability-labels.js';
import { isDownloadTerminal } from '../runtime-config/runtime-config-model-center-utils.js';
import type { RuntimeAdvancedDiagnosticsPane } from '../runtime-config/runtime-config-state-types.js';
import { HomeActivityColumn, type HomeAttentionItem } from './home-activity-column.js';
import { HomeAgentCard } from './home-agent-card.js';
import { HomeMachineStatus, homeRuntimeState } from './home-machine-status.js';

const HOME_APP_LIMIT = 8;

function greetingKey(hour: number): string {
  if (hour < 5) return 'runtimeConfig.overview.greetingNight';
  if (hour < 12) return 'runtimeConfig.overview.greetingMorning';
  if (hour < 18) return 'runtimeConfig.overview.greetingAfternoon';
  return 'runtimeConfig.overview.greetingEvening';
}

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold">{title}</h2>
      {action && onAction ? (
        <Button tone="ghost" size="sm" onClick={onAction}>
          {action}
          <ArrowRight size={14} />
        </Button>
      ) : null}
    </div>
  );
}

/** Static placeholder until apps declare resumable work; nothing here is wired to data on purpose. */
function HomeContinuePlaceholder() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-3 rounded-[24px] bg-[var(--nimi-surface-panel)] p-5 shadow-[var(--nimi-elevation-base)]" data-testid="home-continue-placeholder">
      <SectionHeader title={t('runtimeConfig.overview.continueLast')} />
      <p className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.overview.continueLastBody')}</p>
      <div className="grid gap-2.5 sm:grid-cols-2" aria-hidden="true">
        {[0, 1].map((slot) => (
          <div key={slot} className="flex h-[74px] items-center gap-3.5 rounded-[18px] border border-dashed border-[var(--nimi-border-subtle)] px-4">
            <span className="size-11 shrink-0 rounded-[14px] bg-[var(--nimi-surface-card)]" />
            <span className="flex flex-1 flex-col gap-2">
              <span className="h-2.5 w-2/5 rounded-full bg-[var(--nimi-surface-card)]" />
              <span className="h-2.5 w-3/5 rounded-full bg-[var(--nimi-surface-card)]" />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r015
export function NimiOverview() {
  const { t } = useTranslation();
  const i18n = useDesktopI18nResource();
  const sdk = useDesktopRendererSdk();
  const commands = useDesktopRendererCommands();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setChatMode = useAppStore((state) => state.setChatMode);
  const setAppsDetailAppId = useAppStore((state) => state.setAppsDetailAppId);
  const authUser = useAppStore((state) => state.auth.user);
  const inventory = useCapabilityInventory();
  const downloads = useGlobalDownloads();
  const apps = useAppsOverview();
  const health = useQuery({
    queryKey: ['nimi-overview', 'runtime-health'],
    queryFn: () => sdk.machineProduct().audit.getRuntimeHealth({}),
    staleTime: 15_000,
  });
  const entries = apps.data?.status === 'loaded' ? apps.data.entries : [];
  const unique = [
    ...new Map(
      entries
        .filter((entry) => entry.committedRelease || entry.localDevelopment)
        .sort(
          (left, right) =>
            Number(hasAvailableCatalogUpdate(left)) - Number(hasAvailableCatalogUpdate(right)) ||
            Number(Boolean(left.committedRelease)) - Number(Boolean(right.committedRelease)),
        )
        .map((entry) => [entry.identity.appId, entry]),
    ).values(),
  ];
  const updates = unique.filter(hasAvailableCatalogUpdate);
  const prepared = inventory.capabilities.filter((capability) =>
    capabilityPreparationState({
      capability,
      inventory: inventory.data,
      tasks: inventory.tasks,
      unavailable: inventory.isError,
    }).state === 'ready',
  );
  const failed = inventory.tasks.filter(
    (task) => task.status === 'failed' || task.status === 'needs-attention',
  );
  const activeTransfers = downloads?.transfers.filter((item) => !isDownloadTerminal(item.state)) ?? [];
  const displayName = authUser ? String(authUser.displayName || authUser.handle || '') : '';
  const now = new Date();
  const firstRun = !apps.isError && apps.data?.status === 'loaded'
    && !apps.data.runtimeError && apps.data.catalogStatus !== 'unavailable'
    && !inventory.isPending && unique.length === 0 && prepared.length === 0 && !inventory.isError;
  const openApp = (appId: string) => {
    setAppsDetailAppId(appId);
    setActiveTab('apps');
  };
  // Publish the intent, then switch tabs so the runtime panel controller
  // mounts and applies it (it is not mounted on Home).
  const openDiagnostics = (pane: RuntimeAdvancedDiagnosticsPane) => {
    commands.runtimeConfigNavigation.openPage('advancedDiagnostics', { pane });
    setActiveTab('diagnostics');
  };
  const openChat = () => {
    setChatMode('ai');
    setActiveTab('chat');
  };
  const attention: HomeAttentionItem[] = [
    ...activeTransfers.slice(0, 2).map((item) => ({
      key: `transfer:${item.installSessionId}`,
      icon: <Download size={17} className="text-[var(--nimi-status-info)]" />,
      title: item.sourceLabel || item.modelAssetId || item.installSessionId,
      detail: [
        item.bytesTotal ? `${formatBytes(item.bytesReceived + item.bytesReused)} / ${formatBytes(item.bytesTotal)}` : formatBytes(item.bytesReceived + item.bytesReused),
        formatTransferRate(item.speedBytesPerSec),
      ].filter(Boolean).join(' · '),
      progress: item.bytesTotal ? { value: item.bytesReceived + item.bytesReused, max: item.bytesTotal } : null,
      action: t('runtimeConfig.overview.view'),
      onAction: () => setActiveTab('downloads'),
      tone: 'info' as const,
    })),
    ...failed.slice(0, 2).map((task) => ({
      key: `task:${task.taskId}`,
      icon: <CircleAlert size={17} className="text-[var(--nimi-status-warning)]" />,
      title: t('runtimeConfig.overview.setupFailed', { capability: displayRuntimeConfigCapabilityLabel(task.capabilityContract, t) }),
      detail: task.failure?.message ?? '',
      progress: null,
      action: t('runtimeConfig.overview.view'),
      onAction: () => {
        commands.runtimeConfigNavigation.openSetupTask(task.taskId);
        setActiveTab('runtime');
      },
      tone: 'warning' as const,
    })),
    ...(updates.length
      ? [{
          key: 'updates',
          icon: <ArrowUpCircle size={17} className="text-[var(--nimi-text-secondary)]" />,
          title: t('runtimeConfig.overview.updates', { count: updates.length }),
          detail: updates.slice(0, 3).map((entry) => entry.identity.displayName).join(' · ') + (updates.length > 3 ? ' …' : ''),
          progress: null,
          action: t('runtimeConfig.overview.view'),
          onAction: () => openApp(updates[0]!.identity.appId),
          tone: 'neutral' as const,
        }]
      : []),
  ];

  const heading = (
    <h1 className="text-[28px] font-semibold leading-tight tracking-tight lg:text-[34px]">
      {displayName
        ? t('runtimeConfig.overview.greetingWithName', { greeting: t(greetingKey(now.getHours())), name: displayName })
        : t(greetingKey(now.getHours()))}
    </h1>
  );
  // Capability readiness stays visible here (r015) now that the capability grid
  // is gone; the segment doubles as the entry to AI capability management.
  const status = (
    <p className="flex flex-wrap items-center gap-x-2 text-[15px] text-[var(--nimi-text-secondary)]" data-testid="home-status-line">
      {inventory.isError ? (
        <span>{t('runtimeConfig.capabilities.readFailed')}</span>
      ) : inventory.isPending ? null : (
        <button
          type="button"
          className="rounded-md text-[var(--nimi-action-primary-bg)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
          onClick={() => setActiveTab('runtime')}
          data-testid="home-status-capabilities"
        >
          {t('runtimeConfig.overview.statusCapabilities', { count: prepared.length })}
        </button>
      )}
      {activeTransfers.length ? (
        <>
          <span className="text-[var(--nimi-text-muted)]">·</span>
          <span>{t('runtimeConfig.overview.statusDownloading', { count: activeTransfers.length })}</span>
        </>
      ) : null}
      {health.isError ? (
        <>
          <span className="text-[var(--nimi-text-muted)]">·</span>
          <button
            type="button"
            className="rounded-md text-[var(--nimi-status-warning)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
            onClick={() => openDiagnostics('services')}
          >
            {t('runtimeConfig.overview.runtimeUnavailable')}
          </button>
        </>
      ) : null}
      {!inventory.isError && inventory.isPending && !activeTransfers.length && !health.isError ? (
        <span>{t('runtimeConfig.overview.runtimeChecking')}</span>
      ) : null}
    </p>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
        <ScrollArea
          className="min-h-0 flex-1"
          viewportClassName="bg-transparent"
          contentClassName="mx-auto w-full max-w-[1400px] px-5 pb-7 pt-5 lg:px-8"
        >
          <p className="px-2 pb-4 text-[13px] text-[var(--nimi-text-muted)]" data-testid="home-date">
            {i18n.formatDate(now, { month: 'long', day: 'numeric', weekday: 'long' })}
          </p>

          <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex min-w-0 flex-col gap-5">
              <HomeAgentCard heading={heading} status={status} />

              {firstRun ? (
                <section className="flex flex-col gap-4 rounded-[24px] bg-[var(--nimi-surface-panel)] p-5 shadow-[var(--nimi-elevation-base)]" data-testid="home-first-run">
                  <h2 className="text-base font-semibold">{t('runtimeConfig.overview.firstRunTitle')}</h2>
                  <ol className="grid gap-3 md:grid-cols-3">
                    {(['model', 'chat', 'apps'] as const).map((step, index) => (
                      <li key={step} className="flex flex-col gap-3 rounded-2xl bg-[var(--nimi-surface-card)] p-4">
                        <span className="flex size-8 items-center justify-center rounded-full bg-[var(--nimi-surface-active)] text-sm font-semibold text-[var(--nimi-action-primary-bg)]">
                          {index + 1}
                        </span>
                        <div className="flex-1">
                          <h3 className="font-semibold">{t(`runtimeConfig.overview.firstRun.${step}.title`)}</h3>
                          <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{t(`runtimeConfig.overview.firstRun.${step}.body`)}</p>
                        </div>
                        <Button
                          tone={index === 0 ? 'primary' : 'secondary'}
                          size="sm"
                          onClick={() => (step === 'model' ? setActiveTab('runtime') : step === 'chat' ? openChat() : setActiveTab('apps'))}
                        >
                          {t(`runtimeConfig.overview.firstRun.${step}.action`)}
                          <ArrowRight size={14} />
                        </Button>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : (
                <section className="flex flex-col gap-3 rounded-[24px] bg-[var(--nimi-surface-panel)] p-5 shadow-[var(--nimi-elevation-base)]" data-testid="home-apps">
                  <SectionHeader
                    title={t('runtimeConfig.overview.apps')}
                    action={t('runtimeConfig.overview.allApps')}
                    onAction={() => setActiveTab('apps')}
                  />
                  {apps.isError ||
                  apps.data?.status === 'error' ||
                  (apps.data?.status === 'loaded' &&
                    (apps.data.catalogStatus === 'unavailable' || apps.data.runtimeError)) ? (
                    <InlineAlert tone="warning">{t('runtimeConfig.overview.appsUnavailable')}</InlineAlert>
                  ) : null}
                  {apps.isPending ? <LoadingSkeleton lines={2} label={t('Common.loading')} /> : null}
                  {unique.length ? (
                    <div className="flex flex-wrap gap-1">
                      {unique.slice(0, HOME_APP_LIMIT).map((entry) => {
                        const update = hasAvailableCatalogUpdate(entry);
                        return (
                          <button
                            key={entry.identity.appId}
                            type="button"
                            className="flex w-[92px] flex-col items-center gap-2 rounded-2xl px-1 py-2.5 text-center transition-colors hover:bg-[var(--nimi-surface-active)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                            onClick={() => openApp(entry.identity.appId)}
                            data-testid={`home-app:${entry.identity.appId}`}
                            title={update ? `${entry.identity.displayName} · ${t('runtimeConfig.overview.updateTag')}` : entry.identity.displayName}
                          >
                            <span className="relative">
                              <AppArtworkIcon
                                appId={entry.identity.appId}
                                displayName={entry.identity.displayName}
                                iconUrl={entry.iconUrl}
                                size="lg"
                              />
                              {update ? (
                                <span
                                  className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full border-2 border-[var(--nimi-surface-panel)] bg-[var(--nimi-status-info)] text-[var(--nimi-text-inverse)]"
                                  aria-label={t('runtimeConfig.overview.updateTag')}
                                >
                                  <ArrowUp size={9} strokeWidth={3.5} />
                                </span>
                              ) : null}
                            </span>
                            <span className="flex w-full flex-col items-center gap-0.5">
                              <span className="w-full truncate text-xs font-medium">{entry.identity.displayName}</span>
                              {!entry.committedRelease ? (
                                <span className="rounded-md bg-[var(--nimi-surface-active)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--nimi-text-secondary)]">
                                  {t('runtimeConfig.overview.devTag')}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {!apps.isPending && !unique.length ? (
                    <p className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.overview.noApps')}</p>
                  ) : null}
                </section>
              )}

              <HomeContinuePlaceholder />

              <HomeMachineStatus runtime={homeRuntimeState(health)} onOpenDiagnostics={openDiagnostics} />
            </div>

            <HomeActivityColumn attention={attention} onViewActivity={() => setActiveTab('activity')} />
          </div>
        </ScrollArea>
    </div>
  );
}
