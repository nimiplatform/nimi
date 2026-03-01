import { dataSync } from '@runtime/data-sync';
import { stopRuntimeBridge } from '@renderer/bridge';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { stopAuthStateWatcher } from './auth-state-watcher';

let registered = false;

export function registerExitHandler(options: { managed: boolean }) {
  if (registered) {
    return;
  }
  registered = true;

  const tauriEvent = window.__TAURI__?.event;
  if (!tauriEvent?.listen) {
    logRendererEvent({
      level: 'warn',
      area: 'exit-handler',
      message: 'phase:exit-handler:tauri-event-unavailable',
    });
    return;
  }

  tauriEvent.listen('tauri://close-requested', async () => {
    logRendererEvent({
      level: 'info',
      area: 'exit-handler',
      message: 'phase:exit-handler:cleanup-start',
    });

    try {
      stopAuthStateWatcher();
      dataSync.stopAllPolling();
      dataSync.clearProactiveRefreshTimer();

      if (options.managed) {
        await stopRuntimeBridge();
      }

      logRendererEvent({
        level: 'info',
        area: 'exit-handler',
        message: 'phase:exit-handler:cleanup-done',
      });
    } catch (error) {
      logRendererEvent({
        level: 'error',
        area: 'exit-handler',
        message: 'phase:exit-handler:cleanup-failed',
        details: { error: String(error) },
      });
    }
  });

  logRendererEvent({
    level: 'info',
    area: 'exit-handler',
    message: 'phase:exit-handler:registered',
    details: { managed: options.managed },
  });
}
