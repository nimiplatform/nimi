import type { ModLifecycleState } from '@renderer/mod-ui/contracts';

export const MOD_ROUTE_LRU_CAPACITY = 2;

type RouteTabRecord = {
  tabId: string;
  lastAccessedAt: number;
};

export function getRouteLifecycleLruTabIds(
  activeTab: string,
  modWorkspaceTabs: RouteTabRecord[],
): string[] {
  return [...modWorkspaceTabs]
    .filter((tab) => tab.tabId !== activeTab)
    .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
    .slice(0, MOD_ROUTE_LRU_CAPACITY)
    .map((tab) => tab.tabId);
}

export function isRouteTabOpen(
  tabId: string,
  modWorkspaceTabs: RouteTabRecord[],
): boolean {
  return modWorkspaceTabs.some((tab) => tab.tabId === tabId);
}

export function isRouteTabRetained(
  tabId: string,
  activeTab: string,
  modWorkspaceTabs: RouteTabRecord[],
): boolean {
  return getRouteLifecycleLruTabIds(activeTab, modWorkspaceTabs).includes(tabId);
}

export function getRouteLifecycleState(
  tabId: string,
  activeTab: string,
  modWorkspaceTabs: RouteTabRecord[],
): ModLifecycleState {
  if (activeTab === tabId) {
    return 'active';
  }
  if (!isRouteTabOpen(tabId, modWorkspaceTabs)) {
    return 'discarded';
  }
  if (isRouteTabRetained(tabId, activeTab, modWorkspaceTabs)) {
    return 'background-throttled';
  }
  return 'frozen';
}

export function shouldMountRouteTab(
  tabId: string,
  activeTab: string,
  modWorkspaceTabs: RouteTabRecord[],
): boolean {
  return activeTab === tabId || isRouteTabRetained(tabId, activeTab, modWorkspaceTabs);
}
