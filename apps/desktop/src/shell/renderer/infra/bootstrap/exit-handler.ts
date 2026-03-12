import { dataSync } from '@runtime/data-sync';
import { completeMenuBarQuit, stopRuntimeBridge } from '@renderer/bridge';
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

  tauriEvent.listen('menu-bar://quit-requested', async () => {
    logRendererEvent({
      level: 'info',
      area: 'exit-handler',
      message: 'phase:exit-handler:quit-start',
    });

    try {
      dataSync.stopAllPolling();
      dataSync.clearProactiveRefreshTimer();
      stopAuthStateWatcher();

      if (options.managed) {
        await stopRuntimeBridge();
      }

      await completeMenuBarQuit();

      logRendererEvent({
        level: 'info',
        area: 'exit-handler',
        message: 'phase:exit-handler:quit-done',
      });
    } catch (error) {
      logRendererEvent({
        level: 'error',
        area: 'exit-handler',
        message: 'phase:exit-handler:quit-failed',
        details: { error: String(error) },
      });
    }
  });

  logRendererEvent({
    level: 'info',
    area: 'exit-handler',
    message: 'phase:exit-handler:registered',
    details: { managed: options.managed, mode: 'menu-bar-quit-only' },
  });
}
