import type { ModLifecycleState } from '@renderer/mod-ui/contracts';

type RouteTabRecord = {
  tabId: string;
  lastAccessedAt: number;
};

export function isRouteTabOpen(
  tabId: string,
  modWorkspaceTabs: RouteTabRecord[],
): boolean {
  return modWorkspaceTabs.some((tab) => tab.tabId === tabId);
}

export function isRouteTabRetained(
  tabId: string,
  _activeTab: string,
  modWorkspaceTabs: RouteTabRecord[],
): boolean {
  return isRouteTabOpen(tabId, modWorkspaceTabs);
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
  return 'background-throttled';
}

export function shouldMountRouteTab(
  tabId: string,
  _activeTab: string,
  modWorkspaceTabs: RouteTabRecord[],
): boolean {
  return isRouteTabOpen(tabId, modWorkspaceTabs);
}
