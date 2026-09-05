// Renderer controller for the Desktop Apps projection and host-owned run actions.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppCardActionId } from './apps-card-actions.js';
import { canRequestCatalogInstall } from './apps-card-actions.js';
import type {
  AppsInstallIntentController,
  AppsInstallIntentResult,
  AppsInstallIntentSnapshot,
  AppsInstallStartResult,
} from './apps-install-intent.js';
import { approvedCatalogTargetMatchesIntent, createAppsInstallIntentController } from './apps-install-intent.js';
import { resolveDetailEntryKey } from './apps-card-fields.js';
import { createDesktopAppsLiveBridge } from './apps-live-bridge.js';
import {
  desktopAppsEntryKey,
  projectAppsPanel,
  summarizeAppAIConfig,
  type DesktopAppAIConfigReadOptions,
  type DesktopAppsEntry,
  type DesktopAppsPanelProjection,
  type DesktopAppsProjectionSource,
} from './apps-panel-projection.js';
import type {
  NimiAIConfigOverwriteResult,
  NimiAIConfigSnapshot,
} from '@nimiplatform/kit/core/sdk-contract';
import type { AppPackageJob } from '@nimiplatform/sdk/runtime/wire-types';

export interface AppsPanelState {
  readonly projection: DesktopAppsPanelProjection | null;
  readonly detailEntryKey: string | null;
  readonly searchQuery: string;
  readonly actionError: string | null;
  readonly activeAction: Readonly<{ entryKey: string; action: AppCardActionId }> | null;
  readonly installConfirmation: AppsInstallIntentSnapshot | null;
}

export interface AppsPanelActions {
  readonly setSearchQuery: (query: string) => void;
  readonly runCardAction: (entryKey: string, action: AppCardActionId) => void;
  readonly retryProjection: () => void;
  readonly closeDetail: () => void;
  readonly acknowledgeAIConfigMutation: (entryKey: string, result: NimiAIConfigOverwriteResult) => void;
  readonly confirmInstall: () => void;
  readonly cancelInstall: () => void;
}

export type AppsPanelController = AppsPanelState & AppsPanelActions;

export interface AppsPanelControllerDeps {
  readonly buildLiveBridge?: typeof createDesktopAppsLiveBridge;
  readonly listCommittedReleases: DesktopAppsProjectionSource['listCommittedReleases'];
  readonly listPackageJobs: DesktopAppsProjectionSource['listPackageJobs'];
  readonly listApprovedCatalogTargets?: DesktopAppsProjectionSource['listApprovedCatalogTargets'];
  readonly cancelPackageJob: (job: AppPackageJob) => Promise<void>;
  readonly startInstall?: (approvedTargetSelector: Uint8Array) => Promise<AppsInstallStartResult>;
  readonly uninstall?: (entry: DesktopAppsEntry) => Promise<void>;
  readonly readAppAIConfig?: (
    appId: string,
    options: DesktopAppAIConfigReadOptions,
  ) => Promise<NimiAIConfigSnapshot>;
}

type AppsPanelReloadLane = 'lifecycle' | 'ai-config';

export interface AppsPanelProjectionReloader {
  reload(refreshAIConfig?: boolean): Promise<void>;
  dispose(): void;
}

export function mergeAppsPanelProjection(
  current: DesktopAppsPanelProjection | null,
  next: DesktopAppsPanelProjection,
  lane: AppsPanelReloadLane,
): DesktopAppsPanelProjection {
  if (current?.status !== 'loaded' || next.status !== 'loaded') return next;
  if (lane === 'lifecycle') {
    const currentByKey = new Map(current.entries.map((entry) => [entry.identity.entryKey, entry]));
    return {
      status: 'loaded',
      catalogStatus: next.catalogStatus,
      runtimeError: next.runtimeError,
      entries: next.entries.map((entry) => {
        const currentEntry = currentByKey.get(entry.identity.entryKey);
        return {
          ...entry,
          aiConfigSummary: currentEntry ? currentEntry.aiConfigSummary : entry.aiConfigSummary,
        };
      }),
    };
  }
  const refreshedByKey = new Map(next.entries.map((entry) => [entry.identity.entryKey, entry]));
  return {
    status: 'loaded',
    catalogStatus: next.catalogStatus,
    runtimeError: next.runtimeError,
    entries: current.entries.map((entry) => {
      const refreshedEntry = refreshedByKey.get(entry.identity.entryKey);
      return {
        ...entry,
        aiConfigSummary: refreshedEntry ? refreshedEntry.aiConfigSummary : entry.aiConfigSummary,
      };
    }),
  };
}

export function applyAppsPanelAIConfigAcknowledgement(
  current: DesktopAppsPanelProjection | null,
  entryKey: string,
  result: NimiAIConfigOverwriteResult,
): DesktopAppsPanelProjection | null {
  if (current?.status !== 'loaded') return current;
  let matched = false;
  const aiConfigSummary = summarizeAppAIConfig({
    config: result.config,
    revision: result.revision,
    effectiveSelections: [],
  });
  const entries = current.entries.map((entry) => {
    if (entry.identity.entryKey !== entryKey) return entry;
    matched = true;
    return { ...entry, aiConfigSummary };
  });
  return matched ? {
    status: 'loaded', entries, catalogStatus: current.catalogStatus, runtimeError: current.runtimeError,
  } : current;
}

