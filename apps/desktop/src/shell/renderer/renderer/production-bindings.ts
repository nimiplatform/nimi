import {
  createNimiCanonicalRendererHostBindings,
  type NimiRendererHostFacadeV1,
  type NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';
import { resolveBrowserStorage, writeStorageTextTo } from '@nimiplatform/kit/core/storage-json';

import { createProductionAppStoreDependencies } from '../app-shell/providers/production-app-store-dependencies.js';
import { createBrowserAppAttentionSource } from '../app-shell/providers/production-app-attention-source.js';
import { LOCALE_STORAGE_KEY } from '../i18n/desktop-i18n.js';
import type {
  DesktopCanonicalRendererBindings,
  DesktopRendererRoutePort,
  DesktopRendererRouteView,
} from './contract.js';
import { connectMenuBarNavigation } from '../infra/menu-bar/menu-bar-navigation-listener.js';
import { connectMenuBarRuntimeSync } from '../infra/menu-bar/menu-bar-runtime-sync.js';
import { connectRuntimeHealthCoordinator } from '../features/runtime-config/runtime-health-coordinator.js';
import { getShellFeatureFlags } from '@nimiplatform/kit/core/shell-mode';
import {
  connectDesktopUpdates,
  runDesktopUpdateCheck,
  runDesktopUpdateInstall,
  runDesktopUpdateRestart,
} from '../infra/bootstrap/desktop-updates.js';
import type { DesktopRendererLifecyclePort } from './lifecycle-port.js';
import { connectDesktopMacosSmoke } from '../infra/bootstrap/desktop-macos-smoke.js';
import { connectProductionBootstrap } from './production-bootstrap.js';
import { desktopBridge } from '../bridge.js';
import {
  decideLocalDevelopmentApproval,
  listPendingLocalDevelopmentApprovals,
  localDevelopmentBridgeAvailable,
  subscribeLocalDevelopmentApprovals,
} from '../features/local-development/local-development-bridge.js';
import {
  continueOauthNextIfPresent,
  freshOauthLoginGateStorageKey,
  readFreshOauthLoginState,
} from '../features/auth/oauth-next-continuation.js';
import {
  getDesktopAccountRuntime,
  getDesktopAppId,
  getDesktopHostRuntimeAgentClient,
  getDesktopNimiClient,
  getDesktopRealm,
  getDesktopRuntime,
  getDesktopRuntimeAccountCaller,
  getDesktopRuntimeAgentTurnsRuntime,
  isDesktopNimiClientSessionReady,
  isDesktopRuntimeAccountSessionReady,
  withDesktopRuntimeProtectedScopes,
} from '../infra/sdk/desktop-nimi-client-session.js';
import { connectDesktopOpenIntentListener } from '../infra/desktop-open/desktop-open-intent-listener.js';
import {
  isDeveloperModeEnabled,
  refreshDeveloperMode,
  setDeveloperMode,
  subscribeDeveloperMode,
} from '../features/developer/developer-mode.js';
import { connectProductionChatRealtimeSync } from '../infra/realtime/production-chat-realtime-sync.js';
import { createDesktopProductionFirstRunPort } from './production-first-run-port.js';
import { createDesktopProductionSettingsPort } from '../features/settings/settings-storage.js';
import { createDesktopProductionAuthPort } from '../features/auth/desktop-auth-adapter.js';
import { createDesktopRendererRuntimeConfigNavigationPort } from './runtime-config-navigation-port.js';
import { callRealmApi, emitRealmDataError } from '../infra/realm/realm-api.js';
import { productionRealmSocialOfflinePort } from '../features/social/data/production-social-offline-port.js';

export function createDesktopBrowserRoutePort(): DesktopRendererRoutePort {
  function read(): DesktopRendererRouteView {
    const fragment = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const route = fragment.startsWith('/')
      ? new URL(fragment, window.location.origin)
      : new URL(window.location.href);
    return Object.freeze({
      pathname: route.pathname || '/',
      search: route.search,
      hash: route.hash,
      state: window.history.state,
      key: String(window.history.state?.key || 'production'),
    });
  }
  let snapshot = read();
  return Object.freeze({
    get: () => snapshot,
    subscribe(listener: () => void) {
      const onRoute = () => {
        snapshot = read();
        listener();
      };
      window.addEventListener('hashchange', onRoute);
      window.addEventListener('popstate', onRoute);
      return () => {
        window.removeEventListener('hashchange', onRoute);
        window.removeEventListener('popstate', onRoute);
      };
    },
    navigate({ to, replace, state }: Parameters<DesktopRendererRoutePort['navigate']>[0]) {
      const href = `#${to.startsWith('/') ? to : `/${to}`}`;
      if (replace) {
        window.history.replaceState(state ?? null, '', href);
      } else {
        window.history.pushState(state ?? null, '', href);
      }
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    go: (delta: number) => window.history.go(delta),
  });
}

export function createDesktopProductionBindings(
  kit: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>,
): DesktopCanonicalRendererBindings {
  const dependencies = createProductionAppStoreDependencies();
  const attention = createBrowserAppAttentionSource();
  const runtimeConfigNavigation = createDesktopRendererRuntimeConfigNavigationPort();
  let connectedLifecycle: DesktopRendererLifecyclePort | null = null;
  const requireLifecycle = () => {
    if (!connectedLifecycle) throw new Error('DESKTOP_PRODUCTION_LIFECYCLE_NOT_CONNECTED');
    return connectedLifecycle;
  };
  return createNimiCanonicalRendererHostBindings({
    scope: kit.scope,
    capabilities: kit.capabilities,
    localization: kit.localization,
    kit,
    sdk: Object.freeze({
      isSessionReady: isDesktopNimiClientSessionReady,
      isRuntimeAccountSessionReady: isDesktopRuntimeAccountSessionReady,
      appId: getDesktopAppId,
      client: getDesktopNimiClient,
      runtime: getDesktopRuntime,
      runtimeAgentTurns: getDesktopRuntimeAgentTurnsRuntime,
      hostRuntimeAgent: getDesktopHostRuntimeAgentClient,
      accountRuntime: getDesktopAccountRuntime,
      realm: getDesktopRealm,
      socialData: Object.freeze({
        callApi: callRealmApi,
        emitDataError: emitRealmDataError,
        offline: productionRealmSocialOfflinePort,
      }),
      accountCaller: getDesktopRuntimeAccountCaller,
      withRuntimeProtectedScopes: withDesktopRuntimeProtectedScopes,
    }),
    app: {
      projection: Object.freeze({
        initialState: () => ({
          aiConfig: dependencies.initialAIConfig,
          bootstrapError: null,
          bootstrapReady: false,
          chatThinkingPreference: dependencies.initialChatThinkingPreference,
          development: Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV),
        }),
        attention: attention.getSnapshot,
        localDevelopmentAvailable: localDevelopmentBridgeAvailable,
        loginMode: () => getShellFeatureFlags().mode === 'web' ? 'embedded' : 'desktop-browser',
        developerModeEnabled: isDeveloperModeEnabled,
        viewportWidth: () => window.innerWidth || document.documentElement.clientWidth,
      }),
      commands: Object.freeze({
        auth: createDesktopProductionAuthPort(),
        firstRun: createDesktopProductionFirstRunPort(),
        runtimeConfigNavigation,
        settings: createDesktopProductionSettingsPort(),
        commitAIConfig: dependencies.commitAIConfig,
        persistChatThinkingPreference: dependencies.persistChatThinkingPreference,
        setActiveScopeForMode: dependencies.setActiveScopeForMode,
        applyLocale({ locale, lang, title }: Parameters<
          DesktopCanonicalRendererBindings['app']['commands']['applyLocale']
        >[0]) {
          writeStorageTextTo(resolveBrowserStorage('local'), LOCALE_STORAGE_KEY, locale);
          document.documentElement.lang = lang;
          document.title = title;
        },
        async reconcileLoginState({ authStatus }: Parameters<
          DesktopCanonicalRendererBindings['app']['commands']['reconcileLoginState']
        >[0]) {
          if (getShellFeatureFlags().mode !== 'web') {
            return Object.freeze({ clearAuthSession: false });
          }
          const freshOauthState = readFreshOauthLoginState(window.location.search);
          if (freshOauthState && authStatus === 'anonymous') {
            const key = freshOauthLoginGateStorageKey(freshOauthState);
            if (!window.sessionStorage.getItem(key)) {
              window.sessionStorage.setItem(key, 'started');
            }
          }
          if (authStatus === 'authenticated') {
            if (freshOauthState) {
              const key = freshOauthLoginGateStorageKey(freshOauthState);
              const marker = window.sessionStorage.getItem(key);
              if (!marker) {
                window.sessionStorage.setItem(key, 'cleared');
                return Object.freeze({ clearAuthSession: true });
              }
            }
            continueOauthNextIfPresent(window.location.search);
          }
          return Object.freeze({ clearAuthSession: false });
        },
        checkDesktopUpdate: (input: Parameters<
          DesktopCanonicalRendererBindings['app']['commands']['checkDesktopUpdate']
        >[0]) => runDesktopUpdateCheck(requireLifecycle(), input),
        installDesktopUpdate: (input: Parameters<
          DesktopCanonicalRendererBindings['app']['commands']['installDesktopUpdate']
        >[0]) => runDesktopUpdateInstall(requireLifecycle(), input),
        restartDesktopUpdate: runDesktopUpdateRestart,
        async startWindowDrag() {
          if (!getShellFeatureFlags().enableTitlebarDrag) {
            throw new Error('DESKTOP_WINDOW_DRAG_UNAVAILABLE');
          }
          await desktopBridge.startWindowDrag();
        },
        listLocalDevelopmentApprovals: listPendingLocalDevelopmentApprovals,
        decideLocalDevelopmentApproval: ({
          requestId,
          decision,
          riskDisclosureAcknowledged,
        }: Parameters<
          DesktopCanonicalRendererBindings['app']['commands']['decideLocalDevelopmentApproval']
        >[0]) => decideLocalDevelopmentApproval(
          requestId,
          decision,
          riskDisclosureAcknowledged,
        ),
        refreshDeveloperMode,
        setDeveloperMode,
      }),
      events: Object.freeze({
        connectChatRealtimeSync: connectProductionChatRealtimeSync,
        subscribeWindowFocus(listener: (focused: boolean) => void) {
          const onFocus = () => listener(true);
          const onBlur = () => listener(false);
          window.addEventListener('focus', onFocus);
          window.addEventListener('blur', onBlur);
          return () => {
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('blur', onBlur);
          };
        },
        subscribeWindowResize(listener: () => void) {
          window.addEventListener('resize', listener);
          return () => window.removeEventListener('resize', listener);
        },
        subscribeWindowKeyDown(listener: (event: KeyboardEvent) => void) {
          window.addEventListener('keydown', listener);
          return () => window.removeEventListener('keydown', listener);
        },
        subscribeDocumentMouseDown(listener: (event: MouseEvent) => void) {
          document.addEventListener('mousedown', listener);
          return () => document.removeEventListener('mousedown', listener);
        },
        subscribeAttention: attention.subscribe,
        subscribeDeveloperMode,
        subscribeLocalDevelopmentApprovals,
        subscribeProductControlRecord(listener: Parameters<
          DesktopCanonicalRendererBindings['app']['events']['subscribeProductControlRecord']
        >[0]) {
          let active = true;
          let refreshInFlight = false;
          const refresh = async () => {
            if (!active || refreshInFlight) return;
            refreshInFlight = true;
            try {
              const projection = await desktopBridge.getProductControlRecord();
              if (active) listener({ ok: true, projection });
            } catch (error) {
              if (active) listener({
                ok: false,
                error: error instanceof Error ? error.message : String(error || 'product control record unavailable'),
              });
            } finally {
              refreshInFlight = false;
            }
          };
          const interval = window.setInterval(refresh, 3_000);
          window.addEventListener('focus', refresh);
          void refresh();
          return () => {
            active = false;
            window.clearInterval(interval);
            window.removeEventListener('focus', refresh);
          };
        },
        connectDesktopOpenIntents: () => connectDesktopOpenIntentListener(runtimeConfigNavigation),
        connectLifecycle(lifecycle: Parameters<
          DesktopCanonicalRendererBindings['app']['events']['connectLifecycle']
        >[0]) {
          if (connectedLifecycle) {
            throw new Error('DESKTOP_PRODUCTION_LIFECYCLE_ALREADY_CONNECTED');
          }
          connectedLifecycle = lifecycle;
          let active = true;
          const disconnectMenuBarNavigation = connectMenuBarNavigation(lifecycle, runtimeConfigNavigation);
          const disconnectRuntimeHealth = connectRuntimeHealthCoordinator(
            lifecycle,
            getShellFeatureFlags().mode === 'desktop',
          );
          const disconnectMenuBarRuntimeSync = connectMenuBarRuntimeSync(lifecycle);
          const disconnectDesktopUpdates = connectDesktopUpdates(lifecycle);
          const disconnectDesktopMacosSmoke = connectDesktopMacosSmoke(lifecycle);
          const disconnectBootstrap = connectProductionBootstrap(lifecycle);
          return () => {
            if (!active) return;
            active = false;
            connectedLifecycle = null;
            disconnectDesktopMacosSmoke();
            disconnectDesktopUpdates();
            disconnectMenuBarRuntimeSync();
            disconnectRuntimeHealth();
            disconnectMenuBarNavigation();
            disconnectBootstrap();
          };
        },
      }),
    },
    route: createDesktopBrowserRoutePort(),
    clock: Object.freeze({
      now: Date.now,
      schedule(delayMs: number, listener: Parameters<DesktopCanonicalRendererBindings['clock']['schedule']>[1]) {
        const timer = window.setTimeout(() => listener({ ok: true }), delayMs);
        return () => window.clearTimeout(timer);
      },
    }),
    surfaceLifecycle: kit.surfaceLifecycle,
  });
}
