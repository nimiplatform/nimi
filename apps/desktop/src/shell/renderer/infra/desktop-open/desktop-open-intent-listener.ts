import { useEffect } from 'react';
import {
  safeParseNimiDesktopOpenIntentEnvelope,
} from '@nimiplatform/kit/core/desktop-open';
import { getShellFeatureFlags } from '@nimiplatform/kit/core/shell-mode';
import {
  hasTauriRuntime,
  listenTauri,
} from '@nimiplatform/kit/shell/renderer/bridge';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { setDesktopOpenIntentReady } from '@renderer/bridge/runtime-bridge';
import { applyDesktopOpenIntentToAppStore } from './desktop-open-intent-navigation';

const DESKTOP_OPEN_INTENT_EVENT = 'desktop-open://open-intent';
const DESKTOP_OPEN_READY_HEARTBEAT_INTERVAL_MS = 3_000;

export function useDesktopOpenIntentListener(): void {
  const flags = getShellFeatureFlags();

  useEffect(() => {
    if (flags.mode !== 'desktop' || !hasTauriRuntime()) {
      return;
    }
    let mounted = true;
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
    const unsubscribePromise = Promise.resolve(listenTauri(DESKTOP_OPEN_INTENT_EVENT, (event) => {
      if (!mounted) {
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
      if (mounted) {
        markReady();
        heartbeatTimer = globalThis.setInterval(() => {
          if (mounted) {
            markReady();
          }
        }, DESKTOP_OPEN_READY_HEARTBEAT_INTERVAL_MS);
      }
    });

    return () => {
      mounted = false;
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
  }, [flags.mode]);
}
