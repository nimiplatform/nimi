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
    sdk: Object.freeze({}),
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
      }),
      commands: Object.freeze({
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
      }),
      events: Object.freeze({
        subscribeAttention: attention.subscribe,
        subscribeLocalDevelopmentApprovals,
        connectLifecycle(lifecycle: Parameters<
          DesktopCanonicalRendererBindings['app']['events']['connectLifecycle']
        >[0]) {
          if (connectedLifecycle) {
            throw new Error('DESKTOP_PRODUCTION_LIFECYCLE_ALREADY_CONNECTED');
          }
          connectedLifecycle = lifecycle;
          let active = true;
          const disconnectMenuBarNavigation = connectMenuBarNavigation(lifecycle);
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
    clock: Object.freeze({ now: Date.now }),
    surfaceLifecycle: kit.surfaceLifecycle,
  });
}
