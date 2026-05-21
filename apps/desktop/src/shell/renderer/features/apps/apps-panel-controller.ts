// Apps panel controller (T4-W4).
//
// The renderer-side controller hook for the Apps surface. It owns:
//   - loading the Apps panel projection (registry + status + live jobs);
//   - routing every card action onto the `DesktopAppLifecycleBridge` (W2d);
//   - observing the `RuntimeAppInstallJob` lifecycle via `watchJobEvents` so
//     `installing` / `uninstalling` progress and the `installed_ready` /
//     `install_failed` terminal states are live;
//   - the separate destructive "Delete app data" confirm flow.
//
// It holds NO parallel job/registry truth: a lifecycle action triggers a
// re-projection from the typed SDK surfaces, and the job watch re-projects on
// each terminal frame. Renderer state is purely view state (which detail view
// is open, which confirm dialog is pending, the last action error).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RuntimeAppOpenScopeRef } from '@nimiplatform/sdk/runtime';
import { createDesktopHomeLiveBridge } from '../nimi-home/nimi-home-live-bridge.js';
import {
  desktopAppLifecycleBridge,
  formatAppLifecycleErrorDetail,
  type DesktopAppLifecycleBridge,
  type RuntimeAppInstallJob,
  type RuntimeAppInstallJobEvent,
} from './apps-lifecycle-bridge.js';
import {
  desktopAppLibraryBridge,
  type AccountAppLibraryMutationKind,
  type DesktopAppLibraryBridge,
} from '@renderer/bridge/runtime-bridge/account-app-library.js';
import type { AppCardActionId } from './apps-card-actions.js';
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
  /** The appId of an in-flight card action (disables that card's buttons). */
  readonly busyAppId: string | null;
}

/** The action callbacks the Apps panel view binds to card buttons. */
export interface AppsPanelActions {
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
  readonly library?: DesktopAppLibraryBridge;
  readonly buildLiveBridge?: typeof createDesktopHomeLiveBridge;
}

/**
 * The Apps panel controller hook. `deps` is injectable for tests; production
 * uses the live home bridge (`NimiAppClient`), the W2d lifecycle bridge, and
 * the W4 account app-library bridge.
 */
