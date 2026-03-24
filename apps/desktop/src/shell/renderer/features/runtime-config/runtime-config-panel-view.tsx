import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import { SidebarHeader, SidebarItem, SidebarResizeHandle, SidebarSection, SidebarShell } from '@renderer/components/sidebar.js';
import { APP_PAGE_TITLE_CLASS } from '@renderer/components/typography.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { RUNTIME_PAGE_META } from './runtime-config-meta-v11';
import { ICON_CHEVRON_RIGHT, RUNTIME_SIDEBAR_ITEMS, getRuntimeSidebarBadge } from './runtime-config-sidebar';
import { StatusBadge, DaemonStatusBadge } from './runtime-config-primitives';
import { OverviewPage } from './runtime-config-page-overview';
import { RecommendPage } from './runtime-config-page-recommend';
import { LocalPage } from './runtime-config-page-local';
import { CloudPage } from './runtime-config-page-cloud';
import { CatalogPage } from './runtime-config-page-catalog';
import { RuntimePage } from './runtime-config-page-runtime';
import { ModsPage } from './runtime-config-page-mods';
import { DataManagementPage } from '../settings/settings-data-management-page';
import { PerformancePage } from '../settings/settings-performance-page';
import { DeveloperPage } from '../settings/settings-developer-page';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { useRuntimeConfigPanelController } from './runtime-config-panel-controller';

function RuntimeSkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-white ${className}`} />;
}

const RUNTIME_SECTION_LABEL_KEY: Record<(typeof RUNTIME_SIDEBAR_ITEMS)[number]['section'], string> = {
  Core: 'runtimeConfig.sidebar.section.core',
  Connectors: 'runtimeConfig.sidebar.section.connectors',
  Operations: 'runtimeConfig.sidebar.section.operations',
  System: 'runtimeConfig.sidebar.section.system',
};

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
      <div className="nimi-surface--canvas flex min-h-0 flex-1">
        <aside className="nimi-surface--canvas flex w-[224px] shrink-0 flex-col px-4 py-4">
          <RuntimeSkeletonBlock className="h-9 w-32 rounded-xl" />
          <div className="mt-5 space-y-3">
            {Array.from({ length: 8 }).map((_, index) => (
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
          <ScrollShell className="flex-1 bg-white" viewportClassName="bg-white" contentClassName="mx-auto max-w-5xl space-y-6 p-6">
            <RuntimeSkeletonBlock className="h-36 w-full" />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <RuntimeSkeletonBlock className="h-48 w-full" />
              <RuntimeSkeletonBlock className="h-48 w-full" />
            </div>
            <RuntimeSkeletonBlock className="h-64 w-full" />
          </ScrollShell>
        </main>
      </div>
    );
  }

  const runtimeStatus = model.runtimeStatus || state.local.status;
  const activePage = model.activePage;
  const pageMeta = RUNTIME_PAGE_META[activePage] || RUNTIME_PAGE_META.overview;
  const sidebarSections = RUNTIME_SIDEBAR_ITEMS.reduce<Record<string, typeof RUNTIME_SIDEBAR_ITEMS>>((acc, item) => {
    if (!acc[item.section]) {
      acc[item.section] = [];
    }
    acc[item.section]?.push(item);
    return acc;
  }, {});

  return (
    <div ref={containerRef} className="nimi-surface--canvas flex min-h-0 flex-1">
      <SidebarShell
        width={sidebarWidth}
        data-testid={E2E_IDS.panel('runtime-sidebar')}
      >
        <SidebarHeader title={<h1 className={`${APP_PAGE_TITLE_CLASS} text-[22px]`}>{t('runtimeConfig.panel.title', { defaultValue: 'AI Runtime' })}</h1>} className="px-5" />
        <ScrollShell className="flex-1" contentClassName="px-3 pb-3 pt-2">
          <div className="space-y-5">
            {Object.entries(sidebarSections).map(([section, items]) => (
              <SidebarSection
                key={section}
                label={t(RUNTIME_SECTION_LABEL_KEY[section as keyof typeof RUNTIME_SECTION_LABEL_KEY], { defaultValue: section })}
              >
                {items.map((item) => {
                  const active = item.id === activePage;
                  const badge = getRuntimeSidebarBadge(item, {
                    activePage,
                    installedModelCount,
                    activeModelCount,
                    connectorCount: state.connectors.length,
                    healthyConnectorCount,
                    modCount: model.runtimeProfileTargets.length,
                    daemonRunning,
                  });
                  return (
                    <SidebarItem
                      key={`sidebar-${item.id}`}
                      kind="nav-row"
                      data-testid={E2E_IDS.runtimeSidebarPage(item.id)}
                      active={active}
                      onClick={() => model.onChangePage(item.id)}
                      label={t(`runtimeConfig.sidebar.${item.id}`, { defaultValue: item.label })}
                      icon={<span className={active ? 'text-mint-600' : 'text-gray-400'}>{item.icon}</span>}
                      trailing={(
                        <div className="ml-1 flex items-center gap-2">
                          {item.id === 'runtime' ? (
                            <span className="nimi-sidebar-affordance nimi-sidebar-affordance--status-dot">
                              <span className={daemonRunning ? 'bg-mint-500' : 'bg-red-400'} />
                            </span>
                          ) : null}
                          {badge ? (
                            <span className="nimi-sidebar-affordance nimi-sidebar-affordance--badge">{badge}</span>
                          ) : null}
                          {active ? <span className="nimi-sidebar-affordance nimi-sidebar-affordance--chevron">{ICON_CHEVRON_RIGHT}</span> : null}
                        </div>
                      )}
                    />
                  );
                })}
              </SidebarSection>
            ))}
          </div>
        </ScrollShell>
        <SidebarResizeHandle
          ariaLabel={t('runtimeConfig.panel.resizeSidebar', { defaultValue: 'Resize runtime sidebar' })}
          onMouseDown={startResize}
        />
      </SidebarShell>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
        <div className="flex h-14 shrink-0 items-center bg-white px-6">
          <div className="flex w-full items-center justify-between">
            <h2 className={`${APP_PAGE_TITLE_CLASS} text-[22px]`}>{pageMeta.name}</h2>
            <div className="flex items-center gap-2">
              {(model.discovering || model.checkingHealth) && (
                <span className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-transparent" />
                  {model.discovering
                    ? t('runtimeConfig.panel.discovering', { defaultValue: 'Discovering...' })
                    : t('runtimeConfig.panel.checkingHealth', { defaultValue: 'Checking...' })}
                </span>
              )}
              <DaemonStatusBadge running={daemonRunning} />
              <StatusBadge status={runtimeStatus} />
            </div>
          </div>
        </div>

        <ScrollShell className="flex-1 bg-white" viewportClassName="bg-white">
          {activePage === 'local' ? (
            <div data-testid={E2E_IDS.runtimePageRoot('local')}>
              <LocalPage model={model} state={state} />
            </div>
          ) : activePage === 'data-management' ? (
            <div data-testid={E2E_IDS.runtimePageRoot('data-management')}>
              <DataManagementPage />
            </div>
          ) : activePage === 'performance' ? (
            <div data-testid={E2E_IDS.runtimePageRoot('performance')}>
              <PerformancePage />
            </div>
          ) : activePage === 'mod-developer' ? (
            <div data-testid={E2E_IDS.runtimePageRoot('mod-developer')}>
              <DeveloperPage />
            </div>
          ) : (
            <div className="mx-auto max-w-5xl p-6 space-y-6">
              {activePage === 'overview' && (
                <div data-testid={E2E_IDS.runtimePageRoot('overview')}>
                  <OverviewPage model={model} state={state} />
                </div>
              )}
              {activePage === 'recommend' && (
                <div data-testid={E2E_IDS.runtimePageRoot('recommend')}>
                  <RecommendPage model={model} state={state} />
                </div>
              )}
              {activePage === 'cloud' && (
                <div data-testid={E2E_IDS.runtimePageRoot('cloud')}>
                  <CloudPage model={model} state={state} />
                </div>
              )}
              {activePage === 'catalog' && (
                <div data-testid={E2E_IDS.runtimePageRoot('catalog')}>
                  <CatalogPage state={state} />
                </div>
              )}
              {activePage === 'runtime' && (
                <div data-testid={E2E_IDS.runtimePageRoot('runtime')}>
                  <RuntimePage model={model} state={state} />
                </div>
              )}
              {activePage === 'mods' && (
                <div data-testid={E2E_IDS.runtimePageRoot('mods')}>
                  <ModsPage model={model} state={state} />
                </div>
              )}
            </div>
          )}
        </ScrollShell>
      </main>
    </div>
  );
}
