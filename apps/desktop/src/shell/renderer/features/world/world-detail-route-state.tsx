type WorldDetailPanelModule = typeof import('./world-detail-active-panel');

export async function loadWorldDetailPanelModule(): Promise<WorldDetailPanelModule> {
  return import('./world-detail-active-panel');
}

export function prefetchWorldDetailPanel(): void {
  void loadWorldDetailPanelModule();
}

export function WorldDetailRouteLoading() {
  return <div aria-hidden="true" className="flex min-h-0 flex-1 bg-transparent" />;
}
