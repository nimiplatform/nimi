import { useEffect } from 'react';
import { desktopBridge, type DesktopReleaseInfo } from '../../bridge';
import {
  loadStoredPerformancePreferences,
  subscribeStoredPerformancePreferences,
  type PerformancePreferences,
} from '../../features/settings/settings-storage';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import type { DesktopRendererLifecyclePort } from '../../renderer/lifecycle-port';

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const IDLE_CHECK_TIMEOUT_MS = 2_000;

type RequestIdleCallbackHandle = number;
type IdleDeadlineLike = { didTimeout: boolean; timeRemaining: () => number };
type IdleSchedulerWindow = Window & {
  requestIdleCallback?: (callback: (deadline: IdleDeadlineLike) => void, options?: { timeout: number }) => RequestIdleCallbackHandle;
  cancelIdleCallback?: (handle: RequestIdleCallbackHandle) => void;
};

type DesktopUpdatesPort = Pick<
  DesktopRendererLifecyclePort,
  | 'bootstrap'
  | 'desktopReleaseInfo'
  | 'setDesktopReleaseError'
  | 'setDesktopReleaseInfo'
  | 'setDesktopUpdateState'
  | 'setStatusBanner'
  | 'subscribeBootstrap'
  | 'translate'
>;

export function shouldRunAutomaticUpdateCheck(
  preferences: PerformancePreferences,
  visibilityState: string | undefined,
  updaterAvailable: boolean,
): boolean {
  return preferences.autoUpdate === true && visibilityState !== 'hidden' && updaterAvailable;
}

function currentPerformancePreferences(): PerformancePreferences {
  return loadStoredPerformancePreferences();
}

function currentVisibilityState(): string | undefined {
  return globalThis.document?.visibilityState;
}

function scheduleIdleCheck(callback: () => void): () => void {
  const idleWindow = globalThis.window as IdleSchedulerWindow | undefined;
  if (idleWindow?.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(() => {
      callback();
    }, { timeout: IDLE_CHECK_TIMEOUT_MS });
    return () => {
      idleWindow.cancelIdleCallback?.(handle);
    };
  }
  const handle = globalThis.setTimeout(callback, 0);
  return () => {
    globalThis.clearTimeout(handle);
  };
}

export function isDesktopUpdaterAvailable(releaseInfo: DesktopReleaseInfo | null | undefined): boolean {
  return releaseInfo?.updaterAvailable === true;
}

function resolveUpdaterUnavailableMessage(
  port: DesktopUpdatesPort,
  releaseInfo: DesktopReleaseInfo | null | undefined,
): string {
  const message = String(releaseInfo?.updaterUnavailableReason || '').trim();
  if (message) {
    return message;
  }
  return port.translate('Performance.updateUnavailable', {
    defaultValue: 'Desktop updates are unavailable in the current environment.',
  });
}

function publishUpdaterUnavailableBanner(
  port: DesktopUpdatesPort,
  releaseInfo: DesktopReleaseInfo | null | undefined,
  silent: boolean | undefined,
): void {
  if (silent) {
    return;
  }
  port.setStatusBanner({
    kind: 'warning',
    message: resolveUpdaterUnavailableMessage(port, releaseInfo),
  });
}

async function syncDesktopReleaseInfo(port: DesktopUpdatesPort): Promise<DesktopReleaseInfo | null> {
  if (!desktopBridge.hasTauriInvoke()) {
    return null;
  }
  try {
    const releaseInfo = await desktopBridge.getDesktopReleaseInfo();
    port.setDesktopReleaseInfo(releaseInfo);
    port.setDesktopReleaseError(null);
    return releaseInfo;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'desktop release metadata unavailable');
    port.setDesktopReleaseInfo(null);
    port.setDesktopReleaseError(message);
    throw error;
  }
}

