import { InlineAlert, LoadingSkeleton, Tooltip } from '@nimiplatform/kit/ui';
import { ArrowUp, Code2, LoaderCircle, Plus, Settings } from 'lucide-react';
import { useMemo, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { invokeChecked } from '../../bridge/runtime-bridge/invoke.js';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast.js';
import { actionPlanForEntry } from '../apps/apps-card-actions.js';
import { appArtworkFor, deriveIconGlyph } from '../apps/apps-card-fields.js';
import { createDesktopAppsLiveBridge } from '../apps/apps-live-bridge.js';
import { installedLaunchFailureMessage } from '../apps/apps-panel-controller.js';
import type { DesktopAppsEntry } from '../apps/apps-panel-projection.js';
import { focusRunningDesktopApp } from './home-active-work-card.js';
import { useDockIconFrame } from './home-app-icon-frame.js';
import {
  BUNDLED_ZHIYU_RECENT_KEY,
  buildHomeRecentAppsDock,
  HOME_RECENT_APPS_LIMIT,
  readHomeRecentAppTimestamps,
  recordHomeRecentAppOpen,
} from './home-recent-apps-model.js';

const zhiyuIcon = new URL('../../../../../../zhiyu/src/shell/assets/app-icon.png', import.meta.url).href;
const desktopIconUrl = new URL('../../assets/logo.png', import.meta.url).href;

function HomeDockArtwork({
  appId,
  displayName,
  iconUrl,
}: {
  readonly appId: string;
  readonly displayName: string;
  readonly iconUrl: string | null;
}) {
  const artwork = appArtworkFor(appId);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const resolvedIconUrl = appId === 'nimi.desktop' ? desktopIconUrl : iconUrl;
  const visibleUrl = resolvedIconUrl && resolvedIconUrl !== failedUrl ? resolvedIconUrl : null;
  const { frame, imgRef, onLoad } = useDockIconFrame(visibleUrl);

  if (!visibleUrl) {
    return (
      <span
        aria-hidden="true"
        data-icon-surface="own-background"
        className="relative inline-flex h-full w-full shrink-0 select-none items-center justify-center overflow-hidden rounded-[8px] text-xs font-semibold text-white"
        style={{
          background: artwork.iconBackground,
          fontFamily: 'var(--nimi-font-display)',
        }}
      >
        {deriveIconGlyph(displayName)}
      </span>
    );
  }

  const needsWhiteBackplate = frame !== null && !frame.hasOwnBackground;
  const cropTransform = frame?.hasOwnBackground && (frame.scale !== 1 || frame.offsetXPercent !== 0 || frame.offsetYPercent !== 0)
    ? `scale(${frame.scale}) translate(${frame.offsetXPercent}%, ${frame.offsetYPercent}%)`
    : undefined;

  return (
    <span
      aria-hidden="true"
      data-icon-surface={needsWhiteBackplate ? 'white-backplate' : 'own-background'}
      className={`relative inline-flex h-full w-full shrink-0 select-none items-center justify-center overflow-hidden rounded-[8px] shadow-[0_1px_3px_rgba(15,23,42,0.08)] ring-1 ring-inset ring-black/[0.05] ${
        needsWhiteBackplate ? 'bg-white p-[2.5px]' : ''
      }`}
    >
      <img
        ref={imgRef}
        src={visibleUrl}
        alt=""
        onLoad={onLoad}
        onError={() => setFailedUrl(visibleUrl)}
        style={cropTransform ? { transform: cropTransform } : undefined}
        className="h-full w-full object-contain"
      />
    </span>
  );
}

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
    if (run.state === 'crashed' || run.state === 'stopped') {
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
      className="flex min-w-0 max-w-full flex-col items-center gap-2"
    >
      {unavailable ? (
        <InlineAlert tone="warning">{t('runtimeConfig.overview.appsUnavailable')}</InlineAlert>
      ) : null}
      {zhiyuFailed ? (
        <InlineAlert tone="warning">{t('Apps.bundled.openFailed')}</InlineAlert>
      ) : null}
      {loading ? <LoadingSkeleton lines={1} label={t('Common.loading')} /> : null}

      <div
        className="inline-flex max-w-full flex-wrap items-center justify-center gap-1 rounded-[18px] border border-[var(--nimi-home-whisper-border)] bg-[var(--nimi-home-whisper-surface)] py-1.5 pr-2.5 pl-3.5 shadow-[0_4px_16px_-6px_rgba(15,23,42,0.04)]"
        data-testid="home-apps-dock"
      >
        <h2 className="mr-1 text-[11.5px] font-medium text-[var(--nimi-text-muted)]">
          {t('runtimeConfig.overview.appsWorkbench.dockTitle')}
        </h2>
        <span className="mx-1 h-4.5 w-px bg-[var(--nimi-border-subtle)]" aria-hidden="true" />

        {dock.items.map((item) => {
          if (item.kind === 'bundled-zhiyu') {
            return (
              <div
                key={item.key}
                data-testid="bundled-zhiyu"
                className="group/tile relative flex flex-col items-center"
              >
                <Tooltip content={bundledZhiyuName} placement="top">
                  <button
                    type="button"
                    disabled={zhiyuBusy}
                    onClick={() => void openZhiyu()}
                    aria-label={t('Apps.bundled.openZhiyu')}
                    className="relative flex size-9 items-center justify-center rounded-[10px] pb-0.5 transition-[transform,opacity,background-color,box-shadow] duration-150 hover:bg-[var(--nimi-home-whisper-surface-hover)] hover:shadow-[var(--nimi-elevation-base)] active:scale-[0.95] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] disabled:opacity-60"
                  >
                    <span className="flex size-7 items-center justify-center">
                      <HomeDockArtwork
                        appId="nimi.zhiyu"
                        displayName={bundledZhiyuName}
                        iconUrl={zhiyuIcon}
                      />
                    </span>
                    {zhiyuBusy ? (
                      <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-[var(--nimi-home-porcelain-card)] text-[var(--nimi-action-primary-bg)] shadow-[var(--nimi-elevation-base)]">
                        <LoaderCircle size={10} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      </span>
                    ) : null}
                  </button>
                </Tooltip>
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
              className="group/tile relative flex flex-col items-center"
            >
              <Tooltip content={tooltipText} placement="top">
                <button
                  type="button"
                  disabled={isBusy}
                  aria-label={tooltipText}
                  onClick={() => handleActivateApp(entry, running, starting)}
                  onContextMenu={(event) => handleContextMenu(event, group.appId, entry.identity.entryKey)}
                  data-testid={`home-app:${group.appId}`}
                  className="relative flex size-9 items-center justify-center rounded-[10px] pb-0.5 transition-[transform,opacity,background-color,box-shadow] duration-150 hover:bg-[var(--nimi-home-whisper-surface-hover)] hover:shadow-[var(--nimi-elevation-base)] active:scale-[0.95] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] disabled:opacity-70"
                >
                  <span className="flex size-7 items-center justify-center">
                    <HomeDockArtwork
                      appId={group.appId}
                      displayName={group.displayName}
                      iconUrl={resolvedIconUrl}
                    />
                  </span>
                  {isBusy ? (
                    <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-[var(--nimi-home-porcelain-card)] text-[var(--nimi-action-primary-bg)] shadow-[var(--nimi-elevation-base)]">
                      <LoaderCircle size={10} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    </span>
                  ) : hasUpdate ? (
                    <span
                      className="absolute right-0 top-0 flex size-3.5 items-center justify-center rounded-full bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] ring-2 ring-[var(--nimi-surface-canvas)] transition-opacity group-hover/tile:opacity-0"
                      aria-hidden="true"
                    >
                      <ArrowUp size={8} />
                    </span>
                  ) : null}
                  {disambiguator && entry.localDevelopment && !entry.committedRelease ? (
                    <span
                      className="absolute bottom-0.5 left-0.5 flex size-3.5 items-center justify-center rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] shadow-xs"
                      aria-hidden="true"
                    >
                      <Code2 size={8} />
                    </span>
                  ) : null}
                  <span
                    className={`absolute -bottom-0.5 size-1 rounded-full transition-colors ${
                      active ? 'bg-[var(--nimi-status-success)]' : 'bg-transparent'
                    }`}
                    data-testid={active ? `home-app-running:${group.appId}` : undefined}
                    aria-hidden="true"
                  />
                </button>
              </Tooltip>

              <Tooltip content={t('runtimeConfig.overview.appsWorkbench.manageAction')} placement="top">
                <button
                  type="button"
                  aria-label={`${group.displayName} · ${t('runtimeConfig.overview.appsWorkbench.manageAction')}`}
                  onClick={() => handleOpenAppDetail(group.appId, entry.identity.entryKey)}
                  data-testid={`home-app-manage:${group.appId}`}
                  className="absolute -right-1 -top-1 flex size-4.5 items-center justify-center rounded-full bg-[var(--nimi-home-porcelain-card)] text-[var(--nimi-text-secondary)] opacity-0 shadow-[var(--nimi-home-porcelain-shadow)] transition-opacity duration-150 hover:text-[var(--nimi-text-primary)] group-hover/tile:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                >
                  <Settings size={10} aria-hidden="true" />
                </button>
              </Tooltip>
            </div>
          );
        })}

        {showOverflowTile || !loading ? (
          <span className="mx-1 h-4.5 w-px bg-[var(--nimi-border-subtle)]" aria-hidden="true" />
        ) : null}

        {showOverflowTile ? (
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
              className="inline-flex h-7 items-center justify-center rounded-[8px] border border-dashed border-[var(--nimi-border-strong)] bg-[var(--nimi-home-soft-well)]/80 px-2 text-[11.5px] font-semibold tabular-nums text-[var(--nimi-text-secondary)] transition-[transform,background-color,border-color,color] duration-150 hover:border-solid hover:border-[var(--nimi-action-primary-bg)]/40 hover:bg-[var(--nimi-home-porcelain-card)] hover:text-[var(--nimi-text-primary)] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
            >
              <span>+{dock.overflowCount}</span>
            </button>
          </Tooltip>
        ) : !loading ? (
          <Tooltip content={t('runtimeConfig.overview.allApps')} placement="top">
            <button
              type="button"
              onClick={onOpenAllApps}
              aria-label={t('runtimeConfig.overview.allApps')}
              data-testid="home-apps-more-tile"
              className="inline-flex size-7 items-center justify-center rounded-[8px] border border-dashed border-[var(--nimi-border-strong)] bg-[var(--nimi-home-soft-well)]/80 text-[var(--nimi-text-secondary)] transition-[transform,background-color,border-color,color] duration-150 hover:border-solid hover:border-[var(--nimi-action-primary-bg)]/40 hover:bg-[var(--nimi-home-porcelain-card)] hover:text-[var(--nimi-text-primary)] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
            >
              <Plus size={14} aria-hidden="true" />
            </button>
          </Tooltip>
        ) : null}
      </div>
    </section>
  );
}
