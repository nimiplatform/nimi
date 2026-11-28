// Renderer controller for the Desktop Apps projection and host-owned run actions.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import type { AppCardActionId, AppsPendingAction } from './apps-card-actions.js';
import { appsActionsLocked, appsStopLocked, canRequestCatalogInstall, canRequestCatalogUpdate, isLocalDevelopmentRunActive } from './apps-card-actions.js';
import type {
  AppsInstallIntentController,
  AppsInstallIntentResult,
  AppsInstallIntentSnapshot,
  AppsInstallStartResult,
} from './apps-install-intent.js';
import { approvedCatalogTargetMatchesIntent, createAppsInstallIntentController } from './apps-install-intent.js';
import { mergeInstalledFocusResult } from './apps-card-fields.js';
import { createDesktopAppsLiveBridge } from './apps-live-bridge.js';
import { useAppsPresentationCache } from './use-apps-presentation-cache.js';
import {
  desktopAppsEntryKey,
  normalizeCatalogTargetsResponse,
  packageInfoKey,
  projectAppsPanel,
  appPresentationKey,
  mergeAppPresentation,
  retainCurrentAppPresentation,
  summarizeAppAIConfig,
  type DesktopAppAIConfigReadOptions,
  type DesktopAppsCatalogProjection,
  type DesktopAppsCatalogReadOptions,
  type DesktopAppsEntry,
  type DesktopAppsPanelProjection,
  type DesktopAppsProjectionSource,
} from './apps-panel-projection.js';
import type {
  NimiAIConfigOverwriteResult,
  NimiAIConfigSnapshot,
} from '@nimiplatform/kit/core/sdk-contract';
import { AppPackageJobPhase, type AppPackageJob } from '@nimiplatform/sdk/runtime/wire-types';

export interface AppsPanelState {
  readonly projection: DesktopAppsPanelProjection | null;
  readonly searchQuery: string;
  readonly actionError: AppsActionError | null;
  readonly pendingActions: readonly AppsPendingAction[];
  readonly installConfirmation: AppsInstallIntentSnapshot | null;
}

export interface AppsPanelActions {
  readonly setSearchQuery: (query: string) => void;
  readonly runCardAction: (entryKey: string, action: AppCardActionId) => void;
  readonly retryProjection: () => void;
  readonly acknowledgeAIConfigMutation: (entryKey: string, result: NimiAIConfigOverwriteResult) => void;
  readonly confirmInstall: () => void;
  readonly cancelInstall: () => void;
}

export type AppsPanelController = AppsPanelState & AppsPanelActions;

export interface AppsPanelControllerDeps {
  readonly selectedEntryKey?: string | null;
  readonly readPackageInfo?: DesktopAppsProjectionSource['readPackageInfo'];
  readonly buildLiveBridge?: typeof createDesktopAppsLiveBridge;
  readonly listCommittedReleases: DesktopAppsProjectionSource['listCommittedReleases'];
  readonly listPackageJobs: DesktopAppsProjectionSource['listPackageJobs'];
  readonly listApprovedCatalogTargets?: DesktopAppsProjectionSource['listApprovedCatalogTargets'];
  readonly cancelPackageJob: (job: AppPackageJob) => Promise<void>;
  readonly startInstall?: (approvedTargetSelector: Uint8Array) => Promise<AppsInstallStartResult>;
  readonly startUpdate?: (approvedTargetSelector: Uint8Array, launchSelector: Uint8Array, installedVersion: string) => Promise<AppsInstallStartResult>;
  readonly uninstall?: (entry: DesktopAppsEntry) => Promise<void>;
  readonly readAppAIConfig?: (
    appId: string,
    options: DesktopAppAIConfigReadOptions,
  ) => Promise<NimiAIConfigSnapshot>;
}

type AppsPanelReloadLane = 'lifecycle' | 'ai-config';

const projectionKey = ['desktop', 'apps-panel'] as const;
const catalogKey = ['desktop', 'apps-panel-catalog'] as const;
const catalogRefreshMs = 60_000;

