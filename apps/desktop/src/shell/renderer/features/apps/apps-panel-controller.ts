// Renderer controller for the Desktop Apps projection and host-owned run actions.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppCardActionId } from './apps-card-actions.js';
import { resolveDetailAppId } from './apps-card-fields.js';
import { createDesktopAppsLiveBridge } from './apps-live-bridge.js';
import {
  projectAppsPanel,
  type DesktopAppAIConfigReadOptions,
  type DesktopAppsPanelProjection,
  type DesktopAppsProjectionSource,
} from './apps-panel-projection.js';
import type { NimiAIConfigSnapshot } from '@nimiplatform/kit/core/sdk-contract';

export interface AppsPanelState {
  readonly projection: DesktopAppsPanelProjection | null;
  readonly detailAppId: string | null;
  readonly actionError: string | null;
  readonly activeAction: Readonly<{ appId: string; action: AppCardActionId }> | null;
}

export interface AppsPanelActions {
  readonly runCardAction: (appId: string, action: AppCardActionId) => void;
  readonly retryProjection: () => void;
  readonly closeDetail: () => void;
  readonly refreshAIConfig: () => void;
}

export type AppsPanelController = AppsPanelState & AppsPanelActions;

export interface AppsPanelControllerDeps {
  readonly buildLiveBridge?: typeof createDesktopAppsLiveBridge;
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
    const currentByAppId = new Map(current.entries.map((entry) => [entry.registration.appId, entry]));
    return {
      status: 'loaded',
      entries: next.entries.map((entry) => {
        const currentEntry = currentByAppId.get(entry.registration.appId);
        return {
          ...entry,
          aiConfigSummary: currentEntry ? currentEntry.aiConfigSummary : entry.aiConfigSummary,
        };
      }),
    };
  }
  const refreshedByAppId = new Map(next.entries.map((entry) => [entry.registration.appId, entry]));
  return {
    status: 'loaded',
    entries: current.entries.map((entry) => {
      const refreshedEntry = refreshedByAppId.get(entry.registration.appId);
      return {
        ...entry,
        aiConfigSummary: refreshedEntry ? refreshedEntry.aiConfigSummary : entry.aiConfigSummary,
      };
    }),
  };
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

  const reload = (refreshAIConfig = true): Promise<void> => {
    const lane: AppsPanelReloadLane = refreshAIConfig ? 'ai-config' : 'lifecycle';
    const existing = inFlight[lane];
    if (existing) return existing;
    const task = projectAppsPanel(input.source, {
      previous: input.getCurrent(),
      refreshAIConfig,
    }).then((next) => {
      if (disposed) return;
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

export function useAppsPanelController(deps: AppsPanelControllerDeps = {}): AppsPanelController {
  const buildLiveBridge = deps.buildLiveBridge ?? createDesktopAppsLiveBridge;
  const liveBridge = useMemo(() => buildLiveBridge(), [buildLiveBridge]);
  const [projection, setProjection] = useState<DesktopAppsPanelProjection | null>(null);
  const projectionRef = useRef<DesktopAppsPanelProjection | null>(null);
  const [detailAppId, setDetailAppId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<Readonly<{
    appId: string;
    action: AppCardActionId;
  }> | null>(null);
  const reloader = useMemo(() => createAppsPanelProjectionReloader({
    source: {
      ...liveBridge,
      readAppAIConfig: deps.readAppAIConfig,
    },
    getCurrent: () => projectionRef.current,
    commit(next) {
      projectionRef.current = next;
      setProjection(next);
    },
  }), [deps.readAppAIConfig, liveBridge]);
  const reload = useCallback(
    (refreshAIConfig = true): Promise<void> => reloader.reload(refreshAIConfig),
    [reloader],
  );

  useEffect(() => {
    void reload(true);
    return () => reloader.dispose();
  }, [reload, reloader]);

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
    setDetailAppId((currentAppId) => resolveDetailAppId(projection.entries, currentAppId));
  }, [projection]);

  const runCardAction = useCallback((appId: string, action: AppCardActionId): void => {
    setActionError(null);
    if (action === 'details') {
      setDetailAppId(appId);
      return;
    }
    if (activeAction || projection?.status !== 'loaded') return;
    const entry = projection.entries.find((candidate) => candidate.registration.appId === appId);
    if (!entry) {
      setActionError(`App is no longer available: ${appId}`);
      return;
    }
    setActiveAction({ appId, action });
    void (async () => {
      try {
        if (action === 'launch') {
          await liveBridge.startRegistration(entry.registration.selector);
        } else if (action === 'stop') {
          await liveBridge.stopRun(appId);
        } else if (action === 'remove') {
          await liveBridge.removeRegistration(entry.registration.selector);
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
  }, [activeAction, liveBridge, projection, reload]);

  const retryProjection = useCallback((): void => {
    setProjection(null);
    setActionError(null);
    void reload(true);
  }, [reload]);

  const closeDetail = useCallback((): void => setDetailAppId(null), []);
  const refreshAIConfig = useCallback((): void => {
    void reload(true);
  }, [reload]);

  return {
    projection,
    detailAppId,
    actionError,
    activeAction,
    runCardAction,
    retryProjection,
    closeDetail,
    refreshAIConfig,
  };
}

export function assertAppsAction(action: never): never {
  throw new Error(`Unsupported Apps action: ${String(action)}`);
}
