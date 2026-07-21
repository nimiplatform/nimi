import {
  createNimiCanonicalRendererHostBindings,
  type NimiRendererHostFacadeV1,
  type NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';
import {
  readStorageTextFrom,
  resolveBrowserStorage,
  writeStorageTextTo,
} from '@nimiplatform/kit/core/storage-json';

import { createProductionAppStoreDependencies } from '../app-shell/providers/production-app-store-dependencies.js';
import { createBrowserAppAttentionSource } from '../app-shell/providers/production-app-attention-source.js';
import {
  LOCALE_STORAGE_KEY,
  resolveSupportedLocale,
} from '../i18n/desktop-i18n.js';
import type {
  DesktopCanonicalRendererBindings,
  DesktopRendererRoutePort,
  DesktopRendererRouteView,
} from './contract.js';

function readProductionLocale(): 'en' | 'zh' {
  const result = readStorageTextFrom(resolveBrowserStorage('local'), LOCALE_STORAGE_KEY);
  return resolveSupportedLocale(result.state === 'ready' ? result.value : '');
}

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
  const initialLocale = readProductionLocale();
  return createNimiCanonicalRendererHostBindings({
    scope: kit.scope,
    capabilities: kit.capabilities,
    localization: Object.freeze({
      locale: initialLocale === 'zh' ? 'zh-CN' : 'en-US',
      language: initialLocale,
      direction: 'ltr' as const,
    }),
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
      }),
      events: Object.freeze({
        subscribeAttention: attention.subscribe,
      }),
    },
    route: createDesktopBrowserRoutePort(),
    clock: Object.freeze({ now: Date.now }),
    surfaceLifecycle: kit.surfaceLifecycle,
  });
}
