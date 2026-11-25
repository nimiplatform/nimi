import { InlineAlert, LoadingSkeleton, Tooltip } from '@nimiplatform/kit/ui';
import { ArrowUp, Code2, LoaderCircle, Plus, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { invokeChecked } from '../../bridge/runtime-bridge/invoke.js';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast.js';
import { actionPlanForEntry } from '../apps/apps-card-actions.js';
import { AppArtworkIcon } from '../apps/apps-card-visuals.js';
import { createDesktopAppsLiveBridge } from '../apps/apps-live-bridge.js';
import { installedLaunchFailureMessage } from '../apps/apps-panel-controller.js';
import type { DesktopAppsEntry } from '../apps/apps-panel-projection.js';
import { focusRunningDesktopApp } from './home-active-work-card.js';
import {
  BUNDLED_ZHIYU_RECENT_KEY,
  buildHomeRecentAppsDock,
  HOME_RECENT_APPS_LIMIT,
  readHomeRecentAppTimestamps,
  recordHomeRecentAppOpen,
} from './home-recent-apps-model.js';

const zhiyuIcon = new URL('../../../../../../zhiyu/src/shell/assets/app-icon.png', import.meta.url).href;

export type HomeAppsWorkbenchProps = {
  focusGeneration: string | null;
  accountKey?: string | null;
  entries: readonly DesktopAppsEntry[];
  iconUrls: ReadonlyMap<string, string | null>;
  loading: boolean;
  unavailable: boolean;
  onOpenAllApps: () => void;
  onOpenApp: (appId: string, entryKey: string) => void;
  onLaunchApp?: (entry: DesktopAppsEntry) => Promise<void>;
  onAppsMutated?: () => void;
};

async function launchDesktopApp(
  entry: DesktopAppsEntry,
  t: ReturnType<typeof useTranslation>['t'],
): Promise<void> {
  const liveBridge = createDesktopAppsLiveBridge();
  if (entry.localDevelopment) {
    await liveBridge.startRegistration(entry.localDevelopment.selector);
    return;
  }
  if (entry.committedRelease && liveBridge.launchInstalled) {
    const run = await liveBridge.launchInstalled(entry.committedRelease.launchSelector.slice());
    if (run.state === 'crashed') {
      throw new Error(installedLaunchFailureMessage(run, t));
    }
    return;
  }
  throw new Error(t('Apps.actionFailed'));
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-pkgrel-009
// @nimi-authority: rule.nimi.desktop.shell-ui.r029
// @nimi-authority: rule.nimi.desktop.shell-ui.r052
export function HomeAppsWorkbench({
  focusGeneration,
  accountKey = null,
  entries,
  iconUrls,
  loading,
  unavailable,
  onOpenAllApps,
  onOpenApp,
  onLaunchApp,
  onAppsMutated,
}: HomeAppsWorkbenchProps) {
  const { t } = useTranslation();
  const [zhiyuBusy, setZhiyuBusy] = useState(false);
  const [zhiyuFailed, setZhiyuFailed] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [timestamps, setTimestamps] = useState<Readonly<Record<string, number>>>(() =>
    readHomeRecentAppTimestamps(accountKey),
  );

  const bundledZhiyuName = t('Apps.bundled.zhiyu');
  const dock = useMemo(
    () =>
      buildHomeRecentAppsDock({
        entries,
        timestamps,
        bundledZhiyuName,
        limit: HOME_RECENT_APPS_LIMIT,
      }),
    [entries, timestamps, bundledZhiyuName],
  );

  const markOpened = (appKey: string) => {
    setTimestamps(recordHomeRecentAppOpen(accountKey, appKey));
  };

  const openZhiyu = async () => {
    markOpened(BUNDLED_ZHIYU_RECENT_KEY);
    setZhiyuBusy(true);
    setZhiyuFailed(false);
    try {
      await invokeChecked('bundled_zhiyu_open', {}, (value) => {
        if (!value || typeof value !== 'object' || !('opened' in value) || value.opened !== true) {
          throw new Error('bundled-zhiyu-open-invalid');
        }
        return value;
      });
    } catch {
      setZhiyuFailed(true);
    } finally {
      setZhiyuBusy(false);
    }
  };

  const handleOpenAppDetail = (appId: string, entryKey: string) => {
    markOpened(appId);
    onOpenApp(appId, entryKey);
  };

  const handleActivateApp = (entry: DesktopAppsEntry, running: boolean, starting: boolean) => {
    const entryKey = entry.identity.entryKey;
    const appId = entry.identity.appId;
    if (busyKey === entryKey) return;

    if (running) {
      setBusyKey(entryKey);
      void focusRunningDesktopApp(entry, focusGeneration)
        .then(() => {
          markOpened(appId);
          onAppsMutated?.();
        })
        .catch(() => emitFeedbackToast({ kind: 'error', message: t('runtimeConfig.overview.activeWork.focusFailed') }))
        .finally(() => setBusyKey(null));
      return;
    }

    if (starting) {
      handleOpenAppDetail(appId, entryKey);
      return;
    }

    const plan = actionPlanForEntry(entry);
    if (plan.primary?.id !== 'launch') {
      handleOpenAppDetail(appId, entryKey);
      return;
    }

    setBusyKey(entryKey);
    const launch = onLaunchApp ? () => onLaunchApp(entry) : () => launchDesktopApp(entry, t);
    void launch()
      .then(() => {
        markOpened(appId);
        onAppsMutated?.();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error && error.message.trim()
          ? error.message
          : t('Apps.actionFailed');
        emitFeedbackToast({ kind: 'error', message });
      })
      .finally(() => setBusyKey(null));
  };

  const handleContextMenu = (
    event: MouseEvent<HTMLButtonElement>,
    appId: string,
    entryKey: string,
  ) => {
    event.preventDefault();
    handleOpenAppDetail(appId, entryKey);
  };

  const showOverflowTile = !loading && dock.overflowCount > 0;

  return (
    <section
      aria-label={t('runtimeConfig.overview.appsWorkbench.dockTitle')}
      data-testid="home-apps"
      className="flex min-w-0 flex-col gap-3"
    >
      <header className="flex items-center justify-between gap-2 px-0.5">
        <h2 className="text-xs font-semibold tracking-wide text-[var(--nimi-text-secondary)]">
          {t('runtimeConfig.overview.appsWorkbench.dockTitle')}
        </h2>
      </header>

      {unavailable ? (
        <InlineAlert tone="warning">{t('runtimeConfig.overview.appsUnavailable')}</InlineAlert>
      ) : null}
      {zhiyuFailed ? (
        <InlineAlert tone="warning">{t('Apps.bundled.openFailed')}</InlineAlert>
      ) : null}
      {loading ? <LoadingSkeleton lines={1} label={t('Common.loading')} /> : null}

      <div
        className="flex flex-wrap items-start gap-3.5"
        data-testid="home-apps-dock"
      >
        {dock.items.map((item) => {
          if (item.kind === 'bundled-zhiyu') {
            return (
              <div
                key={item.key}
                data-testid="bundled-zhiyu"
                className="group/tile relative flex flex-col items-center gap-1.5"
              >
                <Tooltip content={bundledZhiyuName} placement="top">
                  <button
                    type="button"
                    disabled={zhiyuBusy}
                    onClick={() => void openZhiyu()}
                    aria-label={t('Apps.bundled.openZhiyu')}
                    className="relative flex size-14 items-center justify-center rounded-2xl bg-[var(--nimi-home-porcelain-card)] shadow-[var(--nimi-home-porcelain-shadow)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[var(--nimi-home-porcelain-shadow-hover)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] disabled:opacity-60"
                  >
                    <img
                      src={zhiyuIcon}
                      alt=""
                      className="size-11 shrink-0 rounded-xl bg-[var(--nimi-home-porcelain-card)] object-contain"
                    />
                    {zhiyuBusy ? (
                      <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-[var(--nimi-home-porcelain-card)] text-[var(--nimi-action-primary-bg)] shadow-[var(--nimi-elevation-base)]">
                        <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
                      </span>
                    ) : null}
                  </button>
                </Tooltip>
                <span className="h-1.5 w-1.5 rounded-full bg-transparent" aria-hidden="true" />
              </div>
            );
          }

          const { group, hasUpdate, disambiguator } = item;
          const entry = group.entries.find((candidate) => candidate.run?.state === 'running') ?? group.primary;
          const running = group.running;
          const starting = group.starting;
          const active = group.active;
          const isBusy = busyKey === entry.identity.entryKey;
          const resolvedIconUrl = group.iconUrl ?? iconUrls.get(group.appId) ?? null;
          const hasCustomArtwork = group.appId === 'nimi.desktop' || Boolean(resolvedIconUrl);

          const baseName = disambiguator ? `${group.displayName} · ${disambiguator}` : group.displayName;
          const statusSuffix = running
            ? `${t('runtimeConfig.overview.activeWork.appRunning')} · ${t('runtimeConfig.overview.activeWork.focusWindow')}`
            : starting
              ? t('runtimeConfig.overview.activeWork.appStarting')
              : hasUpdate
                ? t('runtimeConfig.overview.updateTag')
                : null;
          const tooltipText = statusSuffix ? `${baseName} · ${statusSuffix}` : baseName;

          return (
            <div
              key={group.appId}
              className="group/tile relative flex flex-col items-center gap-1.5"
            >
              <Tooltip content={tooltipText} placement="top">
                <button
                  type="button"
                  disabled={isBusy}
                  aria-label={tooltipText}
                  onClick={() => handleActivateApp(entry, running, starting)}
                  onContextMenu={(event) => handleContextMenu(event, group.appId, entry.identity.entryKey)}
                  data-testid={`home-app:${group.appId}`}
                  className="relative flex size-14 items-center justify-center rounded-2xl bg-[var(--nimi-home-porcelain-card)] shadow-[var(--nimi-home-porcelain-shadow)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[var(--nimi-home-porcelain-shadow-hover)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] disabled:opacity-70"
                >
                  <AppArtworkIcon
                    appId={group.appId}
                    displayName={group.displayName}
                    iconUrl={resolvedIconUrl}
                    size="dock"
                    imageBackground="var(--nimi-home-porcelain-card)"
                  />
                  {isBusy ? (
                    <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-[var(--nimi-home-porcelain-card)] text-[var(--nimi-action-primary-bg)] shadow-[var(--nimi-elevation-base)]">
                      <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
                    </span>
                  ) : hasUpdate ? (
                    <span
                      className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] ring-2 ring-[var(--nimi-surface-canvas)] transition-opacity group-hover/tile:opacity-0"
                      aria-hidden="true"
                    >
                      <ArrowUp size={10} />
                    </span>
                  ) : null}
                  {disambiguator && entry.localDevelopment && !entry.committedRelease ? (
                    <span
                      className="absolute -bottom-1 -left-1 flex size-4.5 items-center justify-center rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] shadow-xs"
                      aria-hidden="true"
                    >
                      <Code2 size={10} />
                    </span>
                  ) : null}
                </button>
              </Tooltip>

              <Tooltip content={t('runtimeConfig.overview.appsWorkbench.manageAction')} placement="top">
                <button
                  type="button"
                  aria-label={`${group.displayName} · ${t('runtimeConfig.overview.appsWorkbench.manageAction')}`}
                  onClick={() => handleOpenAppDetail(group.appId, entry.identity.entryKey)}
                  data-testid={`home-app-manage:${group.appId}`}
                  className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-[var(--nimi-home-porcelain-card)] text-[var(--nimi-text-secondary)] opacity-0 shadow-[var(--nimi-home-porcelain-shadow)] transition-opacity duration-150 hover:text-[var(--nimi-text-primary)] group-hover/tile:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                >
                  <SlidersHorizontal size={11} aria-hidden="true" />
                </button>
              </Tooltip>

              <span
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  active ? 'bg-[var(--nimi-status-success)]' : 'bg-transparent'
                }`}
                data-testid={active ? `home-app-running:${group.appId}` : undefined}
                aria-hidden="true"
              />

              {!hasCustomArtwork ? (
                <span
                  className="max-w-14 truncate text-[11px] font-medium text-[var(--nimi-text-secondary)]"
                  data-testid={`home-app-fallback-label:${group.appId}`}
                >
                  {group.displayName}
                </span>
              ) : null}
            </div>
          );
        })}

        {showOverflowTile ? (
          <div className="flex flex-col items-center gap-1.5">
            <Tooltip
              content={t('runtimeConfig.overview.appsWorkbench.overflowAppsAria', { count: dock.overflowCount })}
              placement="top"
            >
              <button
                type="button"
                onClick={onOpenAllApps}
                aria-label={t('runtimeConfig.overview.appsWorkbench.overflowAppsAria', {
                  count: dock.overflowCount,
                })}
                data-testid="home-apps-overflow-tile"
                data-overflow-count={dock.overflowCount}
                className="flex size-14 items-center justify-center rounded-2xl border border-dashed border-[var(--nimi-border-strong)] bg-transparent font-semibold tabular-nums text-[var(--nimi-text-secondary)] transition-all duration-150 hover:-translate-y-0.5 hover:border-solid hover:border-[var(--nimi-action-primary-bg)]/40 hover:bg-[var(--nimi-home-porcelain-card)] hover:text-[var(--nimi-text-primary)] hover:shadow-[var(--nimi-home-porcelain-shadow)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
              >
                <span className={dock.overflowCount >= 100 ? 'text-xs' : 'text-sm'}>
                  +{dock.overflowCount}
                </span>
              </button>
            </Tooltip>
            <span className="h-1.5 w-1.5 rounded-full bg-transparent" aria-hidden="true" />
          </div>
        ) : !loading ? (
          <div className="flex flex-col items-center gap-1.5">
            <Tooltip content={t('runtimeConfig.overview.allApps')} placement="top">
              <button
                type="button"
                onClick={onOpenAllApps}
                aria-label={t('runtimeConfig.overview.allApps')}
                data-testid="home-apps-more-tile"
                className="flex size-14 items-center justify-center rounded-2xl border border-dashed border-[var(--nimi-border-strong)] bg-transparent text-[var(--nimi-text-secondary)] transition-all duration-150 hover:-translate-y-0.5 hover:border-solid hover:border-[var(--nimi-action-primary-bg)]/40 hover:bg-[var(--nimi-home-porcelain-card)] hover:text-[var(--nimi-text-primary)] hover:shadow-[var(--nimi-home-porcelain-shadow)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
              >
                <Plus size={20} aria-hidden="true" />
              </button>
            </Tooltip>
            <span className="h-1.5 w-1.5 rounded-full bg-transparent" aria-hidden="true" />
          </div>
        ) : null}
      </div>
    </section>
  );
}
