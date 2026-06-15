// Apps panel controller (T4-W4).
//
// The renderer-side controller hook for the Apps surface. It owns:
//   - loading the Apps panel projection (registry + status + live jobs);
//   - routing every card action onto the `DesktopAppLifecycleBridge` (W2d);
//   - observing the `NimiRuntimeAppInstallJob` lifecycle via `watchJobEvents` so
//     `installing` / `uninstalling` progress and the `installed_ready` /
//     `install_failed` terminal states are live;
//   - the separate destructive "Delete app data" confirm flow.
//
// It holds NO parallel job/registry truth: a lifecycle action triggers a
// re-projection from the typed SDK surfaces, and the job watch re-projects on
// each terminal frame. Renderer state is purely view state (which detail view
// is open, which confirm dialog is pending, the last action error).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NimiRuntimeAppOpenScopeRef } from '@nimiplatform/sdk/runtime';
import {
  desktopAppLifecycleBridge,
  formatAppLifecycleErrorDetail,
  type DesktopAppLifecycleBridge,
  type NimiRuntimeAppInstallJob,
} from './apps-lifecycle-bridge.js';
import type { AppCardActionId } from './apps-card-actions.js';
import { createDesktopAppsLiveBridge } from './apps-live-bridge.js';
import {
  ensureAppOpenAIConfig,
  type DesktopAppsOpenAIConfigGateDeps,
} from './apps-open-ai-config-gate.js';
import { pickLocalAppRootDirectory as pickDefaultLocalAppRootDirectory } from './apps-local-app-picker.js';
import { projectAppsPanel, type DesktopAppsPanelProjection } from './apps-panel-projection.js';

/** A pending destructive-confirm flow (uninstall-with-data-delete / retry-cleanup). */
export interface AppsPendingConfirm {
  readonly appId: string;
  readonly displayName: string;
  readonly action: Extract<AppCardActionId, 'delete_app_data' | 'uninstall'>;
}

/** The state the Apps panel view renders. */
export interface AppsPanelState {
  /** `null` until the first projection resolves. */
  readonly projection: DesktopAppsPanelProjection | null;
  /** The appId whose detail view is open, or `null`. */
  readonly detailAppId: string | null;
  /** The pending destructive confirm dialog, or `null`. */
  readonly pendingConfirm: AppsPendingConfirm | null;
  /** The last card-action failure detail (typed, single-line), or `null`. */
  readonly actionError: string | null;
  /** The appId that produced `actionError`, or `null` for panel/global errors. */
  readonly actionErrorAppId: string | null;
  /** The appId of an in-flight card action (disables that card's buttons). */
  readonly busyAppId: string | null;
}

/** The action callbacks the Apps panel view binds to card buttons. */
export interface AppsPanelActions {
  /** Adopt a user-selected local app root through Runtime validation. */
  readonly connectLocalApp: () => void;
  /** Run a card action. Destructive actions open the confirm flow first. */
  readonly runCardAction: (appId: string, action: AppCardActionId) => void;
  /** Confirm the pending destructive flow. */
  readonly confirmPending: () => void;
  /** Dismiss the pending destructive confirm without acting. */
  readonly dismissPending: () => void;
  /** Close the detail view. */
  readonly closeDetail: () => void;
}

export type AppsPanelController = AppsPanelState & AppsPanelActions;

interface AppsPanelControllerDeps {
  readonly lifecycle?: DesktopAppLifecycleBridge;
  readonly buildLiveBridge?: typeof createDesktopAppsLiveBridge;
  readonly pickLocalAppRootDirectory?: () => Promise<string | null>;
  readonly requestSignIn?: () => void;
}

interface DesktopAppsActionDeps extends DesktopAppsOpenAIConfigGateDeps {
  readonly pickLocalAppRootDirectory?: () => Promise<string | null>;
  readonly requestSignIn?: () => void;
}

/**
 * The Apps panel controller hook. `deps` is injectable for tests; production
 * uses the Apps registry bridge (`NimiAppClient`) and the W2d lifecycle bridge.
 */
