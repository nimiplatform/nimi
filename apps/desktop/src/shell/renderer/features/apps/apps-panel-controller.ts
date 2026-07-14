// Renderer controller for the read-only Desktop Apps projection.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppCardActionId } from './apps-card-actions.js';
import { createDesktopAppsLiveBridge } from './apps-live-bridge.js';
import { projectAppsPanel, type DesktopAppsPanelProjection } from './apps-panel-projection.js';

export interface AppsPanelState {
  readonly projection: DesktopAppsPanelProjection | null;
  readonly detailAppId: string | null;
  readonly actionError: string | null;
}

export interface AppsPanelActions {
  readonly runCardAction: (appId: string, action: AppCardActionId) => void;
  readonly retryProjection: () => void;
  readonly closeDetail: () => void;
}

export type AppsPanelController = AppsPanelState & AppsPanelActions;

export interface AppsPanelControllerDeps {
  readonly buildLiveBridge?: typeof createDesktopAppsLiveBridge;
  readonly requestSignIn?: () => void;
}

export function useAppsPanelController(deps: AppsPanelControllerDeps = {}): AppsPanelController {
  const buildLiveBridge = deps.buildLiveBridge ?? createDesktopAppsLiveBridge;
  const liveBridge = useMemo(() => buildLiveBridge(), [buildLiveBridge]);
  const [projection, setProjection] = useState<DesktopAppsPanelProjection | null>(null);
  const [detailAppId, setDetailAppId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const reloadTokenRef = useRef(0);

  const reload = useCallback(async (): Promise<void> => {
    const token = ++reloadTokenRef.current;
    const next = await projectAppsPanel(liveBridge.appClient);
    if (token === reloadTokenRef.current) setProjection(next);
  }, [liveBridge]);

  useEffect(() => {
    void reload();
    return () => {
      reloadTokenRef.current += 1;
    };
  }, [reload]);

  const runCardAction = useCallback((appId: string, action: AppCardActionId): void => {
    setActionError(null);
    if (action === 'details') {
      setDetailAppId(appId);
      return;
    }
    try {
      runReadOnlyAppsAction(action, { requestSignIn: deps.requestSignIn });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }, [deps.requestSignIn]);

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
    runCardAction,
    retryProjection,
    closeDetail,
  };
}

export function runReadOnlyAppsAction(
  action: AppCardActionId,
  deps: { readonly requestSignIn?: () => void } = {},
): void {
  switch (action) {
    case 'sign_in':
      if (!deps.requestSignIn) {
        throw new Error('Apps sign-in requires the Desktop account gate.');
      }
      deps.requestSignIn();
      return;
    case 'details':
      return;
    default: {
      const exhaustive: never = action;
      throw new Error(`Unsupported Apps action: ${String(exhaustive)}`);
    }
  }
}
