// Desktop public-for-web boundary: semantic Web bootstrap store facade.
import type { RuntimeDefaults } from '../../shell/renderer/bridge';
import { productionAppStore } from '../../shell/renderer/app-shell/providers/production-app-store';
export { productionQueryClient as desktopPublicWebQueryClient } from '../../shell/renderer/infra/query-client/production-query-client.js';

export type DesktopPublicWebAuthSnapshot = {
  status: string;
  user: Record<string, unknown> | null;
};

export type DesktopPublicWebBootstrapStore = {
  getAuthSnapshot: () => DesktopPublicWebAuthSnapshot;
  getCurrentUser: () => Record<string, unknown> | null;
  getRuntimeDefaults: () => RuntimeDefaults | null;
  beginBootstrap: () => void;
  applyAuthSession: (user: Record<string, unknown> | null) => void;
  applySignedOutAuthSession: () => void;
  applyRuntimeDefaults: (defaults: RuntimeDefaults) => void;
  completeBootstrap: () => void;
  failBootstrap: (message: string) => void;
};

function currentStore() {
  return productionAppStore.getState();
}

export const desktopPublicWebBootstrapStore: DesktopPublicWebBootstrapStore = {
  getAuthSnapshot() {
    const auth = currentStore().auth;
    return {
      status: String(auth.status || ''),
      user: auth.user && typeof auth.user === 'object'
        ? auth.user
        : null,
    };
  },
  getCurrentUser() {
    return currentStore().auth.user;
  },
  getRuntimeDefaults() {
    return currentStore().runtimeDefaults;
  },
  beginBootstrap() {
    const store = currentStore();
    store.setAuthBootstrapping();
    store.setBootstrapReady(false);
  },
  applyAuthSession(user) {
    currentStore().setAuthSession(user);
  },
  applySignedOutAuthSession() {
    currentStore().clearAuthSession();
  },
  applyRuntimeDefaults(defaults) {
    currentStore().setRuntimeDefaults(defaults);
  },
  completeBootstrap() {
    const store = currentStore();
    store.setBootstrapReady(true);
    store.setBootstrapError(null);
  },
  failBootstrap(message) {
    const store = currentStore();
    store.setBootstrapError(message);
    store.setBootstrapReady(false);
  },
};