export function useAppsPanelController(deps: AppsPanelControllerDeps = {}): AppsPanelController {
  const lifecycle = deps.lifecycle ?? desktopAppLifecycleBridge;
  const library = deps.library ?? desktopAppLibraryBridge;
  const buildLiveBridge = deps.buildLiveBridge ?? createDesktopHomeLiveBridge;
  const liveBridge = useMemo(() => buildLiveBridge(), [buildLiveBridge]);

  const [projection, setProjection] = useState<DesktopAppsPanelProjection | null>(null);
  const [detailAppId, setDetailAppId] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<AppsPendingConfirm | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAppId, setBusyAppId] = useState<string | null>(null);

  // A monotonically increasing token guards against a stale re-projection
  // overwriting a fresher one (the projection is async).
  const reloadTokenRef = useRef(0);

  const reload = useCallback(async (): Promise<void> => {
    const token = ++reloadTokenRef.current;
    const next = await projectAppsPanel(liveBridge.appClient, lifecycle);
    if (token === reloadTokenRef.current) {
      setProjection(next);
    }
  }, [liveBridge, lifecycle]);

  // Initial projection.
  useEffect(() => {
    void reload();
  }, [reload]);

  // Observe the runtime job lifecycle. Each typed frame re-projects the panel
  // so `installing`/`uninstalling` progress and the terminal `installed_ready`
  // / `install_failed` states are live, with no renderer-local job store. A
  // terminal `installed` / `uninstalled` frame also drives the `library.json`
  // writer (Fork D) — the desktop owns that account-scoped projection.
  //
  // A renderer-local `Set` of job ids whose library mutation already ran keeps
  // the writer idempotent across repeated terminal frames; it is bookkeeping
  // for the runtime-owned job stream, not a parallel job truth.
  const appliedLibraryJobsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    void (async () => {
      try {
        const stream = await lifecycle.watchJobEvents({ signal: controller.signal });
        for await (const event of stream) {
          if (stopped) break;
          void applyTerminalLibraryMutation(
            library,
            event,
            appliedLibraryJobsRef.current,
          ).catch((error: unknown) => {
            // A library-writer failure is reported but never blocks the panel.
            if (!stopped) {
              setActionError(formatAppLifecycleErrorDetail(error));
            }
          });
          void reload();
        }
      } catch (error) {
        // A watch failure must not crash the panel; the projection still
        // renders from `listJobs`. Surface it as a single-line action error.
        if (!stopped) {
          setActionError(formatAppLifecycleErrorDetail(error));
        }
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [lifecycle, library, reload]);

  const performAction = useCallback(
    async (appId: string, action: AppCardActionId): Promise<void> => {
      setActionError(null);
      setBusyAppId(appId);
      try {
        await routeCardAction(lifecycle, appId, action);
        // The destructive "Delete app data" flow removes the app from the
        // account library. Install/uninstall library mutations are driven by
        // the terminal job frame in the watch effect; the destructive removal
        // is applied here because only the controller knows the data-delete
        // intent (the job kind alone cannot distinguish it from a plain
        // uninstall).
        if (action === 'delete_app_data') {
          await library.apply({ appId, mutation: 'removed_from_library' });
        }
        await reload();
      } catch (error) {
        setActionError(formatAppLifecycleErrorDetail(error));
      } finally {
        setBusyAppId((current) => (current === appId ? null : current));
      }
    },
    [lifecycle, library, reload],
  );

  const runCardAction = useCallback(
    (appId: string, action: AppCardActionId): void => {
      if (action === 'details') {
        setDetailAppId(appId);
        return;
      }
      if (action === 'delete_app_data') {
        // The separate destructive "Delete app data" flow always confirms
        // first (manual `#### Uninstall And Data`).
        setPendingConfirm(buildPendingConfirm(projection, appId, 'delete_app_data'));
        return;
      }
      void performAction(appId, action);
    },
    [performAction, projection],
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
    busyAppId,
    runCardAction,
    confirmPending,
    dismissPending,
    closeDetail,
  };
}

/**
 * Map a terminal `RuntimeAppInstallJob` event to its `library.json` mutation
 * and apply it once. Install/update/repair jobs that reach `installed` mark
 * the app installed+enabled; an `uninstall` job that reaches `uninstalled`
 * marks the package not-installed while keeping the account library record
 * (manual `#### Uninstall And Data`). A non-terminal frame, or a job whose
 * mutation already ran, is a no-op.
 *
 * `applied` is the renderer-local set of already-mutated job ids — bookkeeping
 * over the runtime-owned job stream, keeping the writer idempotent.
 */
export async function applyTerminalLibraryMutation(
  library: DesktopAppLibraryBridge,
  event: RuntimeAppInstallJobEvent,
  applied: Set<string>,
): Promise<void> {
  const mutation = terminalLibraryMutation(event.job);
  if (!mutation) {
    return;
  }
  if (applied.has(event.job.jobId)) {
    return;
  }
  applied.add(event.job.jobId);
  await library.apply({ appId: event.job.appId, mutation });
}

/**
 * The `library.json` mutation a terminal job implies, or `undefined` for a
 * non-terminal / failed / cancelled job (those do not change library state).
 *
 * A confirmed destructive "Delete app data" uninstall still reaches
 * `uninstalled` here and maps to `uninstalled_keep_record`; the controller
 * separately applies `removed_from_library` for that flow because the job
 * kind cannot carry the data-delete intent.
 */
function terminalLibraryMutation(
  job: RuntimeAppInstallJob,
): AccountAppLibraryMutationKind | undefined {
  if (job.state === 'installed' && job.kind !== 'uninstall') {
    return 'installed_enabled';
  }
  if (job.state === 'uninstalled' && job.kind === 'uninstall') {
    return 'uninstalled_keep_record';
  }
  return undefined;
}

/** Build the canonical app-launch AIScopeRef for an Open action. */
export function appLaunchScopeRef(appId: string): RuntimeAppOpenScopeRef {
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
 * `details` / `review_permissions` are renderer-only flows and are handled by
 * the caller, never reaching this router.
 */
export async function routeCardAction(
  lifecycle: DesktopAppLifecycleBridge,
  appId: string,
  action: AppCardActionId,
): Promise<void> {
  switch (action) {
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
    case 'delete_app_data':
      // The confirmed destructive flow: remove the release AND the durable
      // app data, with the explicit destructive confirmation flag.
      await lifecycle.uninstall({
        appId,
        deleteDurableData: true,
        destructiveDataDeleteConfirmed: true,
      });
      return;
    case 'details':
    case 'review_permissions':
      throw new Error(`routeCardAction: "${action}" is a renderer-only flow, not a bridge action`);
    default: {
      const exhaustive: never = action;
      throw new Error(`routeCardAction: unhandled action ${String(exhaustive)}`);
    }
  }
}
