import { getShellFeatureFlags } from '@nimiplatform/kit/core/shell-mode';
import { createRendererFlowId, logRendererEvent } from '@nimiplatform/kit/telemetry';

import {
  bootstrapRuntime,
  disposeRuntimeBootstrap,
} from '@renderer/infra/bootstrap/runtime-bootstrap';
import type { DesktopRendererLifecyclePort } from './lifecycle-port.js';

const WEB_BOOTSTRAP_TIMEOUT_MS = 15_000;
const DESKTOP_BOOTSTRAP_TIMEOUT_MS = 25_000;
async function resolveBootstrapTimeoutMs(shellMode: string): Promise<number> {
  return shellMode === 'web'
    ? WEB_BOOTSTRAP_TIMEOUT_MS
    : DESKTOP_BOOTSTRAP_TIMEOUT_MS;
}

export function connectProductionBootstrap(
  lifecycle: DesktopRendererLifecyclePort,
): () => void {
  const shellMode = getShellFeatureFlags().mode;
  const flowId = createRendererFlowId('renderer-bootstrap');
  let active = true;
  let settled = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  logRendererEvent({
    level: 'info',
    area: 'renderer-bootstrap',
    message: 'phase:bootstrap:start',
    flowId,
    details: { startedAt: new Date().toISOString() },
  });

  void resolveBootstrapTimeoutMs(shellMode).then((timeoutMs) => {
    if (!active || settled) return;
    timeoutId = setTimeout(() => {
      if (!active || settled) return;
      settled = true;
      if (shellMode === 'web') {
        lifecycle.setBootstrapReady(true);
        lifecycle.setBootstrapError(null);
        lifecycle.setStatusBanner({
          kind: 'warning',
          message: lifecycle.translate('Bootstrap.webDegraded'),
        });
        logRendererEvent({
          level: 'warn',
          area: 'renderer-bootstrap',
          message: 'phase:bootstrap:timeout-degraded',
          flowId,
          details: { timeoutMs, shellMode },
        });
        return;
      }
      const message = lifecycle.translate('Bootstrap.runtimeInitTimeout');
      lifecycle.setBootstrapReady(false);
      lifecycle.setBootstrapError(message);
      lifecycle.setStatusBanner({ kind: 'error', message });
      logRendererEvent({
        level: 'error',
        area: 'renderer-bootstrap',
        message: 'phase:bootstrap:timeout-failed',
        flowId,
        details: { timeoutMs, shellMode },
      });
    }, timeoutMs);
  });

  void bootstrapRuntime(lifecycle).then(() => {
    if (!active || settled) return;
    settled = true;
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
    lifecycle.setBootstrapReady(true);
    lifecycle.setBootstrapError(null);
    logRendererEvent({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'phase:bootstrap-watchdog:done',
      flowId,
    });
  }).catch((error) => {
    if (!active || settled) return;
    settled = true;
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
    const message = error instanceof Error ? error.message : String(error || 'bootstrap failed');
    lifecycle.setBootstrapError(message);
    lifecycle.setBootstrapReady(false);
    lifecycle.setStatusBanner({
      kind: 'error',
      message: `${lifecycle.translate('Bootstrap.startFailedPrefix')}: ${message}`,
    });
    logRendererEvent({
      level: 'error',
      area: 'renderer-bootstrap',
      message: 'phase:bootstrap-watchdog:failed',
      flowId,
      details: { error: message },
    });
  });

  return () => {
    active = false;
    if (timeoutId) clearTimeout(timeoutId);
    void disposeRuntimeBootstrap();
  };
}
