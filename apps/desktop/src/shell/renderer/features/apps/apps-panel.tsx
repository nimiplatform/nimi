import { useHomeNavigation, useHomeDestination, useHomeEntryKey } from '../../app-shell/providers/app-store.js';
import type { GetAppPackageInfoRequest } from '@nimiplatform/sdk/runtime/wire-types';
import { useCallback, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { HomeNavigation } from '../../app-shell/providers/home-navigation.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import type { AppCardActionId } from './apps-card-actions.js';
import { useAppsPanelController } from './apps-panel-controller.js';
import { AppsPanelView } from './apps-panel-view.js';
import { startAppsPackageInstall, startAppsPackageUpdate } from './apps-install-runtime.js';
import { finishInstalledAppUninstall } from './apps-installed-bridge.js';
import { AppsLocalImportFeedback, useAppsLocalImport } from './apps-local-import.js';
import { packageJobKey } from './apps-downloads-observer.js';
import { useAppsDownloads } from './apps-downloads-context.js';
import { catalogTargetMatchesJob } from './apps-downloads-view.js';
import { resolveRequestedAppDetailEntry, type DesktopAppsEntry } from './apps-panel-projection.js';
import { AppPackageJobPhase, AppPackageJobKind, AppPackageSourceClass, ReasonCode, type AppPackageJob, type CancelAppPackageJobResponse } from '@nimiplatform/sdk/runtime/wire-types';

export function assertCanceledPackageJobResponse(
  requested: AppPackageJob,
  response: CancelAppPackageJobResponse,
): void {
  const returned = response.job;
  const sameJobId = returned
    && returned.jobId.length === requested.jobId.length
    && returned.jobId.every((value, index) => value === requested.jobId[index]);
  if (
    response.reasonCode !== ReasonCode.ACTION_EXECUTED
    || !returned
    || !sameJobId
    || returned.phase !== AppPackageJobPhase.CANCELED
  ) {
    throw new Error(`Runtime rejected App package job cancellation: ${String(response.reasonCode)}`);
  }
}

export function dispatchAppsPanelCardAction(input: {
  readonly entryKey: string;
  readonly appId: string;
  readonly action: AppCardActionId;
  readonly navigation: HomeNavigation;
  readonly runCardAction: (entryKey: string, action: AppCardActionId) => void;
}): void {
  if (input.action === 'details' || input.action === 'open-ai-config') {
    void input.navigation.push({ id: 'apps', appId: input.appId, appSection: input.action === 'open-ai-config' ? 'ai-models' : undefined, appEntryKey: input.entryKey });
    return;
  }
  input.runCardAction(input.entryKey, input.action);
}

export function AppsPanel({
  downloadsOnly = false,
}: { readonly downloadsOnly?: boolean } = {}): ReactElement {
  const navigation = useHomeNavigation();
  const { t } = useTranslation();
  const downloads = useAppsDownloads();
  if (!downloads) throw new Error('APPS_DOWNLOADS_PROVIDER_MISSING');
  const sdk = useDesktopRendererSdk();
  const requestedDetailAppId = useHomeDestination().appId ?? null;
  const requestedDetailEntryKey = useHomeDestination().appEntryKey ?? null;
  const requestedDetailSection = useHomeDestination().appSection ?? null;
  const navigationEntryKey = useHomeEntryKey();

  const readAppAIConfig = useCallback(
    (appId: string, options: { readonly timeoutMs: number; readonly signal: AbortSignal }) => (
      sdk.accountProduct().appAIConfig(appId).get(options)
    ),
    [sdk],
  );
  const readPackageInfo = useCallback(async (request: GetAppPackageInfoRequest) => {
    const response = await sdk.machineProduct().apps.getAppPackageInfo(request);
    if (response.reasonCode !== ReasonCode.ACTION_EXECUTED || !response.info) throw new Error('App information is unavailable');
    return response.info;
  }, [sdk]);
  const listCommittedReleases = useCallback(async () => {
    const response = await sdk.machineProduct().apps.listCommittedAppReleases({});
    if (response.reasonCode !== ReasonCode.ACTION_EXECUTED) {
      throw new Error(`Runtime rejected committed App releases list: ${String(response.reasonCode)}`);
    }
    return response.releases;
  }, [sdk]);
  const listApprovedCatalogTargets = useCallback(async () => {
    const response = await sdk.machineProduct().apps.listApprovedAppCatalogTargets({});
    if (response.reasonCode !== ReasonCode.ACTION_EXECUTED) {
      throw new Error(`Runtime rejected approved App Catalog: ${String(response.reasonCode)}`);
    }
    return response.targets;
  }, [sdk]);
  const startInstall = useCallback((approvedTargetSelector: Uint8Array) => (
    startAppsPackageInstall(sdk.machineProduct().apps.startAppPackageInstall, approvedTargetSelector)
  ), [sdk]);
  const startUpdate = useCallback((approvedTargetSelector: Uint8Array, launchSelector: Uint8Array, installedVersion: string) => (
    startAppsPackageUpdate(sdk.machineProduct().apps.startAppPackageUpdate, approvedTargetSelector, launchSelector, installedVersion)
  ), [sdk]);
  const listPackageJobs = useCallback(async () => {
    await downloads.observer.refresh();
    const snapshot = downloads.observer.getSnapshot();
    if (snapshot.status !== 'ready') throw new Error(snapshot.error ?? 'App jobs are unavailable');
    return snapshot.jobs;
  }, [downloads.observer]);
  const cancelPackageJob = useCallback(async (job: AppPackageJob) => {
    const response = await sdk.machineProduct().apps.cancelAppPackageJob({
      jobId: job.jobId,
      expectedPhase: job.phase,
      reasonCode: 'user-canceled',
    });
    assertCanceledPackageJobResponse(job, response);
  }, [sdk]);
  const uninstall = useCallback(async (entry: DesktopAppsEntry) => {
    const release = entry.committedRelease;
    if (!release) throw new Error('App is not installed');
    const selector = release.launchSelector.slice();
    const response = await sdk.machineProduct().apps.startAppPackageUninstall({ launchSelector: selector });
    const job = response.job;
    if (response.reasonCode !== ReasonCode.ACTION_EXECUTED || !job || job.jobId.length === 0
      || job.appId !== entry.identity.appId || job.targetRef !== release.releaseRef || job.kind !== AppPackageJobKind.UNINSTALL
      || job.sourceClass !== release.sourceClass || job.phase !== AppPackageJobPhase.QUEUED) {
      throw new Error('Runtime did not reserve the exact App uninstall');
    }
    try {
      await finishInstalledAppUninstall(job.jobId.slice(), selector);
    } catch (error) {
      const current = await sdk.machineProduct().apps.getAppPackageJob({ jobId: job.jobId }).catch(() => null);
      if (current?.job?.phase === AppPackageJobPhase.QUEUED && current.job.cancelable) {
        await sdk.machineProduct().apps.cancelAppPackageJob({ jobId: job.jobId, expectedPhase: AppPackageJobPhase.QUEUED, reasonCode: 'uninstall-not-completed' }).catch(() => undefined);
      }
      throw error;
    }
  }, [sdk]);
  const controller = useAppsPanelController({
    selectedEntryKey: requestedDetailEntryKey,
    cancelPackageJob,
    listApprovedCatalogTargets,
    startInstall,
    startUpdate,
    uninstall,
    listCommittedReleases,
    listPackageJobs,
    readAppAIConfig,
    readPackageInfo,
  });
  const {
    projection,
    searchQuery,
    actionError,
    pendingActions,
    installConfirmation,
    runCardAction,
    setSearchQuery,
    retryProjection,
    acknowledgeAIConfigMutation,
    confirmInstall,
    cancelInstall,
  } = controller;
  const getLocalImportClient = useCallback(() => sdk.machineProduct().apps, [sdk]);
  const localImportStarted = useCallback((job: AppPackageJob) => {
    void navigation.replace({ id: 'apps' });
    void downloads.observer.refresh();
    downloads.openDownloads(packageJobKey(job));
  }, [navigation, downloads.observer, downloads.openDownloads]);
  const localImport = useAppsLocalImport(getLocalImportClient, localImportStarted);
  const handleCardAction = useCallback((entryKey: string, action: AppCardActionId): void => {
    if (action === 'details' || action === 'open-ai-config') downloads.showLibrary();
    const entry = projection?.status === 'loaded'
      ? projection.entries.find((candidate) => candidate.identity.entryKey === entryKey)
      : null;
    if (!entry) return;
    if (action === 'update' && entry.committedRelease?.sourceClass === AppPackageSourceClass.USER_IMPORTED) {
      void localImport.choose(entry.committedRelease);
      return;
    }
    dispatchAppsPanelCardAction({
      entryKey,
      appId: entry.identity.appId,
      action,
      navigation,
      runCardAction,
    });
  }, [downloads.showLibrary, projection, runCardAction, navigation, localImport.choose]);

  // A link that names an App with several sources lists those sources for the
  // user to choose; it never guesses one.
  const selectedEntry = requestedDetailAppId && projection?.status === 'loaded'
    ? resolveRequestedAppDetailEntry(projection.entries, requestedDetailAppId, requestedDetailEntryKey) : null;
  const detailEntryKey = selectedEntry?.identity.entryKey ?? null;
  const sources = requestedDetailAppId && projection?.status === 'loaded' ? projection.entries.filter(entry => entry.identity.appId === requestedDetailAppId) : [];
  const sourceChoice = !detailEntryKey && !requestedDetailEntryKey && sources.length > 1 ? sources[0]!.identity.displayName || requestedDetailAppId : null;

  const viewDownloadApp = (job: AppPackageJob) => {
    downloads.showLibrary();
    const entry = projection?.status === 'loaded' ? projection.entries.find((candidate) => candidate.identity.appId === job.appId && candidate.identity.sourceClass === (job.sourceClass === AppPackageSourceClass.USER_IMPORTED ? 'user_imported' : 'verified')) : null;
    if (entry) handleCardAction(entry.identity.entryKey, 'details');
    else { void navigation.push({ id: 'apps', appId: job.appId }); setSearchQuery(job.appId); }
  };

  return (
    <div data-testid="apps-panel" className="flex min-h-0 flex-1 flex-col">
      <AppsLocalImportFeedback state={localImport} />
      <AppsPanelView
        downloadsOnly={downloadsOnly}
        downloads={downloads}
        onViewDownloadApp={(job) => {
          viewDownloadApp(job);
        }}
        onRetryDownload={(job) => {
          if (job.sourceClass === AppPackageSourceClass.USER_IMPORTED) {
            const installed = projection?.status === 'loaded' ? projection.entries.find((entry) => entry.identity.sourceClass === 'user_imported' && entry.identity.appId === job.appId)?.committedRelease ?? null : null;
            void localImport.choose(job.kind === AppPackageJobKind.UPDATE ? installed : null);
            return;
          }
          const entry = projection?.status === 'loaded' ? projection.entries.find((candidate) => candidate.identity.appId === job.appId && candidate.identity.sourceClass === (job.sourceClass === AppPackageSourceClass.USER_IMPORTED ? 'user_imported' : 'verified')) : null;
          viewDownloadApp(job);
          // Retry the same selected release through the existing confirmation.
          // A changed selection stays in App detail for a new explicit choice.
          if (entry && catalogTargetMatchesJob(entry.catalogTarget, job)) runCardAction(entry.identity.entryKey, job.kind === AppPackageJobKind.UPDATE ? 'update' : 'install');
        }}
        projection={projection}
        searchQuery={sourceChoice ? requestedDetailAppId! : searchQuery}
        onSearchChange={setSearchQuery}
        sourceChoiceNotice={sourceChoice && !detailEntryKey ? t('Apps.chooseSource', { app: sourceChoice }) : null}
        selectedEntryKey={detailEntryKey}
        requestedDetailSection={
          requestedDetailAppId === selectedEntry?.identity.appId ? requestedDetailSection : null
        }
        navigationEntryKey={navigationEntryKey}
        onCardAction={handleCardAction}
        onBack={() => {
          void navigation.back();
        }}
        onImportLocal={() => void localImport.choose()}
        onOpenDeveloperMode={() => {
          void navigation.push({ id: 'settings', settingsSection: 'developer' });
        }}
        onRetry={retryProjection}
        onAIConfigChanged={acknowledgeAIConfigMutation}
        actionError={actionError}
        pendingActions={pendingActions}
        installConfirmation={installConfirmation}
        onConfirmInstall={confirmInstall}
        onCancelInstall={cancelInstall}
        readPackageInfo={readPackageInfo}
      />
    </div>
  );
}