export interface AppsPanelProjectionReloader {
  reload(refreshAIConfig?: boolean, supersedeAIConfig?: boolean): Promise<void>;
  refreshCatalog(options?: DesktopAppsCatalogReadOptions): Promise<void>;
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
      ...(next.catalogUpdatedAtUnixMs ? { catalogUpdatedAtUnixMs: next.catalogUpdatedAtUnixMs } : {}),
      ...(next.catalogRefreshInProgress ? { catalogRefreshInProgress: next.catalogRefreshInProgress } : {}),
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
    catalogStatus: current.catalogStatus,
    ...(current.catalogUpdatedAtUnixMs ? { catalogUpdatedAtUnixMs: current.catalogUpdatedAtUnixMs } : {}),
    ...(current.catalogRefreshInProgress ? { catalogRefreshInProgress: current.catalogRefreshInProgress } : {}),
    runtimeError: current.runtimeError,
    entries: current.entries.map((entry) => {
      const refreshedEntry = refreshedByKey.get(entry.identity.entryKey);
      const sameSelection = refreshedEntry && (entry.localDevelopment
        ? refreshedEntry.localDevelopment?.selector === entry.localDevelopment.selector
          && appPresentationKey(refreshedEntry) === appPresentationKey(entry)
        : packageInfoKey(refreshedEntry) === packageInfoKey(entry));
      return {
        ...entry,
        aiConfigSummary: refreshedEntry ? refreshedEntry.aiConfigSummary : entry.aiConfigSummary,
        ...(sameSelection ? {
          iconUrl: refreshedEntry.iconUrl, summary: refreshedEntry.summary,
          appInfo: refreshedEntry.appInfo, appInfoKey: refreshedEntry.appInfoKey, appInfoError: refreshedEntry.appInfoError,
        } : {}),
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
    status: 'loaded', entries, catalogStatus: current.catalogStatus,
    ...(current.catalogUpdatedAtUnixMs ? { catalogUpdatedAtUnixMs: current.catalogUpdatedAtUnixMs } : {}),
    ...(current.catalogRefreshInProgress ? { catalogRefreshInProgress: current.catalogRefreshInProgress } : {}),
    runtimeError: current.runtimeError,
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

export function requestAppsUpdateFromDetail(entry: DesktopAppsEntry, controller: AppsInstallIntentController): Promise<AppsInstallIntentResult> {
  if (!canRequestCatalogUpdate(entry) || !entry.catalogTarget || !entry.committedRelease) throw new Error('App update is unavailable');
  return controller.requestUpdate(entry.catalogTarget, entry.committedRelease, entry.appInfo ? entry.appInfo.safetyDeclaration ?? null : undefined);
}

export function createAppsPanelProjectionReloader(input: {
  readonly source: DesktopAppsProjectionSource;
  readonly initialCatalog?: DesktopAppsCatalogProjection;
  readonly getCurrent: () => DesktopAppsPanelProjection | null;
  readonly commit: (projection: DesktopAppsPanelProjection) => void;
}): AppsPanelProjectionReloader {
  let disposed = false;
  let catalog: DesktopAppsCatalogProjection = input.initialCatalog ?? {
    status: input.source.listApprovedCatalogTargets ? 'loading' : 'not-implemented', targets: [],
  };
  let catalogInFlight: Promise<void> | null = null;
  let catalogFollowUp: Promise<void> | null = null;
  let catalogFollowUpRevision = 0;
  let catalogRevision = 0;
  const inFlight: Record<AppsPanelReloadLane, Promise<void> | null> = {
    lifecycle: null,
    'ai-config': null,
  };
  const latestRevision: Record<AppsPanelReloadLane, number> = {
    lifecycle: 0,
    'ai-config': 0,
  };
  const requests: Record<AppsPanelReloadLane, AbortController | null> = { lifecycle: null, 'ai-config': null };
  const reload = (refreshAIConfig = true, supersedeAIConfig = false): Promise<void> => {
    if (disposed) return Promise.resolve();
    const lane: AppsPanelReloadLane = refreshAIConfig ? 'ai-config' : 'lifecycle';
    const existing = inFlight[lane];
    if (existing && !(refreshAIConfig && supersedeAIConfig)) return existing;
    requests[lane]?.abort('desktop-apps-projection-superseded');
    const request = new AbortController();
    requests[lane] = request;
    const revision = latestRevision[lane] + 1;
    latestRevision[lane] = revision;
    const task = projectAppsPanel(input.source, {
      previous: input.getCurrent(),
      refreshAIConfig,
      catalog,
      background: true,
      signal: request.signal,
      onEntry(entry, patch) {
        if (disposed || request.signal.aborted || latestRevision[lane] !== revision) return;
        const next = mergeAppPresentation(input.getCurrent(), entry, patch);
        if (next) input.commit(next);
      },
      onInventory(next) {
        if (!disposed && latestRevision[lane] === revision && input.getCurrent()?.status !== 'loaded') input.commit(next);
      },
    }).then((next) => {
      if (
        disposed
        || latestRevision[lane] !== revision
      ) return;
      input.commit(mergeAppsPanelProjection(input.getCurrent(), retainCurrentAppPresentation(input.getCurrent(), next), lane));
    }).finally(() => {
      if (inFlight[lane] === task) inFlight[lane] = null;
      if (requests[lane] === request) requests[lane] = null;
    });
    inFlight[lane] = task;
    return task;
  };

  const startCatalogAwaitFollowUp = (expectedRevision: number): void => {
    if (!input.source.listApprovedCatalogTargets || disposed) return;
    if (catalogFollowUp && catalogFollowUpRevision === expectedRevision) return;
    catalogFollowUpRevision = expectedRevision;
    const followUp = input.source.listApprovedCatalogTargets({ awaitRefresh: true }).then((response) => {
      if (disposed || catalogRevision !== expectedRevision) return;
      catalog = normalizeCatalogTargetsResponse(response);
    }).catch((error: unknown) => {
      if (disposed || catalogRevision !== expectedRevision) return;
      if (catalog.status === 'stale') {
        catalog = { ...catalog, refreshInProgress: false, error };
      } else {
        catalog = { status: 'unavailable', targets: [], updatedAtUnixMs: null, refreshInProgress: false, error };
      }
    }).then(async () => {
      if (disposed || catalogRevision !== expectedRevision) return;
      await inFlight.lifecycle;
      if (!disposed && catalogRevision === expectedRevision) await reload(false);
    }).finally(() => {
      if (catalogFollowUp === followUp) catalogFollowUp = null;
    });
    catalogFollowUp = followUp;
  };

  return Object.freeze({
    reload,
    refreshCatalog(options?: DesktopAppsCatalogReadOptions): Promise<void> {
      if (!input.source.listApprovedCatalogTargets || disposed) return Promise.resolve();
      const force = Boolean(options?.forceRefresh);
      const awaitOnly = Boolean(options?.awaitRefresh);
      if (!force && !awaitOnly && catalogInFlight) return catalogInFlight;
      if (awaitOnly && catalogFollowUp && catalogFollowUpRevision === catalogRevision) return catalogFollowUp;
      const revision = catalogRevision + 1;
      catalogRevision = revision;
      const task = input.source.listApprovedCatalogTargets(options).then((response) => {
        if (disposed || catalogRevision !== revision) return;
        const next = normalizeCatalogTargetsResponse(response);
        catalog = next;
        if (!awaitOnly && next.refreshInProgress) {
          startCatalogAwaitFollowUp(revision);
        }
      }).catch((error: unknown) => {
        if (disposed || catalogRevision !== revision) return;
        if (awaitOnly && catalog.status === 'stale') {
          catalog = { ...catalog, refreshInProgress: false, error };
        } else {
          catalog = { status: 'unavailable', targets: [], updatedAtUnixMs: null, refreshInProgress: false, error };
        }
      }).then(async () => {
        if (disposed || catalogRevision !== revision) return;
        await inFlight.lifecycle;
        if (!disposed && catalogRevision === revision) await reload(false);
      }).finally(() => { if (catalogInFlight === task) catalogInFlight = null; });
      catalogInFlight = task;
      return task;
    },
    dispose() {
      disposed = true;
      catalogRevision += 1;
      requests.lifecycle?.abort('desktop-apps-projection-disposed');
      requests['ai-config']?.abort('desktop-apps-projection-disposed');
    },
  });
}

/** A failed App action: user copy, with the raw reason kept for technical details. */
export type AppsActionError = { readonly message: string; readonly detail: string | null };
export type AppsActionFailure = { readonly entryKey: string | null; readonly error: AppsActionError };

/** A failure shows in the list, or in the detail of the App it happened on. */
export function visibleAppsActionError(failure: AppsActionFailure | null, detailEntryKey: string | null, entries: readonly DesktopAppsEntry[] = []): AppsActionError | null {
  if (!failure) return null;
  if (failure.entryKey === null || detailEntryKey === null || failure.entryKey === detailEntryKey) return failure.error;
  const failed = entries.find((entry) => entry.identity.entryKey === failure.entryKey);
  const current = entries.find((entry) => entry.identity.entryKey === detailEntryKey);
  return failed && current && failed.identity.appId === current.identity.appId ? failure.error : null;
}

export function useAppsPanelController(deps: AppsPanelControllerDeps): AppsPanelController {
  const presentationCache = useAppsPresentationCache();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const buildLiveBridge = deps.buildLiveBridge ?? createDesktopAppsLiveBridge;
  const liveBridge = useMemo(() => buildLiveBridge(), [buildLiveBridge]);
  // Keep the completed projection across route unmounts. The existing session
  // lifecycle clears this QueryClient on logout, account change and recovery.
  const { data: projection = null } = useQuery<DesktopAppsPanelProjection | null>({
    queryKey: projectionKey, queryFn: skipToken, gcTime: Infinity,
  });
  const projectionRef = useRef<DesktopAppsPanelProjection | null>(projection);
  const setProjection = useCallback((next: DesktopAppsPanelProjection | null) => {
    projectionRef.current = next;
    queryClient.setQueryData(projectionKey, next);
  }, [queryClient]);
  const [searchQuery, setSearchQuery] = useState('');
  // A failure belongs to the entry it happened on. Opening or polling details
  // never clears it; only the next action or a retry does.
  const [actionFailure, setActionFailure] = useState<AppsActionFailure | null>(null);
  const failAction = useCallback((entryKey: string | null, message: string | null, detail: string | null = null) => {
    setActionFailure(message ? { entryKey, error: { message, detail } } : null);
  }, []);
  const failActionWith = useCallback((entryKey: string | null, cause: unknown) => {
    failAction(entryKey, t('Apps.actionFailed'), cause instanceof Error ? cause.message : String(cause));
  }, [failAction, t]);
  // The ref is the synchronous single-flight guard; state drives rendering.
  const pendingActionsRef = useRef<readonly AppsPendingAction[]>([]);
  const [pendingActions, setPendingActions] = useState<readonly AppsPendingAction[]>([]);
  const beginPendingAction = useCallback((pending: AppsPendingAction): (() => void) => {
    pendingActionsRef.current = [...pendingActionsRef.current, pending];
    setPendingActions(pendingActionsRef.current);
    return () => {
      pendingActionsRef.current = pendingActionsRef.current.filter((item) => item !== pending);
      setPendingActions(pendingActionsRef.current);
    };
  }, []);
  const [installConfirmation, setInstallConfirmation] = useState<AppsInstallIntentSnapshot | null>(null);
  const reloader = useMemo(() => createAppsPanelProjectionReloader({
    // A failed query retains its last successful data. Do not restore those
    // previous install targets when navigating back while a retry is pending.
    initialCatalog: queryClient.getQueryState(catalogKey)?.status === 'error'
      ? { status: 'unavailable', targets: [] }
      : queryClient.getQueryData<DesktopAppsCatalogProjection>(catalogKey),
    source: {
      ...liveBridge,
      presentationCache,
      listApprovedCatalogTargets: deps.listApprovedCatalogTargets ? async (options) => {
        if (options?.awaitRefresh) {
          try {
            const projected = normalizeCatalogTargetsResponse(await deps.listApprovedCatalogTargets!(options));
            queryClient.setQueryData(catalogKey, projected);
            return {
              targets: projected.targets,
              stale: projected.status === 'stale',
              updatedAtUnixMs: projected.updatedAtUnixMs ?? null,
              refreshInProgress: projected.refreshInProgress,
            };
          } catch (error) {
            const current = queryClient.getQueryData<DesktopAppsCatalogProjection>(catalogKey);
            if (current?.status === 'stale') {
              const settled: DesktopAppsCatalogProjection = { ...current, refreshInProgress: false };
              queryClient.setQueryData(catalogKey, settled);
              return {
                targets: settled.targets,
                stale: true,
                updatedAtUnixMs: settled.updatedAtUnixMs ?? null,
                refreshInProgress: false,
              };
            }
            throw error;
          }
        }
        const projected = await queryClient.fetchQuery({
          queryKey: catalogKey,
          queryFn: async (): Promise<DesktopAppsCatalogProjection> => (
            normalizeCatalogTargetsResponse(await deps.listApprovedCatalogTargets!(options))
          ),
          staleTime: 0, gcTime: Infinity, retry: false, networkMode: 'always',
        });
        return {
          targets: projected.targets,
          stale: projected.status === 'stale',
          updatedAtUnixMs: projected.updatedAtUnixMs ?? null,
          refreshInProgress: projected.refreshInProgress,
        };
      } : undefined,
      listCommittedReleases: deps.listCommittedReleases,
      listPackageJobs: deps.listPackageJobs,
      readAppAIConfig: deps.readAppAIConfig,
      readPackageInfo: deps.readPackageInfo,
      readAppIcon: async (selector: string) => (
        (await liveBridge.readProjectIcon(selector)).iconDataUrl
      ),
    },
    getCurrent: () => projectionRef.current,
    commit(next) {
      projectionRef.current = next;
      setProjection(next);
    },
  }), [deps.listApprovedCatalogTargets, deps.listCommittedReleases, deps.listPackageJobs, deps.readAppAIConfig, deps.readPackageInfo, liveBridge, queryClient, setProjection, presentationCache]);
  const reload = useCallback(
    (refreshAIConfig = true, supersedeAIConfig = false): Promise<void> => reloader.reload(refreshAIConfig, supersedeAIConfig),
    [reloader],
  );
  const installIntentController = useMemo(() => deps.startInstall
    ? createAppsInstallIntentController({ startInstall: deps.startInstall, startUpdate: deps.startUpdate, refresh: () => reloader.refreshCatalog({ forceRefresh: true }) })
    : undefined, [deps.startInstall, deps.startUpdate, reloader]);

  useEffect(() => {
    // Reconcile local membership and run state first; AI summaries must not
    // delay artwork or keep an old cached lifecycle projection on screen.
    void reload(false).then(() => reload(true));
    const cachedCatalog = queryClient.getQueryState<DesktopAppsCatalogProjection>(catalogKey);
    if (!cachedCatalog || cachedCatalog.data === undefined) {
      void reloader.refreshCatalog();
    } else if (cachedCatalog.status !== 'success' || cachedCatalog.isInvalidated
      || Date.now() - cachedCatalog.dataUpdatedAt >= catalogRefreshMs) {
      void reloader.refreshCatalog({ forceRefresh: true });
    } else if (cachedCatalog.data.status === 'stale' && cachedCatalog.data.refreshInProgress) {
      void reloader.refreshCatalog({ awaitRefresh: true });
    } else if (cachedCatalog.data.status === 'stale') {
      void reloader.refreshCatalog({ forceRefresh: true });
    }
  }, [reload, reloader, queryClient]);

  useEffect(() => {
    const interval = window.setInterval(() => void reloader.refreshCatalog({ forceRefresh: true }), catalogRefreshMs);
    return () => window.clearInterval(interval);
  }, [reloader]);

  useEffect(() => () => reloader.dispose(), [reloader]);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    const tick = (): void => {
      if (disposed) return;
      // Hidden windows skip the work but keep the schedule; the next visible
      // tick lands within one interval. Idle projections poll on a relaxed
      // cadence; in-flight runs and package jobs keep the 2s liveness.
      const work = document.hidden ? Promise.resolve() : reload(false);
      void work.finally(() => {
        if (disposed) return;
        timer = window.setTimeout(tick, appsPanelHasInFlightWork(projectionRef.current) ? 2_000 : 10_000);
      });
    };
    timer = window.setTimeout(tick, 2_000);
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [reload]);

  useEffect(() => {
    const interval = window.setInterval(() => void reload(true), 30_000);
    return () => window.clearInterval(interval);
  }, [reload]);

  useEffect(() => {
    if (!installConfirmation || projection?.status !== 'loaded') return;
    const currentEntry = projection.entries.find((entry) => (
      entry.identity.entryKey === desktopAppsEntryKey(installConfirmation.appId, 'verified')
    ));
    const current = currentEntry?.catalogTarget;
    const update = installConfirmation.update;
    const installed = currentEntry?.committedRelease;
    const sameInstalled = !update || (installed?.version === update.installedVersion
      && installed.launchSelector.length === update.launchSelector.length
      && installed.launchSelector.every((value, index) => value === update.launchSelector[index]));
    if (current && sameInstalled && approvedCatalogTargetMatchesIntent(current, installConfirmation)) return;
    installIntentController?.cancel();
    setInstallConfirmation(null);
  }, [installIntentController, installConfirmation, projection]);

  const runCardAction = useCallback((entryKey: string, action: AppCardActionId): void => {
    if (action === 'details' || action === 'open-ai-config') {
      throw new Error('App detail navigation belongs to the Home destination.');
    }
    setActionFailure(null);
    if (projection?.status !== 'loaded') return;
    const entry = projection.entries.find((candidate) => candidate.identity.entryKey === entryKey);
    if (!entry) {
      failAction(entryKey, t('Apps.actionFailed'), `App source is no longer available: ${entryKey}`);
      return;
    }
    if (action === 'stop'
      ? appsStopLocked(pendingActionsRef.current, entry.identity.appId)
      : appsActionsLocked(pendingActionsRef.current, entry.identity.appId)) return;
    const endPendingAction = beginPendingAction({ entryKey, appId: entry.identity.appId, action });
    void (async () => {
      try {
        if (action === 'install' || action === 'update') {
          if (!installIntentController) throw new Error('Approved App install is not product-enabled');
          const result = await (action === 'update'
            ? requestAppsUpdateFromDetail(entry, installIntentController)
            : requestAppsInstallFromDetail(entry, installIntentController));
          if (result.kind === 'confirmation-required') {
            setInstallConfirmation(result.intent);
          } else {
            failAction(entryKey, appsInstallIntentFailure(result, t));
          }
        } else if (action === 'uninstall') {
          if (!entry.committedRelease || !deps.uninstall) throw new Error('App uninstall is unavailable');
          await deps.uninstall(entry);
        } else if (action === 'launch') {
          if (entry.localDevelopment) {
            const wasRunning = entry.run?.state === 'running';
            try {
              const run = await liveBridge.startRegistration(entry.localDevelopment.selector);
              if (run && (run.state === 'failed' || run.state === 'crashed')) {
                failAction(entryKey, t(wasRunning ? 'Apps.focusFailed' : 'Apps.actionFailed'), run.message || run.reasonCode || null);
              }
            } catch (error) {
              if (wasRunning) {
                failAction(entryKey, t('Apps.focusFailed'), error instanceof Error ? error.message : String(error));
              } else {
                throw error;
              }
            }
          } else if (entry.committedRelease && liveBridge.launchInstalled) {
            const run = await liveBridge.launchInstalled(entry.committedRelease.launchSelector.slice());
            if (run.state === 'crashed') failAction(entryKey, installedLaunchFailureMessage(run, t));
            else if (run.state === 'running') {
              const current = projectionRef.current;
              if (current?.status === 'loaded') {
                setProjection({
                  ...current,
                  entries: current.entries.map(item => item.identity.entryKey === entryKey ? mergeInstalledFocusResult(item, run) : item),
                });
              }
            }
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
        failActionWith(entryKey, error);
      } finally {
        endPendingAction();
      }
    })();
  }, [beginPendingAction, deps.cancelPackageJob, deps.uninstall, failAction, failActionWith, installIntentController, liveBridge, projection, reload, setProjection, t]);

  const retryProjection = useCallback((): void => {
    setActionFailure(null);
    presentationCache.retryFailures();
    void reload(true, true);
    void reloader.refreshCatalog({ forceRefresh: true });
  }, [reload, reloader, presentationCache]);

  const acknowledgeAIConfigMutation = useCallback((
    entryKey: string,
    result: NimiAIConfigOverwriteResult,
  ): void => {
    const acknowledged = applyAppsPanelAIConfigAcknowledgement(projectionRef.current, entryKey, result);
    if (acknowledged !== projectionRef.current) {
      projectionRef.current = acknowledged;
      setProjection(acknowledged);
    }
    void reload(true, true);
  }, [reload, setProjection]);

  const confirmInstall = useCallback((): void => {
    if (!installConfirmation || !installIntentController) return;
    if (appsActionsLocked(pendingActionsRef.current, installConfirmation.appId)) return;
    const entryKey = desktopAppsEntryKey(installConfirmation.appId, 'verified');
    setInstallConfirmation(null);
    setActionFailure(null);
    const endPendingAction = beginPendingAction({
      entryKey,
      appId: installConfirmation.appId,
      action: installConfirmation.update ? 'update' : 'install',
    });
    void installIntentController.confirm().then(async (result) => {
      failAction(entryKey, appsInstallIntentFailure(result, t));
      await reload(false);
    }).catch((error: unknown) => {
      failActionWith(entryKey, error);
    }).finally(endPendingAction);
  }, [beginPendingAction, failAction, failActionWith, installIntentController, installConfirmation, reload, t]);

  const cancelInstall = useCallback((): void => {
    installIntentController?.cancel();
    setInstallConfirmation(null);
  }, [installIntentController]);

  const actionError = visibleAppsActionError(actionFailure, deps.selectedEntryKey ?? null, projection?.status === 'loaded' ? projection.entries : []);
  return {
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
  };
}

/**
 * A confirmed absent Catalog row and a Registry read failure are different
 * facts from the Runtime carrier; neither is a retirement of the installed
 * copy. Other failures keep the owner-projected message.
 */
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-043c
export function installedLaunchFailureMessage(run: { readonly message: string; readonly reasonCode?: string }, t: TFunction): string {
  const carrier = `${run.reasonCode ?? ''} ${run.message}`;
  if (carrier.includes('APP_CATALOG_ROW_ABSENT')) return t('Apps.catalog.rowAbsent');
  if (carrier.includes('APP_CATALOG_UNAVAILABLE')) return t('Apps.catalog.launchVerificationUnavailable');
  return run.message || run.reasonCode || 'Installed App launch failed';
}

function appsInstallIntentFailure(result: AppsInstallIntentResult, t: TFunction): string | null {
  if (result.kind === 'confirmation-required' || result.kind === 'no-pending-intent') return null;
  if (result.kind === 'policy-blocked') return t('Apps.packageAction.policyBlocked', { reason: result.reason });
  switch (result.result.kind) {
    case 'started':
    case 'already-installed':
    case 'job-active': return null;
    case 'stale-selection': return t('Apps.packageAction.selectionChanged');
    case 'policy-blocked': return t('Apps.packageAction.policyBlocked', { reason: result.result.reason });
    case 'unavailable': return t('Apps.packageAction.unavailable');
    case 'host-running': return t('Apps.update.stopRequired');
  }
}

export function assertAppsAction(action: never): never {
  throw new Error(`Unsupported Apps action: ${String(action)}`);
}

/**
 * Adaptive-poll signal: an active package job or a run in a transition state
 * (launching/stopping, not a steady `running`) keeps the 2s cadence; steady
 * states relax to the idle interval.
 */
export function appsPanelHasInFlightWork(projection: DesktopAppsPanelProjection | null): boolean {
  if (projection?.status !== 'loaded') return false;
  return projection.entries.some((entry) => {
    const job = entry.packageJob;
    if (job && ![
      AppPackageJobPhase.COMPLETED,
      AppPackageJobPhase.FAILED,
      AppPackageJobPhase.CANCELED,
    ].includes(job.phase)) return true;
    const runState = entry.run?.state ?? null;
    return runState !== null && runState !== 'running' && isLocalDevelopmentRunActive(runState);
  });
}
