// Renderer controller for the Desktop Apps projection and host-owned run actions.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppCardActionId } from './apps-card-actions.js';
import { createDesktopAppsLiveBridge } from './apps-live-bridge.js';
import { projectAppsPanel, type DesktopAppsPanelProjection } from './apps-panel-projection.js';

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
}

export type AppsPanelController = AppsPanelState & AppsPanelActions;

export interface AppsPanelControllerDeps {
  readonly buildLiveBridge?: typeof createDesktopAppsLiveBridge;
}

export function useAppsPanelController(deps: AppsPanelControllerDeps = {}): AppsPanelController {
  const buildLiveBridge = deps.buildLiveBridge ?? createDesktopAppsLiveBridge;
  const liveBridge = useMemo(() => buildLiveBridge(), [buildLiveBridge]);
  const [projection, setProjection] = useState<DesktopAppsPanelProjection | null>(null);
  const [detailAppId, setDetailAppId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<Readonly<{
    appId: string;
    action: AppCardActionId;
  }> | null>(null);
  const reloadTokenRef = useRef(0);

  const reload = useCallback(async (): Promise<void> => {
    const token = ++reloadTokenRef.current;
    const next = await projectAppsPanel(liveBridge);
    if (token === reloadTokenRef.current) setProjection(next);
  }, [liveBridge]);

  useEffect(() => {
    void reload();
    return () => {
      reloadTokenRef.current += 1;
    };
  }, [reload]);

  useEffect(() => {
    const interval = window.setInterval(() => void reload(), 2_000);
    return () => window.clearInterval(interval);
  }, [reload]);

  useEffect(() => {
    if (projection?.status !== 'loaded') return;
    setDetailAppId((currentAppId) => {
      if (
        currentAppId
        && projection.entries.some((entry) => entry.registration.appId === currentAppId)
      ) {
        return currentAppId;
      }
      return projection.entries[0]?.registration.appId ?? null;
    });
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
        await reload();
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
    void reload();
  }, [reload]);

  const closeDetail = useCallback((): void => setDetailAppId(null), []);

  return {
    projection,
    detailAppId,
    actionError,
    activeAction,
    runCardAction,
    retryProjection,
    closeDetail,
  };
}

export function assertAppsAction(action: never): never {
  throw new Error(`Unsupported Apps action: ${String(action)}`);
}
