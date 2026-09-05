import { useCallback, useEffect, type ReactElement } from 'react';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useDesktopRendererCommands, useDesktopRendererSdk } from '../../renderer/binding-context.js';
import type { AppCardActionId } from './apps-card-actions.js';
import { useAppsPanelController } from './apps-panel-controller.js';
import { AppsPanelView } from './apps-panel-view.js';
import { startAppsPackageInstall } from './apps-install-runtime.js';
import { finishInstalledAppUninstall } from './apps-installed-bridge.js';
import type { DesktopAppsEntry } from './apps-panel-projection.js';
import {
  AppPackageJobPhase,
  AppPackageJobKind,
  AppPackageSourceClass,
  ReasonCode,
  type AppPackageJob,
  type CancelAppPackageJobResponse,
} from '@nimiplatform/sdk/runtime/wire-types';

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
  readonly setAppsDetailAppId: (appId: string | null) => void;
  readonly runCardAction: (entryKey: string, action: AppCardActionId) => void;
}): void {
  if (input.action === 'details') {
    input.setAppsDetailAppId(input.appId);
  }
  input.runCardAction(input.entryKey, input.action);
}

export function AppsPanel(): ReactElement {
  const settings = useDesktopRendererCommands().settings;
  const sdk = useDesktopRendererSdk();
  const requestedDetailAppId = useAppStore((state) => state.appsDetailAppId);
  const requestedDetailSection = useAppStore((state) => state.appsDetailSection);
  const requestedDetailNavigationRevision = useAppStore((state) => state.appsDetailNavigationRevision);
  const setAppsDetailAppId = useAppStore((state) => state.setAppsDetailAppId);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const readAppAIConfig = useCallback(
    (appId: string, options: { readonly timeoutMs: number; readonly signal: AbortSignal }) => (
      sdk.accountProduct().appAIConfig(appId).get(options)
    ),
    [sdk],
  );
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
  const listPackageJobs = useCallback(async () => {
    const response = await sdk.machineProduct().apps.listAppPackageJobs({});
    if (response.reasonCode !== ReasonCode.ACTION_EXECUTED) {
      throw new Error(`Runtime rejected App package jobs list: ${String(response.reasonCode)}`);
    }
    return response.jobs;
  }, [sdk]);
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
      || job.sourceClass !== AppPackageSourceClass.VERIFIED || job.phase !== AppPackageJobPhase.QUEUED) {
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
    cancelPackageJob,
    listApprovedCatalogTargets,
    startInstall,
    uninstall,
    listCommittedReleases,
    listPackageJobs,
    readAppAIConfig,
  });
  const {
    projection,
    detailEntryKey,
    searchQuery,
    actionError,
    activeAction,
    installConfirmation,
    runCardAction,
    setSearchQuery,
    retryProjection,
    closeDetail,
    acknowledgeAIConfigMutation,
    confirmInstall,
    cancelInstall,
  } = controller;
  const handleCardAction = useCallback((entryKey: string, action: AppCardActionId): void => {
    const entry = projection?.status === 'loaded'
      ? projection.entries.find((candidate) => candidate.identity.entryKey === entryKey)
      : null;
    if (!entry) return;
    dispatchAppsPanelCardAction({
      entryKey,
      appId: entry.identity.appId,
      action,
      setAppsDetailAppId,
      runCardAction,
    });
  }, [projection, runCardAction, setAppsDetailAppId]);

  useEffect(() => {
    if (!requestedDetailAppId || projection?.status !== 'loaded') return;
    const candidates = projection.entries.filter((entry) => entry.identity.appId === requestedDetailAppId);
    if (candidates.length === 1) runCardAction(candidates[0]!.identity.entryKey, 'details');
  }, [projection, requestedDetailAppId, requestedDetailNavigationRevision, runCardAction]);

  const selectedEntry = projection?.status === 'loaded'
    ? projection.entries.find((entry) => entry.identity.entryKey === detailEntryKey) ?? null
    : null;

  return (
    <div data-testid="apps-panel" className="flex min-h-0 flex-1 flex-col">
      <AppsPanelView
        projection={projection}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedEntryKey={detailEntryKey}
        requestedDetailSection={requestedDetailAppId === selectedEntry?.identity.appId ? requestedDetailSection : null}
        requestedDetailNavigationRevision={requestedDetailNavigationRevision}
        onCardAction={handleCardAction}
        onBack={() => {
          setAppsDetailAppId(null);
          closeDetail();
        }}
        onOpenDeveloperMode={() => {
          settings.openSection('developer');
          setActiveTab('settings');
        }}
        onRetry={retryProjection}
        onAIConfigChanged={acknowledgeAIConfigMutation}
        actionError={actionError}
        activeAction={activeAction}
        installConfirmation={installConfirmation}
        onConfirmInstall={confirmInstall}
        onCancelInstall={cancelInstall}
      />
    </div>
  );
}