export function useAppsPanelController(deps: AppsPanelControllerDeps = {}): AppsPanelController {
  const lifecycle = deps.lifecycle ?? desktopAppLifecycleBridge;
  const buildLiveBridge = deps.buildLiveBridge ?? createDesktopAppsLiveBridge;
  const pickLocalAppRootDirectory =
    deps.pickLocalAppRootDirectory ?? pickDefaultLocalAppRootDirectory;
  const requestSignIn = deps.requestSignIn;
  const liveBridge = useMemo(() => buildLiveBridge(), [buildLiveBridge]);

  const [projection, setProjection] = useState<DesktopAppsPanelProjection | null>(null);
  const [detailAppId, setDetailAppId] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<AppsPendingConfirm | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionErrorAppId, setActionErrorAppId] = useState<string | null>(null);
  const [busyAppId, setBusyAppId] = useState<string | null>(null);

  // A monotonically increasing token guards against a stale re-projection
  // overwriting a fresher one (the projection is async).
  const reloadTokenRef = useRef(0);

  const reload = useCallback(async (options: { readonly includeJobs?: boolean } = {}): Promise<void> => {
    const token = ++reloadTokenRef.current;
    const next = await projectAppsPanel(
      liveBridge.appClient,
      options.includeJobs ? lifecycle : undefined,
    );
    if (token === reloadTokenRef.current) {
      setProjection(next);
    }
  }, [liveBridge, lifecycle]);

  // Initial projection. The Apps page paints from registry/status first so a
  // slow runtime job projection cannot make the tab feel frozen; the job-aware
  // projection follows immediately in the background and still fails closed if
  // lifecycle truth is unavailable.
  useEffect(() => {
    let stopped = false;
    void (async () => {
      await reload({ includeJobs: false });
      if (!stopped) {
        await reload({ includeJobs: true });
      }
    })();
    return () => {
      stopped = true;
    };
  }, [reload]);

  const activeJobIdsKey = useMemo(() => {
    if (projection?.status !== 'loaded') {
      return '';
    }
    return projection.entries
      .map((entry) => entry.job)
      .filter((job): job is NimiRuntimeAppInstallJob => Boolean(job && isActiveJob(job)))
      .map((job) => job.jobId)
      .sort()
      .join('|');
  }, [projection]);

  // Observe the runtime job lifecycle only while the panel knows about an
  // active job. This keeps the Apps tab from opening a long-lived runtime
  // stream on every click when there is no install/update/uninstall work to
  // observe. Each typed frame re-projects the panel so
  // `installing`/`uninstalling` progress and terminal states stay live, with
  // no renderer-local job store. Runtime lifecycle terminal handling owns
  // account-inventory writes; this renderer stream is a consumer only.
  useEffect(() => {
    if (!activeJobIdsKey) {
      return;
    }
    const controller = new AbortController();
    let stopped = false;
    void (async () => {
      try {
        await Promise.all(activeJobIdsKey.split('|').filter(Boolean).map(async (jobId) => {
          const stream = await lifecycle.watchJobEvents({ jobId, signal: controller.signal });
          for await (const event of stream) {
            void event;
            if (stopped) break;
            void reload({ includeJobs: true });
          }
        }));
      } catch (error) {
        // A watch failure must not crash the panel; the projection still
        // renders from `listJobs`. Surface it as a single-line action error.
        if (!stopped) {
          setActionError(formatAppLifecycleErrorDetail(error));
          setActionErrorAppId(null);
        }
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [activeJobIdsKey, lifecycle, reload]);

  const performAction = useCallback(
    async (appId: string, action: AppCardActionId): Promise<void> => {
      setActionError(null);
      setActionErrorAppId(null);
      setBusyAppId(appId);
      try {
        await routeCardAction(lifecycle, appId, action, {
          appClient: liveBridge.appClient,
          pickLocalAppRootDirectory,
          requestSignIn,
        });
        await reload({ includeJobs: true });
      } catch (error) {
        setActionError(formatAppLifecycleErrorDetail(error));
        setActionErrorAppId(appId);
      } finally {
        setBusyAppId((current) => (current === appId ? null : current));
      }
    },
    [lifecycle, liveBridge.appClient, pickLocalAppRootDirectory, reload, requestSignIn],
  );

  const runCardAction = useCallback(
    (appId: string, action: AppCardActionId): void => {
      if (action === 'details') {
        setDetailAppId(appId);
        return;
      }
      if (action === 'delete_app_data') {
        // The separate destructive "Delete app data" flow always confirms
        // first per D-HOME-005.
        setPendingConfirm(buildPendingConfirm(projection, appId, 'delete_app_data'));
        return;
      }
      void performAction(appId, action);
    },
    [performAction, projection],
  );

  const connectLocalApp = useCallback(
    (): void => {
      setActionError(null);
      setActionErrorAppId(null);
      void (async () => {
        try {
          const rootPath = await pickLocalAppRootDirectory();
          if (!rootPath) {
            return;
          }
          await lifecycle.adoptLocal({ rootPath });
          await reload({ includeJobs: true });
        } catch (error) {
          setActionError(formatAppLifecycleErrorDetail(error));
          setActionErrorAppId(null);
        }
      })();
    },
    [lifecycle, pickLocalAppRootDirectory, reload],
  );

  const confirmPending = useCallback((): void => {
    if (!pendingConfirm) return;
    const { appId, action } = pendingConfirm;
    setPendingConfirm(null);
    void performAction(appId, action);
  }, [pendingConfirm, performAction]);

  const dismissPending = useCallback((): void => {
    setPendingConfirm(null);
  }, []);

  const closeDetail = useCallback((): void => {
    setDetailAppId(null);
  }, []);

  return {
    projection,
    detailAppId,
    pendingConfirm,
    actionError,
    actionErrorAppId,
    busyAppId,
    connectLocalApp,
    runCardAction,
    confirmPending,
    dismissPending,
    closeDetail,
  };
}

function isActiveJob(job: NimiRuntimeAppInstallJob): boolean {
  return job.state === 'queued' || job.state === 'in_progress';
}

/** Build the canonical app-launch AIScopeRef for an Open action. */
export function appLaunchScopeRef(appId: string): NimiRuntimeAppOpenScopeRef {
  // The Apps surface opens the app at the app scope itself — `ownerId` is the
  // admitted app id, with no manifest-declared `surfaceId`. The runtime Open
  // flow (`K-APP-017`) validates this; it is never inferred runtime-side.
  return { kind: 'app', ownerId: appId };
}

function buildPendingConfirm(
  projection: DesktopAppsPanelProjection | null,
  appId: string,
  action: AppsPendingConfirm['action'],
): AppsPendingConfirm {
  const displayName =
    projection?.status === 'loaded'
      ? projection.entries.find((entry) => entry.app.appId === appId)?.app.displayName ?? appId
      : appId;
  return { appId, displayName, action };
}

/**
 * Route one card action onto the `DesktopAppLifecycleBridge`. Every mutation
 * goes through the W2d bridge — there is no renderer-local lifecycle.
 *
 * `details` is handled by the caller. `review_permissions` is intentionally
 * visible but fail-closed until the permission review surface is wired; it
 * never reaches Runtime as an invented lifecycle action.
 */
export async function routeCardAction(
  lifecycle: DesktopAppLifecycleBridge,
  appId: string,
  action: AppCardActionId,
  deps?: DesktopAppsActionDeps,
): Promise<void> {
  switch (action) {
    case 'connect_local': {
      if (!deps?.pickLocalAppRootDirectory) {
        throw new Error('routeCardAction: connect_local requires a local app root picker');
      }
      const rootPath = await deps.pickLocalAppRootDirectory();
      if (!rootPath) {
        return;
      }
      await lifecycle.adoptLocal({ rootPath, expectedAppId: appId });
      return;
    }
    case 'install':
      // The card-grid Install routes the install requirement preview through
      // the detail view; clicking Install from the card confirms it.
      await lifecycle.install({ appId, confirmed: true });
      return;
    case 'retry':
      // Retry a failed install — re-trigger the install lifecycle.
      await lifecycle.install({ appId, confirmed: true });
      return;
    case 'open':
      if (!deps) {
        throw new Error('routeCardAction: open requires Desktop Apps AIConfig gate dependencies');
      }
      await ensureAppOpenAIConfig(appId, deps);
      await lifecycle.open({ appId, scope: appLaunchScopeRef(appId) });
      return;
    case 'update':
      await lifecycle.update({ appId, confirmed: true });
      return;
    case 'repair':
      await lifecycle.healthRepair({ appId, action: 'repair' });
      return;
    case 'cancel':
      await lifecycle.healthRepair({ appId, action: 'cancel' });
      return;
    case 'uninstall':
      // Package removal only — durable app data is kept by default.
      await lifecycle.uninstall({ appId });
      return;
    case 'remove_local_adoption':
      await lifecycle.removeLocalAdoption({
        appId,
        deleteDurableDataConfirmed: false,
      });
      return;
    case 'sign_in':
      if (!deps?.requestSignIn) {
        throw new Error('routeCardAction: sign_in requires the desktop account gate');
      }
      deps.requestSignIn();
      return;
    case 'delete_app_data':
      // The confirmed destructive flow: remove the release AND the durable
      // app data, with the explicit destructive confirmation flag.
      await lifecycle.uninstall({
        appId,
        deleteDurableData: true,
        destructiveDataDeleteConfirmed: true,
      });
      return;
    case 'review_permissions':
      throw new Error('Permission review is not wired for this app yet; launch remains blocked.');
    case 'details':
      throw new Error(`routeCardAction: "${action}" is a renderer-only flow, not a bridge action`);
    default: {
      const exhaustive: never = action;
      throw new Error(`routeCardAction: unhandled action ${String(exhaustive)}`);
    }
  }
}
