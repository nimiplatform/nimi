import { useEffect, useRef } from 'react';
import { desktopBridge } from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { i18n } from '@renderer/i18n';
import {
  loadStoredPerformancePreferences,
  subscribeStoredPerformancePreferences,
  type PerformancePreferences,
} from '@renderer/features/settings/settings-storage';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const IDLE_CHECK_TIMEOUT_MS = 2_000;

type RequestIdleCallbackHandle = number;
type IdleDeadlineLike = { didTimeout: boolean; timeRemaining: () => number };
type IdleSchedulerWindow = Window & {
  requestIdleCallback?: (callback: (deadline: IdleDeadlineLike) => void, options?: { timeout: number }) => RequestIdleCallbackHandle;
  cancelIdleCallback?: (handle: RequestIdleCallbackHandle) => void;
};

export function shouldRunAutomaticUpdateCheck(
  preferences: PerformancePreferences,
  visibilityState: string | undefined,
): boolean {
  return preferences.autoUpdate === true && visibilityState !== 'hidden';
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

async function syncDesktopReleaseInfo(): Promise<void> {
  if (!desktopBridge.hasTauriInvoke()) {
    return;
  }
  try {
    const releaseInfo = await desktopBridge.getDesktopReleaseInfo();
    useAppStore.getState().setDesktopReleaseInfo(releaseInfo);
    useAppStore.getState().setDesktopReleaseError(null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'desktop release metadata unavailable');
    useAppStore.getState().setDesktopReleaseInfo(null);
    useAppStore.getState().setDesktopReleaseError(message);
    throw error;
  }
}

async function syncDesktopUpdateState(): Promise<void> {
  if (!desktopBridge.hasTauriInvoke()) {
    return;
  }
  try {
    const updateState = await desktopBridge.getDesktopUpdateState();
    useAppStore.getState().setDesktopUpdateState(updateState);
  } catch {
    useAppStore.getState().setDesktopUpdateState(null);
    throw new Error('desktop update state unavailable');
  }
}

function publishReadyBanner(targetVersion: string): void {
  useAppStore.getState().setStatusBanner({
    kind: 'warning',
    message: i18n.t('Performance.updateReadyBanner', {
      version: targetVersion,
      defaultValue: `Nimi Desktop v${targetVersion} is ready. Restart to finish updating.`,
    }),
    actionLabel: i18n.t('Performance.restartNow', { defaultValue: 'Restart now' }),
    onAction: () => {
      void runDesktopUpdateRestart();
    },
  });
}

export async function runDesktopUpdateCheck(input: {
  autoDownload?: boolean;
  silent?: boolean;
} = {}): Promise<void> {
  if (!desktopBridge.hasTauriInvoke()) {
    return;
  }
  try {
    await syncDesktopReleaseInfo();
    const checkResult = await desktopBridge.desktopUpdateCheck();
    await syncDesktopUpdateState();
    if (!checkResult.available) {
      if (!input.silent) {
        useAppStore.getState().setStatusBanner({
          kind: 'info',
          message: i18n.t('Performance.updateCheckUpToDate', {
            defaultValue: 'Nimi Desktop is already up to date.',
          }),
        });
      }
      return;
    }
    if (input.autoDownload) {
      await runDesktopUpdateInstall({ silent: input.silent !== false });
      return;
    }
    if (!input.silent && checkResult.targetVersion) {
      useAppStore.getState().setStatusBanner({
        kind: 'info',
        message: i18n.t('Performance.updateCheckAvailable', {
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
      await syncDesktopUpdateState();
    } catch {
      // release metadata failure already surfaced separately
    }
    if (!input.silent) {
      useAppStore.getState().setStatusBanner({
        kind: 'warning',
        message,
      });
    }
  }
}

export async function runDesktopUpdateInstall(input: {
  silent?: boolean;
} = {}): Promise<void> {
  if (!desktopBridge.hasTauriInvoke()) {
    return;
  }
  try {
    const existingState = await desktopBridge.getDesktopUpdateState().catch(() => null);
    if (!existingState?.readyToRestart && existingState?.status !== 'downloaded') {
      await desktopBridge.desktopUpdateDownload();
    }
    await desktopBridge.desktopUpdateInstall();
    const updateState = await desktopBridge.getDesktopUpdateState();
    useAppStore.getState().setDesktopUpdateState(updateState);
    if (updateState.readyToRestart && updateState.targetVersion) {
      publishReadyBanner(updateState.targetVersion);
      return;
    }
    if (!input.silent) {
      useAppStore.getState().setStatusBanner({
        kind: 'success',
        message: i18n.t('Performance.updateDownloadedSuccess', {
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
      await syncDesktopUpdateState();
    } catch {
      // release metadata failure already surfaced separately
    }
    if (!input.silent) {
      useAppStore.getState().setStatusBanner({
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

export function useDesktopUpdatesBootstrap(bootstrapReady: boolean) {
  const setDesktopUpdateState = useAppStore((state) => state.setDesktopUpdateState);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const readyBannerVersionRef = useRef<string>('');
  const lastErrorRef = useRef<string>('');

  useEffect(() => {
    if (!desktopBridge.hasTauriInvoke()) {
      return undefined;
    }

    let active = true;
    let unsubscribe: (() => void) | undefined;

    void syncDesktopReleaseInfo().catch((error) => {
      if (!active) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error || 'desktop release metadata unavailable');
      setStatusBanner({
        kind: 'warning',
        message,
      });
    });
    void syncDesktopUpdateState().catch(() => {
      // release metadata failure already surfaced separately
    });
    void desktopBridge.subscribeDesktopUpdateState((state) => {
      if (!active) {
        return;
      }
      setDesktopUpdateState(state);
      if (state.readyToRestart && state.targetVersion && readyBannerVersionRef.current !== state.targetVersion) {
        readyBannerVersionRef.current = state.targetVersion;
        publishReadyBanner(state.targetVersion);
      }
      if (state.status === 'error' && state.lastError && lastErrorRef.current !== state.lastError) {
        lastErrorRef.current = state.lastError;
        setStatusBanner({
          kind: 'warning',
          message: state.lastError,
        });
      }
    }).then((nextUnsubscribe) => {
      unsubscribe = nextUnsubscribe;
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [setDesktopUpdateState, setStatusBanner]);

  useEffect(() => {
    if (!bootstrapReady || !desktopBridge.hasTauriInvoke()) {
      return undefined;
    }
    let cancelled = false;
    let cancelIdle = () => {};
    let preferences = currentPerformancePreferences();

    const triggerAutomaticCheck = () => {
      if (cancelled || !shouldRunAutomaticUpdateCheck(preferences, currentVisibilityState())) {
        return;
      }
      cancelIdle();
      cancelIdle = scheduleIdleCheck(() => {
        if (cancelled || !shouldRunAutomaticUpdateCheck(preferences, currentVisibilityState())) {
          return;
        }
        void runDesktopUpdateCheck({
          autoDownload: true,
          silent: true,
        });
      });
    };

    const unsubscribePreferences = subscribeStoredPerformancePreferences((nextPreferences) => {
      preferences = nextPreferences;
      if (!preferences.autoUpdate) {
        cancelIdle();
        return;
      }
      triggerAutomaticCheck();
    });

    const onVisibilityChange = () => {
      if (currentVisibilityState() === 'visible') {
        triggerAutomaticCheck();
      }
    };

    globalThis.document?.addEventListener?.('visibilitychange', onVisibilityChange);
    triggerAutomaticCheck();
    const timer = setInterval(() => {
      triggerAutomaticCheck();
    }, UPDATE_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      cancelIdle();
      unsubscribePreferences();
      globalThis.document?.removeEventListener?.('visibilitychange', onVisibilityChange);
      clearInterval(timer);
    };
  }, [bootstrapReady]);
}
