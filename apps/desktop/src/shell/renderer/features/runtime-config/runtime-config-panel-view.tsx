import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_PAGE_TITLE_CLASS } from '@renderer/components/typography.js';
import { RUNTIME_PAGE_META } from './runtime-config-meta-v11';
import { RuntimeSidebar } from './runtime-config-sidebar';
import { StatusBadge, DaemonStatusBadge } from './runtime-config-primitives';
import { OverviewPage } from './runtime-config-page-overview';
import { LocalPage } from './runtime-config-page-local';
import { CloudPage } from './runtime-config-page-cloud';
import { CatalogPage } from './runtime-config-page-catalog';
import { RuntimePage } from './runtime-config-page-runtime';
import { ModsPage } from './runtime-config-page-mods';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { useRuntimeConfigPanelController } from './runtime-config-panel-controller';

function RuntimeSkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-white ${className}`} />;
}

export function RuntimeConfigPanelBody() {
  const model = useRuntimeConfigPanelController();
  return <RuntimeConfigPanelView model={model} />;
}

export function RuntimeConfigPanelView(props: { model: RuntimeConfigPanelControllerModel }) {
  const { t } = useTranslation();
  const MIN_SIDEBAR_WIDTH = 200;
  const MAX_SIDEBAR_WIDTH = 420;
  const { model } = props;
  const { state } = model;
  const [sidebarWidth, setSidebarWidth] = useState(224);
  const containerRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);

  const daemonRunning = model.runtimeDaemonStatus?.running === true;

  const installedModelCount = useMemo(
    () => state?.local.models.filter((m) => m.status !== 'removed').length ?? 0,
    [state],
  );
  const activeModelCount = useMemo(
    () => state?.local.models.filter((m) => m.status === 'active').length ?? 0,
    [state],
  );
  const healthyConnectorCount = useMemo(
    () => state?.connectors.filter((c) => c.status === 'healthy').length ?? 0,
    [state],
  );

  useEffect(() => {
    const onMouseMove = (event: globalThis.MouseEvent) => {
      if (!resizingRef.current || !containerRef.current) {
        return;
      }
      const rect = containerRef.current.getBoundingClientRect();
      const nextWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, Math.round(event.clientX - rect.left)),
      );
      setSidebarWidth(nextWidth);
    };

    const onMouseUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const startResize = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  if (!state) {
    return (
      <div className="flex min-h-0 flex-1 bg-[#F8F9FB]">
        <aside className="flex w-[224px] shrink-0 flex-col bg-[#F8F9FB] px-4 py-4">
          <RuntimeSkeletonBlock className="h-9 w-32 rounded-xl" />
          <div className="mt-5 space-y-3">
            {Array.from({ length: 7 }).map((_, index) => (
              <RuntimeSkeletonBlock key={index} className="h-11 w-full" />
            ))}
          </div>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
          <div className="flex h-14 shrink-0 items-center justify-between px-6">
            <RuntimeSkeletonBlock className="h-8 w-40 rounded-xl" />
            <div className="flex items-center gap-2">
              <RuntimeSkeletonBlock className="h-7 w-24 rounded-full" />
              <RuntimeSkeletonBlock className="h-7 w-20 rounded-full" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto bg-white">
            <div className="mx-auto max-w-5xl space-y-6 p-6">
              <RuntimeSkeletonBlock className="h-36 w-full" />
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <RuntimeSkeletonBlock className="h-48 w-full" />
                <RuntimeSkeletonBlock className="h-48 w-full" />
              </div>
              <RuntimeSkeletonBlock className="h-64 w-full" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  const runtimeStatus = model.runtimeStatus || state.local.status;
  const activePage = model.activePage;
  const pageMeta = RUNTIME_PAGE_META[activePage] || RUNTIME_PAGE_META.overview;

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 bg-[#F8F9FB]">
      <aside
        className="app-scroll-shell relative flex shrink-0 flex-col overflow-y-auto bg-[#F8F9FB]"
        style={{ width: `${sidebarWidth}px` }}
      >
        <div className="flex h-14 shrink-0 items-center px-5">
          <h1 className={`${APP_PAGE_TITLE_CLASS} text-[22px]`}>{t('runtimeConfig.panel.title', { defaultValue: 'AI Runtime' })}</h1>
        </div>
        <RuntimeSidebar
          activePage={activePage}
          onSelectPage={model.onChangePage}
          installedModelCount={installedModelCount}
          activeModelCount={activeModelCount}
          connectorCount={state.connectors.length}
          healthyConnectorCount={healthyConnectorCount}
          modCount={model.runtimeProfileTargets.length}
          daemonRunning={daemonRunning}
        />
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('runtimeConfig.panel.resizeSidebar', { defaultValue: 'Resize runtime sidebar' })}
          onMouseDown={startResize}
          className="absolute inset-y-0 right-0 z-10 w-2 translate-x-1/2 cursor-col-resize bg-transparent"
        />
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
        <div className="flex h-14 shrink-0 items-center bg-white px-6">
          <div className="flex w-full items-center justify-between">
            <h2 className={`${APP_PAGE_TITLE_CLASS} text-[22px]`}>{pageMeta.name}</h2>
            <div className="flex items-center gap-2">
              <DaemonStatusBadge running={daemonRunning} />
              <StatusBadge status={runtimeStatus} />
            </div>
          </div>
        </div>

        <div className="app-scroll-shell flex-1 overflow-y-auto bg-white">
          {activePage === 'local' ? (
            <LocalPage model={model} state={state} />
          ) : (
            <div className="mx-auto max-w-5xl p-6 space-y-6">
              {activePage === 'overview' && (
                <OverviewPage model={model} state={state} />
              )}
              {activePage === 'cloud' && (
                <CloudPage model={model} state={state} />
              )}
              {activePage === 'catalog' && (
                <CatalogPage state={state} />
              )}
              {activePage === 'runtime' && (
                <RuntimePage model={model} state={state} />
              )}
              {activePage === 'mods' && (
                <ModsPage model={model} state={state} />
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
