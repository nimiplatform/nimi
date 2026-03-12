import { useMemo, useRef } from 'react';
import { useAppStore, type AppTab } from '@renderer/app-shell/providers/app-store';
import type { UiExtensionContext } from '@renderer/mod-ui/contracts';
import {
  getRouteLifecycleState,
  isRouteTabOpen,
  isRouteTabRetained,
} from '@renderer/mod-ui/lifecycle/route-lifecycle';
import { showModTabLimitBanner } from './mod-tab-limit-banner';

type UseUiExtensionContextOptions = {
  sidebarCollapsed?: boolean;
};

export function useUiExtensionContext(options: UseUiExtensionContextOptions = {}): UiExtensionContext {
  const authStatus = useAppStore((state) => state.auth.status);
  const activeTab = useAppStore((state) => state.activeTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const openModWorkspaceTab = useAppStore((state) => state.openModWorkspaceTab);
  const closeModWorkspaceTab = useAppStore((state) => state.closeModWorkspaceTab);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const touchModWorkspaceTab = useAppStore((state) => state.touchModWorkspaceTab);
  const modWorkspaceTabs = useAppStore((state) => state.modWorkspaceTabs);
  const markRuntimeModFused = useAppStore((state) => state.markRuntimeModFused);
  const clearRuntimeModFuse = useAppStore((state) => state.clearRuntimeModFuse);
  const fusedRuntimeMods = useAppStore((state) => state.fusedRuntimeMods);
  const runtimeFields = useAppStore((state) => state.runtimeFields);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);

  // Use refs for values only accessed inside callbacks — changes to these
  // must not trigger a context rebuild and downstream rerender cascade.
  const modWorkspaceTabsRef = useRef(modWorkspaceTabs);
  modWorkspaceTabsRef.current = modWorkspaceTabs;

  const fusedRuntimeModsRef = useRef(fusedRuntimeMods);
  fusedRuntimeModsRef.current = fusedRuntimeMods;

  return useMemo(
    () => ({
      isAuthenticated: authStatus === 'authenticated',
      activeTab,
      setActiveTab: (tab) => {
        if (tab.startsWith('mod:')) {
          touchModWorkspaceTab(tab as `mod:${string}`);
        }
        setActiveTab(tab as AppTab);
      },
      openModTab: (tabId, modId, title) => {
        const result = openModWorkspaceTab(tabId, title, modId);
        if (result === 'rejected-limit') {
          showModTabLimitBanner({
            setStatusBanner,
            setActiveTab: (tab) => {
              setActiveTab(tab);
            },
          });
        }
      },
      closeModTab: (tabId) => {
        closeModWorkspaceTab(tabId);
      },
      isModTabOpen: (tabId) => isRouteTabOpen(tabId, modWorkspaceTabsRef.current),
      isModTabRetained: (tabId) => isRouteTabRetained(tabId, activeTab, modWorkspaceTabsRef.current),
      getModLifecycleState: (tabId) => getRouteLifecycleState(tabId, activeTab, modWorkspaceTabsRef.current),
      markModFused: (modId, error, reason) => {
        markRuntimeModFused(modId, error, reason || 'render-failed');
      },
      clearModFuse: (modId) => {
        clearRuntimeModFuse(modId);
      },
      isModFused: (modId) => Boolean(fusedRuntimeModsRef.current[modId]),
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
      markRuntimeModFused,
      options.sidebarCollapsed,
      openModWorkspaceTab,
      setActiveTab,
      setStatusBanner,
      touchModWorkspaceTab,
      runtimeFields,
      setRuntimeFields,
    ],
  );
}
