// Renderer controller for the Desktop Apps projection and host-owned run actions.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppCardActionId } from './apps-card-actions.js';
import { resolveDetailEntryKey } from './apps-card-fields.js';
import { createDesktopAppsLiveBridge } from './apps-live-bridge.js';
import {
  projectAppsPanel,
  summarizeAppAIConfig,
  type DesktopAppAIConfigReadOptions,
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
}

export interface AppsPanelActions {
  readonly setSearchQuery: (query: string) => void;
  readonly runCardAction: (entryKey: string, action: AppCardActionId) => void;
  readonly retryProjection: () => void;
  readonly closeDetail: () => void;
  readonly acknowledgeAIConfigMutation: (entryKey: string, result: NimiAIConfigOverwriteResult) => void;
}

export type AppsPanelController = AppsPanelState & AppsPanelActions;

export interface AppsPanelControllerDeps {
  readonly buildLiveBridge?: typeof createDesktopAppsLiveBridge;
  readonly listCommittedReleases: DesktopAppsProjectionSource['listCommittedReleases'];
  readonly listPackageJobs: DesktopAppsProjectionSource['listPackageJobs'];
  readonly cancelPackageJob: (job: AppPackageJob) => Promise<void>;
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
  const reloader = useMemo(() => createAppsPanelProjectionReloader({
    source: {
      ...liveBridge,
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
  }), [deps.listCommittedReleases, deps.listPackageJobs, deps.readAppAIConfig, liveBridge]);
  const reload = useCallback(
    (refreshAIConfig = true): Promise<void> => reloader.reload(refreshAIConfig),
    [reloader],
  );

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
        if (action === 'launch') {
          if (!entry.localDevelopment) throw new Error('Installed App launch is not implemented');
          await liveBridge.startRegistration(entry.localDevelopment.selector);
        } else if (action === 'stop') {
          if (!entry.localDevelopment) throw new Error('Catalog App has no supervised run');
          await liveBridge.stopRun(entry.localDevelopment.selector);
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
  }, [activeAction, deps.cancelPackageJob, liveBridge, projection, reload]);

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

  return {
    projection,
    detailEntryKey,
    searchQuery,
    actionError,
    activeAction,
    runCardAction,
    setSearchQuery,
    retryProjection,
    closeDetail,
    acknowledgeAIConfigMutation,
  };
}

export function assertAppsAction(action: never): never {
  throw new Error(`Unsupported Apps action: ${String(action)}`);
}
