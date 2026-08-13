import { createRuntimeAccountBrowserBroker } from '@nimiplatform/kit/auth/shell';
import type { ShellOAuthCodeBridge } from '@nimiplatform/kit/core/oauth';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { createNimiDesktopShellRuntimeAccountCaller } from '@nimiplatform/sdk/runtime';
import { desktopBridge } from '../../bridge';
import { bootstrapRuntime } from '../../infra/bootstrap/runtime-bootstrap';
import { applyRuntimeAccountStatusProjection } from '../../infra/bootstrap/auth-state-watcher';
import { getDesktopAccountRuntime } from '../../infra/sdk/desktop-nimi-client-session';
import { productionQueryClient } from '../../infra/query-client/production-query-client';
import { productionRendererLifecyclePort } from '../../renderer/production-lifecycle-port';
import type { DesktopRendererAuthPort } from '../../renderer/auth-port.js';

export const desktopOAuthBridge: ShellOAuthCodeBridge = {
  hasShellHostInvoke: () => desktopBridge.hasElectronInvoke(),
  oauthListenForCode: (payload) => desktopBridge.oauthListenForCode(payload),
  openExternalUrl: (url) => desktopBridge.openExternalUrl(url),
  focusMainWindow: () => desktopBridge.focusMainWindow(),
};

const desktopRuntimeAccountCaller = createNimiDesktopShellRuntimeAccountCaller({ appId: 'nimi.desktop' });

async function loadDesktopRuntimeAccountUser(): Promise<Record<string, unknown> | null> {
  const response = await desktopBridge.getRuntimeAccountSessionStatus();
  applyRuntimeAccountStatusProjection(response, productionRendererLifecyclePort);
  const projection = response.accountProjection;
  if (response.state !== 'authenticated' || !projection?.accountId) return null;
  return {
    id: projection.accountId,
    displayName: projection.displayName,
    realmEnvironmentId: projection.realmEnvironmentId,
  };
}

export function createDesktopRuntimeAccountBrowserBroker() {
  const broker = createRuntimeAccountBrowserBroker({
    caller: desktopRuntimeAccountCaller,
    beforeRequest: ensureAuthApiReady,
    getClient: () => ({ runtime: { account: getDesktopAccountRuntime().account } }),
    projectUser: (projection) => projection.accountId ? {
      id: projection.accountId,
      displayName: projection.displayName,
      realmEnvironmentId: projection.realmEnvironmentId,
    } : null,
  });
  return {
    begin: broker.begin,
    complete: async (request: Parameters<typeof broker.complete>[0]) => {
      await broker.complete(request);
      const user = await loadDesktopRuntimeAccountUser();
      if (!user) throw new Error('Runtime account login completed without an authenticated account projection.');
      return { user };
    },
  };
}

function logDesktopPostLoginSyncFailures(results: readonly PromiseSettledResult<unknown>[]): void {
  for (const result of results) {
    if (result.status !== 'rejected') continue;
    logRendererEvent({
      level: 'warn',
      area: 'desktop-auth',
      message: 'phase:post-login-sync:deferred',
      details: { error: result.reason instanceof Error ? result.reason.message : String(result.reason || 'unknown') },
    });
  }
}

export async function ensureAuthApiReady(): Promise<void> {
  await bootstrapRuntime(productionRendererLifecyclePort);
}

export function createDesktopProductionAuthPort(): DesktopRendererAuthPort {
  const runtimeAccountBroker = createDesktopRuntimeAccountBrowserBroker();
  return Object.freeze({
    oauthBridge: desktopOAuthBridge,
    runtimeAccountBroker: {
      ...runtimeAccountBroker,
      complete: async (request: Parameters<typeof runtimeAccountBroker.complete>[0]) => {
        const result = await runtimeAccountBroker.complete(request);
        logDesktopPostLoginSyncFailures(await Promise.allSettled([
          productionQueryClient.invalidateQueries({ queryKey: ['chats'] }),
          productionQueryClient.invalidateQueries({ queryKey: ['contacts'] }),
        ]));
        return result;
      },
    },
  });
}
