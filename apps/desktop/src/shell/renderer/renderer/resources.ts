import { createIdleAppAttentionState } from '../app-shell/providers/app-attention-state.js';
import type { AppAttentionSource } from '../app-shell/providers/app-attention-source.js';
import { createAppStore } from '../app-shell/providers/app-store-factory.js';
import { createDesktopQueryClient } from '../infra/query-client/query-client.js';
import { createDesktopI18n, resolveSupportedLocale } from '../i18n/desktop-i18n.js';
import type { DesktopCanonicalRendererBindings } from './contract.js';
import { createDesktopRendererLifecyclePort } from './lifecycle-port.js';
import { createDesktopRouteProvider } from './route-provider.js';

export function createDesktopRendererResources(
  bindings: DesktopCanonicalRendererBindings,
) {
  const initial = bindings.app.projection.initialState();
  const store = createAppStore({
    initialAIConfig: initial.aiConfig,
    commitAIConfig: bindings.app.commands.commitAIConfig,
    initialChatThinkingPreference: initial.chatThinkingPreference,
    persistChatThinkingPreference: bindings.app.commands.persistChatThinkingPreference,
    setActiveScopeForMode: bindings.app.commands.setActiveScopeForMode,
  });
  store.setState({
    bootstrapError: initial.bootstrapError,
    bootstrapReady: initial.bootstrapReady,
  });
  const queryClient = createDesktopQueryClient();
  const i18n = createDesktopI18n({
    initialLocale: resolveSupportedLocale(bindings.localization.language),
    development: initial.development,
    now: bindings.clock.now,
    syncDocument: bindings.app.commands.applyLocale,
  });
  const attention: AppAttentionSource = Object.freeze({
    getSnapshot: () => bindings.app.projection.attention() ?? createIdleAppAttentionState(),
    subscribe: bindings.app.events.subscribeAttention,
  });
  const Router = createDesktopRouteProvider(bindings.route);
  const lifecycle = createDesktopRendererLifecyclePort(
    store,
    queryClient,
    (key, options) => String(i18n.instance.t(key, options)),
  );
  const disconnectLifecycle = bindings.app.events.connectLifecycle(lifecycle);
  let disposed = false;

  return Object.freeze({
    attention,
    i18n,
    queryClient,
    Router,
    store,
    dispose() {
      if (disposed) return;
      disposed = true;
      disconnectLifecycle();
      queryClient.clear();
    },
  });
}
