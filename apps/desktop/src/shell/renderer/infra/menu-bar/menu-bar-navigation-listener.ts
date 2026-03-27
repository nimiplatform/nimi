import { useEffect } from 'react';
import { getShellFeatureFlags } from '@nimiplatform/nimi-kit/core/shell-mode';
import { hasTauriRuntime, listenTauri } from '@runtime/tauri-api';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  loadRuntimeConfigStateV11,
  persistRuntimeConfigStateV11,
} from '@renderer/features/runtime-config/runtime-config-storage-persist';
import {
  normalizePageIdV11,
  type RuntimePageIdV11,
} from '@renderer/features/runtime-config/runtime-config-state-types';
import { dispatchRuntimeConfigOpenPage } from '@renderer/features/runtime-config/runtime-config-navigation-events';

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

export function useMenuBarNavigationListener(): void {
  const flags = getShellFeatureFlags();

  useEffect(() => {
    if (!flags.enableMenuBarShell) {
      return;
    }
    const listen = resolveTauriEventListen();
    if (!listen) {
      return;
    }

    let mounted = true;
    const unsubscribePromise = Promise.resolve(listen('menu-bar://open-tab', (event) => {
      if (!mounted) {
        return;
      }
      const payload = asOpenTabPayload(event.payload);
      const store = useAppStore.getState();

      if (payload.tab === 'settings') {
        store.setActiveTab('settings');
        return;
      }

      if (payload.tab === 'runtime') {
        const nextPage = payload.page || 'overview';
        const runtimeFields = store.runtimeFields;
        const state = loadRuntimeConfigStateV11({
          localProviderEndpoint: runtimeFields.localProviderEndpoint,
          localOpenAiEndpoint: runtimeFields.localOpenAiEndpoint,
          localProviderModel: runtimeFields.localProviderModel,
          provider: runtimeFields.provider,
          connectorId: runtimeFields.connectorId,
          runtimeModelType: runtimeFields.runtimeModelType,
        });
        persistRuntimeConfigStateV11({
          ...state,
          activePage: nextPage,
        });
        dispatchRuntimeConfigOpenPage(nextPage);
        store.setActiveTab('runtime');
      }
    }));

    return () => {
      mounted = false;
      void unsubscribePromise.then((unsubscribe) => {
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      });
    };
  }, [flags.enableMenuBarShell]);
}