export function requestAppsInstallFromDetail(
  entry: DesktopAppsEntry,
  controller: AppsInstallIntentController,
): Promise<AppsInstallIntentResult> {
  if (!canRequestCatalogInstall(entry) || !entry.catalogTarget) {
    throw new Error('Approved App target is not installable');
  }
  return controller.requestInstall(entry.catalogTarget);
}

export function createAppsPanelProjectionReloader(input: {
  readonly source: DesktopAppsProjectionSource;
  readonly getCurrent: () => DesktopAppsPanelProjection | null;
  readonly commit: (projection: DesktopAppsPanelProjection) => void;
}): AppsPanelProjectionReloader {
  let disposed = false;
  const inFlight: Record<AppsPanelReloadLane, Promise<void> | null> = {
    lifecycle: null,
    'ai-config': null,
  };
  const latestRevision: Record<AppsPanelReloadLane, number> = {
    lifecycle: 0,
    'ai-config': 0,
  };
  const reload = (refreshAIConfig = true): Promise<void> => {
    const lane: AppsPanelReloadLane = refreshAIConfig ? 'ai-config' : 'lifecycle';
    const existing = inFlight[lane];
    if (existing) return existing;
    const revision = latestRevision[lane] + 1;
    latestRevision[lane] = revision;
    const task = projectAppsPanel(input.source, {
      previous: input.getCurrent(),
      refreshAIConfig,
    }).then((next) => {
      if (
        disposed
        || latestRevision[lane] !== revision
      ) return;
      input.commit(mergeAppsPanelProjection(input.getCurrent(), next, lane));
    }).finally(() => {
      if (inFlight[lane] === task) inFlight[lane] = null;
    });
    inFlight[lane] = task;
    return task;
  };

  return Object.freeze({
    reload,
    dispose() {
      disposed = true;
    },
  });
}

