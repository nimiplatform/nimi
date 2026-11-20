import { AppCardSurface, Button, IconButton, InlineAlert, LoadingSkeleton } from '@nimiplatform/kit/ui';
import { ArrowUp, LayoutGrid, LoaderCircle, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invokeChecked } from '../../bridge/runtime-bridge/invoke.js';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast.js';
import { AppArtworkIcon } from '../apps/apps-card-visuals.js';
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
};

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
}: HomeAppsWorkbenchProps) {
  const { t } = useTranslation();
  const [zhiyuBusy, setZhiyuBusy] = useState(false);
  const [zhiyuFailed, setZhiyuFailed] = useState(false);
  const [focusingKey, setFocusingKey] = useState<string | null>(null);
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

  const handleFocus = (entry: DesktopAppsEntry) => {
    setFocusingKey(entry.identity.entryKey);
    void focusRunningDesktopApp(entry, focusGeneration)
      .then(() => markOpened(entry.identity.appId))
      .catch(() => emitFeedbackToast({ kind: 'error', message: t('runtimeConfig.overview.activeWork.focusFailed') }))
      .finally(() => setFocusingKey(null));
  };

  const handleOpenAppDetail = (appId: string, entryKey: string) => {
    markOpened(appId);
    onOpenApp(appId, entryKey);
  };

  return (
    <AppCardSurface kind="promoted-glass" className="flex min-w-0 flex-col gap-4 p-5" data-testid="home-apps">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-action-primary-bg)]">
            <LayoutGrid size={16} aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-wrap items-baseline gap-2">
            <h2 className="text-base font-semibold tracking-tight text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.overview.apps')}
            </h2>
            {!loading ? (
              <span
                className="rounded-full bg-[var(--nimi-surface-panel)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--nimi-text-secondary)]"
                data-testid="home-apps-recent-count"
              >
                {dock.totalCount > HOME_RECENT_APPS_LIMIT
                  ? t('runtimeConfig.overview.appsWorkbench.recentCapSummary', {
                      shown: dock.items.length,
                      total: dock.totalCount,
                    })
                  : t('runtimeConfig.overview.appsWorkbench.recentTotalSummary', {
                      total: dock.totalCount,
                    })}
              </span>
            ) : null}
          </div>
        </div>
        <Button tone="ghost" size="sm" onClick={onOpenAllApps}>
          {t('runtimeConfig.overview.allApps')}
        </Button>
      </header>

      {unavailable ? (
        <InlineAlert tone="warning">{t('runtimeConfig.overview.appsUnavailable')}</InlineAlert>
      ) : null}
      {zhiyuFailed ? (
        <InlineAlert tone="warning">{t('Apps.bundled.openFailed')}</InlineAlert>
      ) : null}
      {loading ? <LoadingSkeleton lines={2} label={t('Common.loading')} /> : null}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-5" data-testid="home-apps-dock">
        {dock.items.map((item) => {
          if (item.kind === 'bundled-zhiyu') {
            return (
              <div
                key={item.key}
                data-testid="bundled-zhiyu"
                className="group/tile relative flex min-w-0 flex-col rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-base)] transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--nimi-border-strong)] hover:shadow-[var(--nimi-elevation-raised)]"
              >
                <button
                  type="button"
                  disabled={zhiyuBusy}
                  onClick={() => void openZhiyu()}
                  aria-label={t('Apps.bundled.openZhiyu')}
                  className="flex h-full w-full min-w-0 flex-col items-center gap-2 px-2.5 py-3 text-center focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] disabled:opacity-60"
                >
                  <span className="relative inline-flex">
                    <img src={zhiyuIcon} alt="" className="size-12 shrink-0 rounded-2xl shadow-[var(--nimi-elevation-base)]" />
                    {zhiyuBusy ? (
                      <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-[var(--nimi-surface-card)] text-[var(--nimi-action-primary-bg)] shadow-[var(--nimi-elevation-base)]">
                        <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
                      </span>
                    ) : null}
                  </span>
                  <span className="w-full min-w-0 space-y-0.5">
                    <span className="block truncate text-xs font-semibold text-[var(--nimi-text-primary)]">
                      {bundledZhiyuName}
                    </span>
                    <span className="block truncate text-[11px] text-[var(--nimi-text-secondary)]">
                      {t('runtimeConfig.overview.appsWorkbench.builtInBadge')}
                    </span>
                  </span>
                </button>
              </div>
            );
          }

          const { group, hasUpdate, disambiguator } = item;
          const entry = group.entries.find((entry) => entry.run?.state === 'running') ?? group.primary;
          const running = group.running;
          const starting = group.starting;
          const active = group.active;
          const baseSourceLabel = entry.localDevelopment
            ? t('runtimeConfig.overview.appsWorkbench.devBadge')
            : entry.committedRelease?.version
              ? t('runtimeConfig.overview.appsWorkbench.installedVersion', { version: entry.committedRelease.version })
              : t('runtimeConfig.overview.appsWorkbench.installedBadge');
          const sourceLabel = disambiguator ? `${baseSourceLabel} · ${disambiguator}` : baseSourceLabel;
          const isFocusing = focusingKey === entry.identity.entryKey;

          return (
            <div
              key={group.appId}
              className={`group/tile relative flex min-w-0 flex-col rounded-xl border bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-base)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[var(--nimi-elevation-raised)] ${
                active
                  ? 'border-[var(--nimi-status-success)] hover:border-[var(--nimi-status-success)]'
                  : 'border-[var(--nimi-border-subtle)] hover:border-[var(--nimi-border-strong)]'
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  running
                    ? handleFocus(entry)
                    : handleOpenAppDetail(group.appId, entry.identity.entryKey)
                }
                data-testid={`home-app:${group.appId}`}
                className="flex h-full w-full min-w-0 flex-col items-center gap-2 px-2.5 py-3 text-center focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
              >
                <span className="relative inline-flex">
                  <AppArtworkIcon
                    appId={group.appId}
                    displayName={group.displayName}
                    iconUrl={group.iconUrl ?? iconUrls.get(group.appId) ?? null}
                    size="xl"
                    className="rounded-2xl shadow-[var(--nimi-elevation-base)]"
                  />
                  {active ? (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-[var(--nimi-status-success)] ring-2 ring-[var(--nimi-surface-card)]"
                      aria-hidden="true"
                    />
                  ) : hasUpdate ? (
                    <span
                      className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] ring-2 ring-[var(--nimi-surface-card)]"
                      title={t('runtimeConfig.overview.updateTag')}
                    >
                      <ArrowUp size={10} aria-hidden="true" />
                    </span>
                  ) : null}
                </span>

                <span className="w-full min-w-0 space-y-0.5">
                  <span className="block truncate text-xs font-semibold text-[var(--nimi-text-primary)]">
                    {group.displayName}
                  </span>
                  {active ? (
                    <span className="inline-flex max-w-full items-center justify-center gap-1 truncate text-[11px] font-medium text-[var(--nimi-status-success)]">
                      {isFocusing ? <LoaderCircle size={10} className="animate-spin" aria-hidden="true" /> : null}
                      <span>
                        {running
                          ? `${t('runtimeConfig.overview.activeWork.appRunning')} · ${t('runtimeConfig.overview.activeWork.focusWindow')}`
                          : starting
                            ? t('runtimeConfig.overview.activeWork.appStarting')
                            : t('runtimeConfig.overview.activeWork.appRunning')}
                      </span>
                    </span>
                  ) : (
                    <span className="block truncate text-[11px] text-[var(--nimi-text-secondary)]">
                      {hasUpdate ? `${sourceLabel} · ${t('runtimeConfig.overview.updateTag')}` : sourceLabel}
                    </span>
                  )}
                </span>
              </button>

              {running ? (
                <IconButton
                  tone="ghost"
                  size="sm"
                  aria-label={`${group.displayName} · ${t('runtimeConfig.overview.appsWorkbench.manageAction')}`}
                  title={t('runtimeConfig.overview.appsWorkbench.manageAction')}
                  onClick={() => handleOpenAppDetail(group.appId, entry.identity.entryKey)}
                  data-testid={`home-app-manage:${group.appId}`}
                  className="absolute right-1 top-1 size-6 rounded-lg opacity-0 transition-opacity group-hover/tile:opacity-100 focus-visible:opacity-100"
                  icon={<SlidersHorizontal size={12} aria-hidden="true" />}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {dock.spotlightCatalog.length > 0 ? (
        <footer
          className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--nimi-border-subtle)] pt-3"
          data-testid="home-apps-spotlight"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
              <Sparkles size={13} aria-hidden="true" />
              {t('runtimeConfig.overview.appsWorkbench.discoverTitle')}
            </span>
            {dock.spotlightCatalog.map((entry) => (
              <button
                key={entry.identity.entryKey}
                type="button"
                onClick={() => onOpenApp(entry.identity.appId, entry.identity.entryKey)}
                data-testid={`home-app-spotlight:${entry.identity.appId}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2.5 py-1 text-xs font-medium text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)] transition-colors hover:bg-[var(--nimi-surface-active)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
              >
                <AppArtworkIcon
                  appId={entry.identity.appId}
                  displayName={entry.identity.displayName}
                  iconUrl={iconUrls.get(entry.identity.appId) ?? null}
                  size="xs"
                />
                <span className="max-w-32 truncate">{entry.identity.displayName}</span>
              </button>
            ))}
          </div>
          <Button tone="ghost" size="sm" onClick={onOpenAllApps}>
            {t('runtimeConfig.overview.appsWorkbench.discoverMore')}
          </Button>
        </footer>
      ) : null}
    </AppCardSurface>
  );
}
