import type { QueryClient } from '@tanstack/react-query';

import type { AppStoreApi } from '../app-shell/providers/app-store-factory.js';
import type { AgentConversationAnchorBindingStore } from '../app-shell/providers/agent-conversation-anchor-binding-storage.js';
import type {
  AppStoreState,
  RuntimeAccountAuthProjection,
  StatusBanner,
} from '../app-shell/providers/store-types.js';

/**
 * Narrow mutation surface used by production bootstrap and Simulator
 * projection subscriptions. It deliberately exposes neither the Zustand
 * store nor QueryClient ownership to an Adapter.
 */
export interface DesktopRendererLifecyclePort {
  auth(): AppStoreState['auth'];
  bootstrap(): Readonly<Pick<AppStoreState, 'bootstrapError' | 'bootstrapReady'>>;
  desktopReleaseInfo(): AppStoreState['desktopReleaseInfo'];
  translate(key: string, options?: Readonly<Record<string, unknown>>): string;
  subscribeBootstrap(listener: () => void): () => void;
  setActiveTab(tab: AppStoreState['activeTab']): void;
  setOfflineTier(tier: AppStoreState['offlineTier']): void;
  setAuthBootstrapping(): void;
  applyRuntimeAccountProjection(projection: RuntimeAccountAuthProjection): void;
  setAuthSession(user: Record<string, unknown> | null): void;
  clearAuthSession(): void;
  setDesktopReleaseInfo(info: AppStoreState['desktopReleaseInfo']): void;
  setDesktopReleaseError(message: string | null): void;
  setDesktopUpdateState(state: AppStoreState['desktopUpdateState']): void;
  setRuntimeDefaults(defaults: NonNullable<AppStoreState['runtimeDefaults']>): void;
  setStatusBanner(banner: StatusBanner | null): void;
  setBootstrapReady(ready: boolean): void;
  setBootstrapError(message: string | null): void;
  invalidateQueries(keys: readonly (readonly unknown[])[]): Promise<void>;
  cancelAndClearQueries(): Promise<void>;
  clearAgentConversationAnchorBindings(): void;
  readAgentConversationAnchorBinding(
    localAgentRef: string,
  ): ReturnType<AgentConversationAnchorBindingStore['get']>;
}

export function createDesktopRendererLifecyclePort(
  store: AppStoreApi,
  queryClient: QueryClient,
  translate: DesktopRendererLifecyclePort['translate'],
  anchorBindings: AgentConversationAnchorBindingStore,
): DesktopRendererLifecyclePort {
  const port: DesktopRendererLifecyclePort = {
    auth: () => store.getState().auth,
    bootstrap: () => {
      const state = store.getState();
      return Object.freeze({
        bootstrapError: state.bootstrapError,
        bootstrapReady: state.bootstrapReady,
      });
    },
    desktopReleaseInfo: () => store.getState().desktopReleaseInfo,
    translate,
    subscribeBootstrap(listener) {
      let previous = store.getState();
      return store.subscribe((next) => {
        if (
          next.bootstrapError === previous.bootstrapError
          && next.bootstrapReady === previous.bootstrapReady
        ) {
          previous = next;
          return;
        }
        previous = next;
        listener();
      });
    },
    setActiveTab: (tab) => store.getState().setActiveTab(tab),
    setOfflineTier: (tier) => store.getState().setOfflineTier(tier),
    setAuthBootstrapping: () => store.getState().setAuthBootstrapping(),
    applyRuntimeAccountProjection: (projection) => (
      store.getState().applyRuntimeAccountProjection(projection)
    ),
    setAuthSession: (user) => store.getState().setAuthSession(user),
    clearAuthSession: () => store.getState().clearAuthSession(),
    setDesktopReleaseInfo: (info) => store.getState().setDesktopReleaseInfo(info),
    setDesktopReleaseError: (message) => store.getState().setDesktopReleaseError(message),
    setDesktopUpdateState: (state) => store.getState().setDesktopUpdateState(state),
    setRuntimeDefaults: (defaults) => store.getState().setRuntimeDefaults(defaults),
    setStatusBanner: (banner) => store.getState().setStatusBanner(banner),
    setBootstrapReady: (ready) => store.getState().setBootstrapReady(ready),
    setBootstrapError: (message) => store.getState().setBootstrapError(message),
    async invalidateQueries(keys) {
      await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
    async cancelAndClearQueries() {
      await queryClient.cancelQueries();
      queryClient.clear();
    },
    clearAgentConversationAnchorBindings: anchorBindings.clearAll,
    readAgentConversationAnchorBinding: anchorBindings.get,
  };
  return Object.freeze(port);
}
