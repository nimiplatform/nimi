import {
  createRuntimeAccountBrowserBroker,
} from '@nimiplatform/kit/auth';
import type { AuthPlatformAdapter } from '@nimiplatform/kit/auth/shell';
import type { ShellOAuthBridge } from '@nimiplatform/kit/core/oauth';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { createNimiDesktopShellRuntimeAccountCaller } from '@nimiplatform/sdk/runtime';
import { productionAppStore } from '../../app-shell/providers/production-app-store';
import {
  initializeBuiltInChatScopesFromProductControl,
} from '../../app-shell/providers/desktop-ai-config-service';
import { desktopBridge } from '../../bridge';
import {
  refreshConversationCapabilityProjections,
} from '../chat/conversation-capability-projection';
import { bootstrapRuntime } from '../../infra/bootstrap/runtime-bootstrap';
import { applyRuntimeAccountStatusProjection } from '../../infra/bootstrap/auth-state-watcher';
import { getDesktopAccountRuntime } from '../../infra/sdk/desktop-nimi-client-session';
import { productionQueryClient } from '../../infra/query-client/production-query-client';
import { productionRendererLifecyclePort } from '../../renderer/production-lifecycle-port';
import type { DesktopRendererAuthPort } from '../../renderer/auth-port.js';

export const desktopOAuthBridge: ShellOAuthBridge = {
  hasShellHostInvoke: () => desktopBridge.hasShellHostInvoke(),
  oauthListenForCode: (payload) => desktopBridge.oauthListenForCode(payload),
  oauthTokenExchange: async () => {
    throw new Error('Desktop OAuth exchange is owned by RuntimeAccountService');
  },
  openExternalUrl: (url) => desktopBridge.openExternalUrl(url),
  focusMainWindow: () => desktopBridge.focusMainWindow(),
};

const desktopRuntimeAccountCaller = createNimiDesktopShellRuntimeAccountCaller({ appId: 'nimi.desktop' });

async function loadDesktopRuntimeAccountUser(): Promise<Record<string, unknown> | null> {
  const response = await desktopBridge.getRuntimeAccountSessionStatus();
  applyRuntimeAccountStatusProjection(response, productionRendererLifecyclePort);
  const projection = response.accountProjection;
  if (response.state !== 'authenticated' || !projection?.accountId) {
    return null;
  }
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
    getClient: () => ({
      runtime: {
        account: getDesktopAccountRuntime().account,
      },
    }),
    projectUser: (projection) => projection.accountId
      ? {
          id: projection.accountId,
          displayName: projection.displayName,
          realmEnvironmentId: projection.realmEnvironmentId,
        }
      : null,
  });
  return {
    begin: broker.begin,
    complete: async (request: Parameters<typeof broker.complete>[0]) => {
      await broker.complete(request);
      const user = await loadDesktopRuntimeAccountUser();
      if (!user) {
        throw new Error('Runtime account login completed without an authenticated account projection.');
      }
      return { user };
    },
  };
}

async function syncDesktopBuiltInChatAIConfigAfterLogin(): Promise<void> {
  const projection = await desktopBridge.getProductControlRecord();
  if (projection.state !== 'ready_for_use') {
    logRendererEvent({
      level: 'info',
      area: 'desktop-auth',
      message: 'phase:post-login-built-in-ai-config:skipped-product-not-ready',
      details: { productState: projection.state },
    });
    return;
  }
  await initializeBuiltInChatScopesFromProductControl();
  await refreshConversationCapabilityProjections(productionAppStore, ['text.generate']);
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

function runtimeAccountOwned(route: string): never {
  throw new Error(`Desktop ${route} is owned by RuntimeAccountService`);
}

export function createDesktopAuthAdapter(): AuthPlatformAdapter {
  return {
    supportsPasswordLogin: false,
    checkEmail: async () => runtimeAccountOwned('checkEmail'),
    passwordLogin: async () => runtimeAccountOwned('passwordLogin'),
    requestEmailOtp: async () => runtimeAccountOwned('requestEmailOtp'),
    verifyEmailOtp: async () => runtimeAccountOwned('verifyEmailOtp'),
    verifyTwoFactor: async () => runtimeAccountOwned('verifyTwoFactor'),
    walletChallenge: async () => runtimeAccountOwned('walletChallenge'),
    walletLogin: async () => runtimeAccountOwned('walletLogin'),
    oauthLogin: async () => runtimeAccountOwned('oauthLogin'),
    updatePassword: async () => runtimeAccountOwned('updatePassword'),
    loadCurrentUser: async () => {
      await ensureAuthApiReady();
      return loadDesktopRuntimeAccountUser();
    },
    applyToken: async () => runtimeAccountOwned('applyToken'),
    restoreSession: async () => runtimeAccountOwned('restoreSession'),
    persistSession: async () => runtimeAccountOwned('persistSession'),
    clearPersistedSession: async () => {
      productionAppStore.getState().clearAuthSession();
    },
    oauthBridge: desktopOAuthBridge,
    syncAfterLogin: async () => {
      const results = await Promise.allSettled([
        productionQueryClient.invalidateQueries({ queryKey: ['chats'] }),
        productionQueryClient.invalidateQueries({ queryKey: ['contacts'] }),
        syncDesktopBuiltInChatAIConfigAfterLogin(),
      ]);
      logDesktopPostLoginSyncFailures(results);
    },
  };
}

export function createDesktopProductionAuthPort(): DesktopRendererAuthPort {
  return Object.freeze({
    adapter: createDesktopAuthAdapter(),
    oauthBridge: desktopOAuthBridge,
    runtimeAccountBroker: createDesktopRuntimeAccountBrowserBroker(),
  });
}
