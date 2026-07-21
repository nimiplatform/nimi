import { useEffect } from 'react';
import { getShellFeatureFlags } from '@nimiplatform/kit/core/shell-mode';
import { hasTauriRuntime, listenTauri } from '@nimiplatform/kit/shell/renderer/bridge';
import { useAppStoreApi } from '../../app-shell/providers/app-store';
import {
  loadRuntimeConfigStateV11,
  persistRuntimeConfigStateV11,
} from '../../features/runtime-config/runtime-config-storage-persist';
import {
  normalizePageIdV11,
  type RuntimePageIdV11,
} from '../../features/runtime-config/runtime-config-state-types';
import { dispatchRuntimeConfigOpenPage } from '../../features/runtime-config/runtime-config-navigation-events';
import type { DesktopRendererLifecyclePort } from '../../renderer/lifecycle-port';

type MenuBarOpenTabEvent =
  | { tab?: 'runtime'; page?: RuntimePageIdV11 }
  | { tab?: 'settings' };

type TauriEventUnsubscribe = () => void;
type TauriListenResult = Promise<TauriEventUnsubscribe | undefined> | TauriEventUnsubscribe | undefined;

function resolveTauriEventListen(): ((eventName: string, handler: (event: { payload: unknown }) => void) => TauriListenResult) | null {
  if (!hasTauriRuntime()) {
    return null;
  }
  return listenTauri;
}

function asOpenTabPayload(value: unknown): MenuBarOpenTabEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const tab = String(record.tab || '').trim();
  const page = String(record.page || '').trim();
  if (tab === 'runtime') {
    return {
      tab: 'runtime',
      page: normalizePageIdV11(page || 'overview'),
    };
  }
  if (tab === 'settings') {
    return { tab: 'settings' };
  }
  return {};
}

type MenuBarNavigationPort = Pick<DesktopRendererLifecyclePort, 'setActiveTab'>;

export function connectMenuBarNavigation(port: MenuBarNavigationPort): () => void {
  const flags = getShellFeatureFlags();
  if (!flags.enableMenuBarShell) {
    return () => {};
  }
  const listen = resolveTauriEventListen();
  if (!listen) {
    return () => {};
  }

  let active = true;
  const unsubscribePromise = Promise.resolve(listen('menu-bar://open-tab', (event) => {
    if (!active) {
      return;
    }
    const payload = asOpenTabPayload(event.payload);

    if (payload.tab === 'settings') {
      port.setActiveTab('settings');
      return;
    }

    if (payload.tab === 'runtime') {
      const nextPage = payload.page || 'overview';
      const state = loadRuntimeConfigStateV11();
      persistRuntimeConfigStateV11({
        ...state,
        activePage: nextPage,
      });
      dispatchRuntimeConfigOpenPage(nextPage);
      port.setActiveTab('runtime');
    }
  }));

  return () => {
    active = false;
    void unsubscribePromise.then((unsubscribe) => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    });
  };
}

export function useMenuBarNavigationListener(): void {
  const store = useAppStoreApi();
  useEffect(() => connectMenuBarNavigation({
    setActiveTab: (tab) => store.getState().setActiveTab(tab),
  }), [store]);
}
