import {
  safeParseNimiDesktopOpenIntentEnvelope,
} from '@nimiplatform/kit/core/desktop-open';
import {
  hasNimiShellRuntime,
  listenShell,
} from '@nimiplatform/kit/shell/renderer/bridge';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { setDesktopOpenIntentReady } from '../../bridge/runtime-bridge';
import { applyDesktopOpenIntentToAppStore } from './desktop-open-intent-navigation';

const DESKTOP_OPEN_INTENT_EVENT = 'desktop-open://open-intent';
const DESKTOP_OPEN_READY_HEARTBEAT_INTERVAL_MS = 3_000;

export function connectDesktopOpenIntentListener(): () => void {
    if (!hasNimiShellRuntime()) return () => undefined;
    let active = true;
    let heartbeatTimer: ReturnType<typeof globalThis.setInterval> | undefined;
    const markReady = (): void => {
      void setDesktopOpenIntentReady(true).catch((error) => {
        logRendererEvent({
          level: 'warn',
          area: 'desktop-open',
          message: 'desktop-open:ready-set-failed',
          details: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
      });
    };
    const unsubscribePromise = Promise.resolve(listenShell(DESKTOP_OPEN_INTENT_EVENT, (event) => {
      if (!active) {
        return;
      }
      const parsed = safeParseNimiDesktopOpenIntentEnvelope(event.payload);
      if (!parsed.ok) {
        logRendererEvent({
          level: 'warn',
          area: 'desktop-open',
          message: 'desktop-open:intent-event-invalid',
          details: {
            reasonCode: parsed.error.reasonCode,
            field: parsed.error.field ?? null,
          },
        });
        return;
      }
      applyDesktopOpenIntentToAppStore(parsed.value.intent);
    }));

    void unsubscribePromise.then(() => {
      if (active) {
        markReady();
        heartbeatTimer = globalThis.setInterval(() => {
          if (active) {
            markReady();
          }
        }, DESKTOP_OPEN_READY_HEARTBEAT_INTERVAL_MS);
      }
    });

    return () => {
      active = false;
      if (heartbeatTimer !== undefined) {
        globalThis.clearInterval(heartbeatTimer);
      }
      void setDesktopOpenIntentReady(false).catch(() => {});
      void unsubscribePromise.then((unsubscribe) => {
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      });
    };
}
