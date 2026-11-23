import { AppCardSurface, Button, ProgressIndicator } from '@nimiplatform/kit/ui';
import { DesktopAIExecutionRoute, type DesktopAIExecution } from '@nimiplatform/sdk/runtime/generated';
import { Activity, Download, Layers3 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HOME_FOCUS_APP_WINDOW, type SystemEntryFocusSource } from '../../../shared/system-entry-types.js';
import { invokeChecked } from '../../bridge/runtime-bridge/invoke.js';
import { formatBytes, formatTransferRate } from '../../components/download-format.js';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast.js';
import { isLocalDevelopmentRunActive } from '../apps/apps-card-actions.js';
import { AppArtworkIcon } from '../apps/apps-card-visuals.js';
import { groupAppsEntries } from '../apps/apps-entry-groups.js';
import type { DesktopAppsEntry } from '../apps/apps-panel-projection.js';
import { displayRuntimeConfigCapabilityLabel } from '../runtime-config/runtime-config-capability-labels.js';
import type { SystemEntryAIState } from '../system-entry/system-entry-ai-model.js';

export type HomeActiveDownloadItem = Readonly<{
  id: string;
  title: string;
  bytesReceived: number;
  bytesTotal: number | null;
  speedBytesPerSec: number | null | undefined;
}>;

export type HomeActiveWorkCardViewProps = {
  runningApps: readonly DesktopAppsEntry[];
  iconUrls: ReadonlyMap<string, string | null>;
  executions: readonly DesktopAIExecution[];
  downloads: readonly HomeActiveDownloadItem[];
  focusingKey: string | null;
  onFocusApp: (entry: DesktopAppsEntry) => void;
  onOpenApp: (appId: string, entryKey: string) => void;
  onOpenActivity: () => void;
  onOpenDownloads: () => void;
};

export async function focusRunningDesktopApp(entry: DesktopAppsEntry, generation: string | null): Promise<void> {
  if (!generation || entry.run?.state !== 'running') throw new Error('home-app-focus-unavailable');
  let source: SystemEntryFocusSource;
  if (entry.localDevelopment) {
    source = { kind: 'local-development', selector: entry.localDevelopment.selector };
  } else if (entry.committedRelease) {
    source = { kind: 'installed', launchSelector: [...entry.committedRelease.launchSelector] };
  } else {
    throw new Error('home-app-focus-unavailable');
  }
  await invokeChecked(HOME_FOCUS_APP_WINDOW, { payload: { generation, source } }, (value) => {
    if (!value || typeof value !== 'object' || Object.keys(value).join('|') !== 'focused'
      || !('focused' in value) || value.focused !== true) throw new Error('home-app-focus-failed');
  });
}