async function syncDesktopUpdateState(port: DesktopUpdatesPort): Promise<void> {
  if (!desktopBridge.hasTauriInvoke()) {
    return;
  }
  try {
    const updateState = await desktopBridge.getDesktopUpdateState();
    port.setDesktopUpdateState(updateState);
  } catch {
    port.setDesktopUpdateState(null);
    throw new Error('desktop update state unavailable');
  }
}

function publishReadyBanner(port: DesktopUpdatesPort, targetVersion: string): void {
  port.setStatusBanner({
    kind: 'warning',
    message: port.translate('Performance.updateReadyBanner', {
      version: targetVersion,
      defaultValue: `Nimi v${targetVersion} is ready. Restart to finish updating.`,
    }),
    actionLabel: port.translate('Performance.restartNow', { defaultValue: 'Restart now' }),
    onAction: () => {
      void runDesktopUpdateRestart();
    },
  });
}

export async function runDesktopUpdateCheck(port: DesktopUpdatesPort, input: {
  autoDownload?: boolean;
  silent?: boolean;
} = {}): Promise<void> {
  if (!desktopBridge.hasTauriInvoke()) {
    return;
  }
  try {
    const releaseInfo = await syncDesktopReleaseInfo(port);
    if (!isDesktopUpdaterAvailable(releaseInfo)) {
      publishUpdaterUnavailableBanner(port, releaseInfo, input.silent);
      return;
    }
    const checkResult = await desktopBridge.desktopUpdateCheck();
    await syncDesktopUpdateState(port);
    if (!checkResult.available) {
      if (!input.silent) {
        port.setStatusBanner({
          kind: 'info',
          message: port.translate('Performance.updateCheckUpToDate', {
            defaultValue: 'Nimi is already up to date.',
          }),
        });
      }
      return;
    }
    if (input.autoDownload) {
      await runDesktopUpdateInstall(port, { silent: input.silent !== false });
      return;
    }
    if (!input.silent && checkResult.targetVersion) {
      port.setStatusBanner({
        kind: 'info',
        message: port.translate('Performance.updateCheckAvailable', {
          version: checkResult.targetVersion,
          defaultValue: `Update available: v${checkResult.targetVersion}`,
        }),
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'desktop update check failed');
    logRendererEvent({
      level: 'warn',
      area: 'desktop-update',
      message: 'phase:desktop-update:check-failed',
      details: { error: message },
    });
    try {
      await syncDesktopUpdateState(port);
    } catch {
      // release metadata failure already surfaced separately
    }
    if (!input.silent) {
      port.setStatusBanner({
        kind: 'warning',
        message,
      });
    }
  }
}

export async function runDesktopUpdateInstall(port: DesktopUpdatesPort, input: {
  silent?: boolean;
} = {}): Promise<void> {
  if (!desktopBridge.hasTauriInvoke()) {
    return;
  }
  try {
    const releaseInfo = await syncDesktopReleaseInfo(port);
    if (!isDesktopUpdaterAvailable(releaseInfo)) {
      publishUpdaterUnavailableBanner(port, releaseInfo, input.silent);
      return;
    }
    const existingState = await desktopBridge.getDesktopUpdateState().catch(() => null);
    if (!existingState?.readyToRestart && existingState?.status !== 'downloaded') {
      await desktopBridge.desktopUpdateDownload();
    }
    await desktopBridge.desktopUpdateInstall();
    const updateState = await desktopBridge.getDesktopUpdateState();
    port.setDesktopUpdateState(updateState);
    if (updateState.readyToRestart && updateState.targetVersion) {
      publishReadyBanner(port, updateState.targetVersion);
      return;
    }
    if (!input.silent) {
      port.setStatusBanner({
        kind: 'success',
        message: port.translate('Performance.updateDownloadedSuccess', {
          defaultValue: 'Update downloaded successfully.',
        }),
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'desktop update install failed');
    logRendererEvent({
      level: 'warn',
      area: 'desktop-update',
      message: 'phase:desktop-update:install-failed',
      details: { error: message },
    });
    try {
      await syncDesktopUpdateState(port);
    } catch {
      // release metadata failure already surfaced separately
    }
    if (!input.silent) {
      port.setStatusBanner({
        kind: 'warning',
        message,
      });
    }
  }
}

export async function runDesktopUpdateRestart(): Promise<void> {
  if (!desktopBridge.hasTauriInvoke()) {
    return;
  }
  await desktopBridge.desktopUpdateRestart();
}

export function connectDesktopUpdates(port: DesktopUpdatesPort): () => void {
  if (!desktopBridge.hasTauriInvoke()) return () => {};
  let active = true;
  let unsubscribeUpdateState: (() => void) | undefined;
  let readyBannerVersion = '';
  let lastError = '';
  let cancelIdle = () => {};
  let preferences = currentPerformancePreferences();

  const triggerAutomaticCheck = () => {
    const updaterAvailable = isDesktopUpdaterAvailable(port.desktopReleaseInfo());
    if (
      !active
      || !port.bootstrap().bootstrapReady
      || !shouldRunAutomaticUpdateCheck(preferences, currentVisibilityState(), updaterAvailable)
    ) return;
    cancelIdle();
    cancelIdle = scheduleIdleCheck(() => {
      const latestUpdaterAvailable = isDesktopUpdaterAvailable(port.desktopReleaseInfo());
      if (
        !active
        || !port.bootstrap().bootstrapReady
        || !shouldRunAutomaticUpdateCheck(preferences, currentVisibilityState(), latestUpdaterAvailable)
      ) return;
      void runDesktopUpdateCheck(port, { autoDownload: true, silent: true });
    });
  };

  void syncDesktopReleaseInfo(port).catch((error) => {
    if (!active) return;
    port.setStatusBanner({
      kind: 'warning',
      message: error instanceof Error
        ? error.message
        : String(error || 'desktop release metadata unavailable'),
    });
  });
  void syncDesktopUpdateState(port).catch(() => {
    // Release metadata failure is surfaced separately.
  });
  void desktopBridge.subscribeDesktopUpdateState((state) => {
    if (!active) return;
    port.setDesktopUpdateState(state);
    if (state.readyToRestart && state.targetVersion && readyBannerVersion !== state.targetVersion) {
      readyBannerVersion = state.targetVersion;
      publishReadyBanner(port, state.targetVersion);
    }
    if (state.status === 'error' && state.lastError && lastError !== state.lastError) {
      lastError = state.lastError;
      port.setStatusBanner({ kind: 'warning', message: state.lastError });
    }
  }).then((unsubscribe) => {
    if (!active) {
      unsubscribe();
      return;
    }
    unsubscribeUpdateState = unsubscribe;
  });

  const unsubscribeBootstrap = port.subscribeBootstrap(triggerAutomaticCheck);
  const unsubscribePreferences = subscribeStoredPerformancePreferences((nextPreferences) => {
    preferences = nextPreferences;
    if (!preferences.autoUpdate) {
      cancelIdle();
      return;
    }
    triggerAutomaticCheck();
  });
  const onVisibilityChange = () => {
    if (currentVisibilityState() === 'visible') triggerAutomaticCheck();
  };
  globalThis.document?.addEventListener?.('visibilitychange', onVisibilityChange);
  triggerAutomaticCheck();
  const timer = setInterval(triggerAutomaticCheck, UPDATE_CHECK_INTERVAL_MS);

  return () => {
    active = false;
    cancelIdle();
    unsubscribeUpdateState?.();
    unsubscribeBootstrap();
    unsubscribePreferences();
    globalThis.document?.removeEventListener?.('visibilitychange', onVisibilityChange);
    clearInterval(timer);
  };
}

export function useDesktopUpdatesBootstrap(port: DesktopUpdatesPort) {
  useEffect(() => connectDesktopUpdates(port), [port]);
}
