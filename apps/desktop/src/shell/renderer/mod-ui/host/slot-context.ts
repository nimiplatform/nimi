import { useMemo } from 'react';
import { useAppStore, type AppTab } from '@renderer/app-shell/providers/app-store';
import type { UiExtensionContext } from '@renderer/mod-ui/contracts';

type UseUiExtensionContextOptions = {
  sidebarCollapsed?: boolean;
};

export function useUiExtensionContext(options: UseUiExtensionContextOptions = {}): UiExtensionContext {
  const authStatus = useAppStore((state) => state.auth.status);
  const activeTab = useAppStore((state) => state.activeTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const openModWorkspaceTab = useAppStore((state) => state.openModWorkspaceTab);
  const closeModWorkspaceTab = useAppStore((state) => state.closeModWorkspaceTab);
  const modWorkspaceTabs = useAppStore((state) => state.modWorkspaceTabs);
  const markRuntimeModFused = useAppStore((state) => state.markRuntimeModFused);
  const clearRuntimeModFuse = useAppStore((state) => state.clearRuntimeModFuse);
  const fusedRuntimeMods = useAppStore((state) => state.fusedRuntimeMods);
  const runtimeFields = useAppStore((state) => state.runtimeFields);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);

  return useMemo(
    () => ({
      isAuthenticated: authStatus === 'authenticated',
      activeTab,
      setActiveTab: (tab) => {
        setActiveTab(tab as AppTab);
      },
      openModTab: (tabId, modId, title) => {
        openModWorkspaceTab(tabId, title, modId);
      },
      closeModTab: (tabId) => {
        closeModWorkspaceTab(tabId);
      },
      isModTabOpen: (tabId) => modWorkspaceTabs.some((tab) => tab.tabId === tabId),
      markModFused: (modId, error, reason) => {
        markRuntimeModFused(modId, error, reason || 'render-failed');
      },
      clearModFuse: (modId) => {
        clearRuntimeModFuse(modId);
      },
      isModFused: (modId) => Boolean(fusedRuntimeMods[modId]),
      shellUi: {
        sidebarCollapsed: Boolean(options.sidebarCollapsed),
      },
      runtimeFields,
      setRuntimeFields: (fields) => {
        setRuntimeFields(fields);
      },
    }),
    [
      activeTab,
      authStatus,
      clearRuntimeModFuse,
      closeModWorkspaceTab,
      fusedRuntimeMods,
      markRuntimeModFused,
      modWorkspaceTabs,
      options.sidebarCollapsed,
      openModWorkspaceTab,
      setActiveTab,
      runtimeFields,
      setRuntimeFields,
    ],
  );
}