export function useAppsPanelController(deps: AppsPanelControllerDeps): AppsPanelController {
  const buildLiveBridge = deps.buildLiveBridge ?? createDesktopAppsLiveBridge;
  const liveBridge = useMemo(() => buildLiveBridge(), [buildLiveBridge]);
  const [projection, setProjection] = useState<DesktopAppsPanelProjection | null>(null);
  const projectionRef = useRef<DesktopAppsPanelProjection | null>(null);
  const [detailEntryKey, setDetailEntryKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<Readonly<{
    entryKey: string;
    action: AppCardActionId;
  }> | null>(null);
  const [installConfirmation, setInstallConfirmation] = useState<AppsInstallIntentSnapshot | null>(null);
  const reloader = useMemo(() => createAppsPanelProjectionReloader({
    source: {
      ...liveBridge,
      listApprovedCatalogTargets: deps.listApprovedCatalogTargets,
      listCommittedReleases: deps.listCommittedReleases,
      listPackageJobs: deps.listPackageJobs,
      readAppAIConfig: deps.readAppAIConfig,
      readAppIcon: async (selector: string) => (
        (await liveBridge.readProjectIcon(selector)).iconDataUrl
      ),
    },
    getCurrent: () => projectionRef.current,
    commit(next) {
      projectionRef.current = next;
      setProjection(next);
    },
  }), [deps.listApprovedCatalogTargets, deps.listCommittedReleases, deps.listPackageJobs, deps.readAppAIConfig, liveBridge]);
  const reload = useCallback(
    (refreshAIConfig = true): Promise<void> => reloader.reload(refreshAIConfig),
    [reloader],
  );
  const installIntentController = useMemo(() => deps.startInstall
    ? createAppsInstallIntentController({ startInstall: deps.startInstall, refresh: () => reload(false) })
    : undefined, [deps.startInstall, reload]);

  useEffect(() => {
    void reload(true);
  }, [reload]);

  useEffect(() => () => reloader.dispose(), [reloader]);

  useEffect(() => {
    const interval = window.setInterval(() => void reload(false), 2_000);
    return () => window.clearInterval(interval);
  }, [reload]);

  useEffect(() => {
    const interval = window.setInterval(() => void reload(true), 30_000);
    return () => window.clearInterval(interval);
  }, [reload]);

  useEffect(() => {
    if (projection?.status !== 'loaded') return;
    // `null` detail id is the library view; the controller only clears a
    // selection whose entry actually disappeared and never auto-selects.
    setDetailEntryKey((currentKey) => resolveDetailEntryKey(projection.entries, currentKey));
  }, [projection]);

  useEffect(() => {
    if (!installConfirmation || projection?.status !== 'loaded') return;
    const current = projection.entries.find((entry) => (
      entry.identity.entryKey === desktopAppsEntryKey(installConfirmation.appId, 'verified')
    ))?.catalogTarget;
    if (current && approvedCatalogTargetMatchesIntent(current, installConfirmation)) return;
    installIntentController?.cancel();
    setInstallConfirmation(null);
  }, [installIntentController, installConfirmation, projection]);

  const runCardAction = useCallback((entryKey: string, action: AppCardActionId): void => {
    setActionError(null);
    if (action === 'details') {
      setDetailEntryKey(entryKey);
      return;
    }
    if (activeAction || projection?.status !== 'loaded') return;
    const entry = projection.entries.find((candidate) => candidate.identity.entryKey === entryKey);
    if (!entry) {
      setActionError(`App source is no longer available: ${entryKey}`);
      return;
    }
    setActiveAction({ entryKey, action });
    void (async () => {
      try {
        if (action === 'install') {
          if (!installIntentController) throw new Error('Approved App install is not product-enabled');
          const result = await requestAppsInstallFromDetail(entry, installIntentController);
          if (result.kind === 'confirmation-required') {
            setInstallConfirmation(result.intent);
          } else {
            setActionError(appsInstallIntentFailure(result));
          }
        } else if (action === 'uninstall') {
          if (!entry.committedRelease || !deps.uninstall) throw new Error('App uninstall is unavailable');
          await deps.uninstall(entry);
        } else if (action === 'launch') {
          if (entry.localDevelopment) await liveBridge.startRegistration(entry.localDevelopment.selector);
          else if (entry.committedRelease && liveBridge.launchInstalled) {
            const run = await liveBridge.launchInstalled(entry.committedRelease.launchSelector.slice());
            if (run.state === 'crashed') setActionError(run.message || run.reasonCode || 'Installed App launch failed');
          } else throw new Error('Installed App launch is unavailable');
        } else if (action === 'stop') {
          if (entry.localDevelopment) await liveBridge.stopRun(entry.localDevelopment.selector);
          else if (entry.committedRelease && liveBridge.stopInstalled) await liveBridge.stopInstalled(entry.committedRelease.launchSelector.slice());
          else throw new Error('Installed App has no supervised run');
        } else if (action === 'remove') {
          if (!entry.localDevelopment) throw new Error('Catalog App has no local-development registration');
          await liveBridge.removeRegistration(entry.localDevelopment.selector);
        } else if (action === 'cancel-job') {
          if (!entry.packageJob?.cancelable) throw new Error('App package job is not cancelable');
          await deps.cancelPackageJob(entry.packageJob);
        } else {
          assertAppsAction(action);
        }
        await reload(false);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
      } finally {
        setActiveAction(null);
      }
    })();
  }, [activeAction, deps.cancelPackageJob, deps.uninstall, installIntentController, liveBridge, projection, reload]);

  const retryProjection = useCallback((): void => {
    setProjection(null);
    setActionError(null);
    void reload(true);
  }, [reload]);

  const closeDetail = useCallback((): void => setDetailEntryKey(null), []);
  const acknowledgeAIConfigMutation = useCallback((
    entryKey: string,
    result: NimiAIConfigOverwriteResult,
  ): void => {
    const acknowledged = applyAppsPanelAIConfigAcknowledgement(projectionRef.current, entryKey, result);
    if (acknowledged !== projectionRef.current) {
      projectionRef.current = acknowledged;
      setProjection(acknowledged);
    }
    void reload(true);
  }, [reload]);

  const confirmInstall = useCallback((): void => {
    if (!installConfirmation || !installIntentController || activeAction) return;
    const entryKey = desktopAppsEntryKey(installConfirmation.appId, 'verified');
    setInstallConfirmation(null);
    setActionError(null);
    setActiveAction({ entryKey, action: 'install' });
    void installIntentController.confirm().then(async (result) => {
      setActionError(appsInstallIntentFailure(result));
      await reload(false);
    }).catch((error: unknown) => {
      setActionError(error instanceof Error ? error.message : String(error));
    }).finally(() => setActiveAction(null));
  }, [activeAction, installIntentController, installConfirmation, reload]);

  const cancelInstall = useCallback((): void => {
    installIntentController?.cancel();
    setInstallConfirmation(null);
  }, [installIntentController]);

  return {
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
  };
}

function appsInstallIntentFailure(result: AppsInstallIntentResult): string | null {
  if (result.kind === 'confirmation-required' || result.kind === 'no-pending-intent') return null;
  if (result.kind === 'policy-blocked') return `App install blocked by Registry policy ${result.revision}: ${result.reason}`;
  switch (result.result.kind) {
    case 'started':
    case 'already-installed':
    case 'job-active': return null;
    case 'stale-selection': return 'App Catalog selection changed; review the current release before installing.';
    case 'policy-blocked': return `App install blocked by Registry policy ${result.result.revision}: ${result.result.reason}`;
    case 'unavailable': return 'App install is unavailable.';
  }
}

export function assertAppsAction(action: never): never {
  throw new Error(`Unsupported Apps action: ${String(action)}`);
}
