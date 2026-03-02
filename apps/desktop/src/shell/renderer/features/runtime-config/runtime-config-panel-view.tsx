import { useMemo } from 'react';
import { RUNTIME_PAGE_META } from './runtime-config-meta-v11';
import { RuntimeSidebar } from './panels/sidebar';
import { StatusBadge } from './panels/primitives';
import { OverviewPage } from './pages/overview-page';
import { LocalPage } from './pages/local-page';
import { CloudPage } from './pages/cloud-page';
import { RuntimePage } from './pages/runtime-page';
import { ModsPage } from './pages/mods-page';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { useRuntimeConfigPanelController } from './runtime-config-panel-controller';

export function RuntimeConfigPanelBody() {
  const model = useRuntimeConfigPanelController();
  return <RuntimeConfigPanelView model={model} />;
}

export function RuntimeConfigPanelView(props: { model: RuntimeConfigPanelControllerModel }) {
  const { model } = props;
  const { state } = model;

  const daemonRunning = model.runtimeDaemonStatus?.running === true;

  const installedModelCount = useMemo(
    () => state?.localRuntime.models.filter((m) => m.status !== 'removed').length ?? 0,
    [state],
  );
  const activeModelCount = useMemo(
    () => state?.localRuntime.models.filter((m) => m.status === 'active').length ?? 0,
    [state],
  );
  const healthyConnectorCount = useMemo(
    () => state?.connectors.filter((c) => c.status === 'healthy').length ?? 0,
    [state],
  );

  if (!state) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="rounded-[10px] border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">Loading runtime config...</div>
      </div>
    );
  }

  const runtimeStatus = model.runtimeStatus || state.localRuntime.status;
  const activePage = model.activePage;
  const pageMeta = RUNTIME_PAGE_META[activePage] || RUNTIME_PAGE_META.overview;

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-white">
        <div className="flex h-14 shrink-0 items-center px-5">
          <h1 className="text-lg font-semibold text-gray-900">AI Runtime</h1>
        </div>
        <RuntimeSidebar
          activePage={activePage}
          onSelectPage={model.onChangePage}
          installedModelCount={installedModelCount}
          activeModelCount={activeModelCount}
          connectorCount={state.connectors.length}
          healthyConnectorCount={healthyConnectorCount}
          modCount={model.runtimeDependencyTargets.length}
          daemonRunning={daemonRunning}
        />
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-gray-50">
        <div className="flex h-14 shrink-0 items-center bg-white px-6">
          <div className="flex w-full items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{pageMeta.name}</h2>
              <p className="text-xs text-gray-500">{pageMeta.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                daemonRunning ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}>
                daemon {daemonRunning ? 'running' : 'stopped'}
              </span>
              <StatusBadge status={runtimeStatus} />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-5xl space-y-6">
            {activePage === 'overview' && (
              <OverviewPage model={model} state={state} />
            )}
            {activePage === 'local' && (
              <LocalPage model={model} state={state} />
            )}
            {activePage === 'cloud' && (
              <CloudPage model={model} state={state} />
            )}
            {activePage === 'runtime' && (
              <RuntimePage model={model} state={state} />
            )}
            {activePage === 'mods' && (
              <ModsPage model={model} state={state} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
