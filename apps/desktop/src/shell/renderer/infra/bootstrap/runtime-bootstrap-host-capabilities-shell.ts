import { emitRuntimeLog } from '@runtime/telemetry/logger';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { SlotHost } from '@renderer/mod-ui/host/slot-host';
import { useUiExtensionContext } from '@renderer/mod-ui/host/slot-context';
import type { LifecycleSubscriptionManager } from '@renderer/mod-ui/lifecycle/lifecycle-subscription-manager';
import type { ModSdkHost } from '@nimiplatform/sdk/mod';

export function buildRuntimeHostShellCapabilities(input: {
  lifecycleManager: LifecycleSubscriptionManager;
}): Pick<ModSdkHost, 'ui' | 'shell' | 'settings' | 'logging' | 'lifecycle'> {
  return {
    ui: {
      useAppStore: <T>(selector: (state: unknown) => T): T => useAppStore((state) => selector(state)),
      SlotHost: SlotHost as never,
      useUiExtensionContext,
    },
    shell: {
      useAuth: () => {
        const status = useAppStore((state) => state.auth.status);
        const user = useAppStore((state) => state.auth.user);
        return {
          isAuthenticated: status === 'authenticated',
          user,
        };
      },
      useBootstrap: () => {
        const ready = useAppStore((state) => state.bootstrapReady);
        const error = useAppStore((state) => state.bootstrapError);
        return { ready, error };
      },
      useNavigation: () => {
        const activeTab = useAppStore((state) => state.activeTab);
        const setActiveTab = useAppStore((state) => state.setActiveTab);
        const navigateToProfile = useAppStore((state) => state.navigateToProfile);
        return {
          activeTab,
          setActiveTab: (tab) => setActiveTab(tab as typeof activeTab),
          navigateToProfile,
        };
      },
      useRuntimeFields: () => {
        const runtimeFields = useAppStore((state) => state.runtimeFields);
        const setRuntimeField = useAppStore((state) => state.setRuntimeField);
        const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
        return {
          runtimeFields,
          setRuntimeField,
          setRuntimeFields,
        };
      },
      useStatusBanner: () => {
        const setStatusBanner = useAppStore((state) => state.setStatusBanner);
        return {
          showStatusBanner: setStatusBanner,
        };
      },
    },
    settings: {
      useRuntimeModSettings: (modId) => {
        const runtimeModSettingsById = useAppStore((state) => state.runtimeModSettingsById);
        return runtimeModSettingsById[String(modId || '').trim()] || {};
      },
      setRuntimeModSettings: (modId, settings) => {
        useAppStore.getState().setRuntimeModSettings(modId, settings);
      },
    },
    logging: {
      emitRuntimeLog,
      createRendererFlowId,
      logRendererEvent,
    },
    lifecycle: {
      subscribe: (tabId, handler) => input.lifecycleManager.subscribe(tabId, handler),
      getState: (tabId) => input.lifecycleManager.getState(tabId),
    },
  };
}