export function activeExecutionsFromAI(ai: SystemEntryAIState | null): readonly DesktopAIExecution[] {
  if (ai?.activity.status !== 'ready' || !ai.activity.value) return [];
  return ai.activity.value.executions.slice(0, 3);
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.home-system-activity
export function HomeActiveWorkCardView({
  runningApps,
  iconUrls,
  executions,
  downloads,
  focusingKey,
  onFocusApp,
  onOpenApp,
  onOpenActivity,
  onOpenDownloads,
}: HomeActiveWorkCardViewProps) {
  const { t } = useTranslation();
  if (!runningApps.length && !executions.length && !downloads.length) {
    return null;
  }

  return (
    <AppCardSurface
      kind="promoted-glass"
      className="flex min-w-0 flex-col gap-3 rounded-3xl border-transparent! bg-[var(--nimi-home-porcelain-card)]! p-6 shadow-[var(--nimi-home-porcelain-shadow)]!"
      data-testid="home-active-work"
    >
      <header className="flex items-center gap-2">
        <span className="size-2 shrink-0 rounded-full bg-[var(--nimi-status-success)]" aria-hidden="true" />
        <h2 className="text-[15px] font-semibold tracking-tight text-[var(--nimi-text-primary)]">
          {t('runtimeConfig.overview.activeWork.title')}
        </h2>
      </header>

      <div className="flex flex-col gap-2.5">
        {runningApps.map((entry) => {
          const isRunning = entry.run?.state === 'running';
          return (
            <div
              key={entry.identity.entryKey}
              className="flex min-w-0 items-center justify-between gap-3 rounded-2xl bg-[var(--nimi-home-soft-well)] px-4 py-3"
              data-testid={`home-active-app:${entry.identity.appId}`}
            >
              <button
                type="button"
                onClick={() => onOpenApp(entry.identity.appId, entry.identity.entryKey)}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              >
                <AppArtworkIcon
                  appId={entry.identity.appId}
                  displayName={entry.identity.displayName}
                  iconUrl={iconUrls.get(entry.identity.appId) ?? null}
                  size="sm"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--nimi-text-primary)]">{entry.identity.displayName}</span>
                  <span className="flex items-center gap-1.5 text-xs text-[var(--nimi-status-success)]">
                    <span className="size-1.5 rounded-full bg-[var(--nimi-status-success)]" aria-hidden="true" />
                    {t(isRunning ? 'runtimeConfig.overview.activeWork.appRunning' : 'runtimeConfig.overview.activeWork.appStarting')}
                  </span>
                </span>
              </button>
              {isRunning ? (
                <Button
                  tone="secondary"
                  size="sm"
                  loading={focusingKey === entry.identity.entryKey}
                  onClick={() => onFocusApp(entry)}
                  data-testid={`home-focus-app:${entry.identity.appId}`}
                >
                  {t('runtimeConfig.overview.activeWork.focusWindow')}
                </Button>
              ) : null}
            </div>
          );
        })}

        {executions.map((execution) => {
          const model = execution.models[0];
          const routeLabel = execution.route === DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_LOCAL
            ? t('runtimeConfig.systemEntry.local')
            : execution.route === DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_CLOUD
              ? t('runtimeConfig.systemEntry.cloud')
              : t('runtimeConfig.systemEntry.routeUnknown');
          return (
            <div
              key={execution.attemptId}
              className="flex min-w-0 items-center justify-between gap-3 rounded-2xl bg-[var(--nimi-home-soft-well)] px-4 py-3"
              data-testid={`home-active-execution:${execution.attemptId}`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--nimi-home-porcelain-card)] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]">
                  {execution.parentWorkId ? <Layers3 size={15} aria-hidden="true" /> : <Activity size={15} aria-hidden="true" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">
                    {execution.sourceLabel || t('runtimeConfig.overview.activeWork.aiRunning')}
                  </p>
                  <p className="truncate text-xs text-[var(--nimi-text-secondary)]">
                    {[
                      displayRuntimeConfigCapabilityLabel(execution.capability, t),
                      routeLabel,
                      model?.displayName || model?.modelId,
                    ].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
              <Button tone="ghost" size="sm" onClick={onOpenActivity}>
                {t('runtimeConfig.overview.activeWork.viewActivity')}
              </Button>
            </div>
          );
        })}

        {downloads.map((item) => (
          <div
            key={item.id}
            className="flex min-w-0 flex-col gap-1.5 rounded-2xl bg-[var(--nimi-home-soft-well)] px-4 py-3"
            data-testid={`home-active-download:${item.id}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-[var(--nimi-text-primary)]">
                <Download size={14} aria-hidden="true" className="shrink-0 text-[var(--nimi-text-secondary)]" />
                <span className="truncate">{item.title}</span>
              </span>
              <Button tone="ghost" size="sm" onClick={onOpenDownloads}>
                {t('runtimeConfig.overview.activeWork.viewDownloads')}
              </Button>
            </div>
            {item.bytesTotal ? (
              <ProgressIndicator value={item.bytesReceived} max={item.bytesTotal} showValue aria-label={item.title} />
            ) : null}
            <p className="text-xs tabular-nums text-[var(--nimi-text-secondary)]">
              {[
                item.bytesTotal
                  ? `${formatBytes(item.bytesReceived)} / ${formatBytes(item.bytesTotal)}`
                  : formatBytes(item.bytesReceived),
                formatTransferRate(item.speedBytesPerSec ?? undefined),
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
        ))}
      </div>
    </AppCardSurface>
  );
}

export function HomeActiveWorkCard({
  entries,
  focusGeneration,
  iconUrls,
  ai,
  downloads,
  onOpenApp,
  onOpenActivity,
  onOpenDownloads,
}: {
  entries: readonly DesktopAppsEntry[];
  focusGeneration: string | null;
  iconUrls: ReadonlyMap<string, string | null>;
  ai: SystemEntryAIState | null;
  downloads: readonly HomeActiveDownloadItem[];
  onOpenApp: (appId: string, entryKey: string) => void;
  onOpenActivity: () => void;
  onOpenDownloads: () => void;
}) {
  const { t } = useTranslation();
  const [focusingKey, setFocusingKey] = useState<string | null>(null);
  const runningApps = groupAppsEntries(entries.filter((entry) => entry.run && isLocalDevelopmentRunActive(entry.run.state)))
    .map((group) => group.entries.find((entry) => entry.run?.state === 'running') ?? group.primary);
  const executions = activeExecutionsFromAI(ai);

  const handleFocus = (entry: DesktopAppsEntry) => {
    setFocusingKey(entry.identity.entryKey);
    void focusRunningDesktopApp(entry, focusGeneration)
      .catch(() => emitFeedbackToast({ kind: 'error', message: t('runtimeConfig.overview.activeWork.focusFailed') }))
      .finally(() => setFocusingKey(null));
  };

  return (
    <HomeActiveWorkCardView
      runningApps={runningApps}
      iconUrls={iconUrls}
      executions={executions}
      downloads={downloads}
      focusingKey={focusingKey}
      onFocusApp={handleFocus}
      onOpenApp={onOpenApp}
      onOpenActivity={onOpenActivity}
      onOpenDownloads={onOpenDownloads}
    />
  );
}
