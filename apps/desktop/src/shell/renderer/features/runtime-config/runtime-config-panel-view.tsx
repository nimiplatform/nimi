import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ScrollArea,
  SidebarAffordanceChevron,
  SidebarHeader,
  SidebarItem,
  SidebarResizeHandle,
  SidebarSection,
  SidebarShell,
  Surface,
} from '@nimiplatform/kit/ui';
import { E2E_IDS } from '../../testability/e2e-ids';
import { RUNTIME_PAGE_META } from './runtime-config-meta-v11';
import { RUNTIME_SIDEBAR_ITEMS } from './runtime-config-sidebar';
import { RuntimeHealthBadge } from './runtime-config-primitives';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { useRuntimeConfigPanelController } from './runtime-config-panel-controller';

const OverviewPage = lazy(async () => ({
  default: (await import('./runtime-config-page-overview')).OverviewPage,
}));
const CloudPage = lazy(async () => ({
  default: (await import('./runtime-config-page-cloud')).CloudPage,
}));
const RecommendPage = lazy(async () => ({
  default: (await import('./runtime-config-page-recommend')).RecommendPage,
}));
const LocalPage = lazy(async () => ({
  default: (await import('./runtime-config-page-local')).LocalPage,
}));
const CatalogPage = lazy(async () => ({
  default: (await import('./runtime-config-page-catalog')).CatalogPage,
}));
const LoadoutsPage = lazy(async () => ({
  default: (await import('./runtime-config-page-loadouts.js')).LoadoutsPage,
}));
const EnvironmentPage = lazy(async () => ({
  default: (await import('./runtime-config-page-environment')).EnvironmentPage,
}));
const ProfileCatalogPage = lazy(async () => ({
  default: (await import('./runtime-config-page-profiles')).ProfileCatalogPage,
}));

function RuntimeSkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)] ${className}`} />;
}

const RUNTIME_SECTION_LABEL_KEY: Record<(typeof RUNTIME_SIDEBAR_ITEMS)[number]['section'], string> = {
  Runtime: 'runtimeConfig.sidebar.section.runtime',
};

export function RuntimeConfigPanelBody() {
  const model = useRuntimeConfigPanelController();
  return <RuntimeConfigPanelView model={model} />;
}

export function RuntimeConfigPanelView(props: { model: RuntimeConfigPanelControllerModel }) {
  const { t } = useTranslation();
  const MIN_SIDEBAR_WIDTH = 192;
  const MAX_SIDEBAR_WIDTH = 340;
  const { model } = props;
  const { state } = model;
  const [sidebarWidth, setSidebarWidth] = useState(216);
  const containerRef = useRef<HTMLDivElement>(null);
  const resizePointerIdRef = useRef<number | null>(null);

  const daemonRunning = model.runtimeDaemonStatus?.running === true;

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const continueResize = (event: PointerEvent<HTMLDivElement>) => {
    if (resizePointerIdRef.current !== event.pointerId || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setSidebarWidth(Math.min(
      MAX_SIDEBAR_WIDTH,
      Math.max(MIN_SIDEBAR_WIDTH, Math.round(event.clientX - rect.left)),
    ));
  };

  const stopResize = (event: PointerEvent<HTMLDivElement>) => {
    if (resizePointerIdRef.current !== event.pointerId) return;
    resizePointerIdRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  // Models action focuses only select their target page now that the former
  // Models sub-tabs are first-level pages; clear them once navigation applied.
  // The cloud focus is consumed and cleared by CloudPage itself.
  const actionFocus = state?.actionFocus;
  const { updateState } = model;
  useEffect(() => {
    if (
      actionFocus?.focus !== 'runtime-config-action-focus.models-catalog-install'
      && actionFocus?.focus !== 'runtime-config-action-focus.loadouts'
    ) {
      return;
    }
    updateState((prev) => (prev.actionFocus ? { ...prev, actionFocus: null } : prev));
  }, [updateState, actionFocus]);

  if (!state) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-3 pb-3 pt-2 xl:flex-row">
        <aside className="flex max-h-[min(44vh,360px)] w-full shrink-0 flex-col bg-[var(--nimi-surface-card)] px-3 py-2 xl:max-h-none xl:w-[216px]">
          <RuntimeSkeletonBlock className="h-9 w-32 rounded-xl" />
          <div className="mt-3 space-y-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <RuntimeSkeletonBlock key={index} className="h-9 w-full" />
            ))}
          </div>
        </aside>
        <Surface
          as="main"
          tone="panel"
          material="glass-regular"
          padding="none"
          className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden rounded-xl border-[var(--nimi-border-subtle)] shadow-[var(--nimi-elevation-base)]"
        >
          <div className="flex h-12 shrink-0 items-center justify-between px-4">
            <RuntimeSkeletonBlock className="h-8 w-40 rounded-xl" />
            <div className="flex items-center gap-2">
              <RuntimeSkeletonBlock className="h-7 w-24 rounded-full" />
              <RuntimeSkeletonBlock className="h-7 w-20 rounded-full" />
            </div>
          </div>
          <ScrollArea className="min-w-0 flex-1" viewportClassName="bg-transparent" contentClassName="mx-auto min-w-0 w-full max-w-5xl space-y-4 px-4 py-4">
            <RuntimeSkeletonBlock className="h-32 w-full" />
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <RuntimeSkeletonBlock className="h-44 w-full" />
              <RuntimeSkeletonBlock className="h-44 w-full" />
            </div>
            <RuntimeSkeletonBlock className="h-64 w-full" />
          </ScrollArea>
        </Surface>
      </div>
    );
  }

  const runtimeStatus = model.runtimeStatus || state.local.status;
  const activePage = model.activePage;
  const pageMeta = RUNTIME_PAGE_META[activePage] || RUNTIME_PAGE_META.overview;
  const pageTitle = t(`runtimeConfig.sidebar.${activePage}`, { defaultValue: pageMeta.name });
  const sidebarStyle = { '--runtime-sidebar-width': `${sidebarWidth}px` } as CSSProperties;
  const sidebarSections = RUNTIME_SIDEBAR_ITEMS.reduce<Record<string, typeof RUNTIME_SIDEBAR_ITEMS>>((acc, item) => {
    if (!acc[item.section]) {
      acc[item.section] = [];
    }
    acc[item.section]?.push(item);
    return acc;
  }, {});

  return (
    <div ref={containerRef} className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-3 pb-3 pt-2 xl:flex-row">
      <SidebarShell
        className="max-h-[min(44vh,360px)] w-full xl:max-h-none xl:w-[var(--runtime-sidebar-width)]"
        style={sidebarStyle}
        data-testid={E2E_IDS.panel('runtime-sidebar')}
      >
        <SidebarHeader title={<h1 className="text-xl font-semibold leading-7 text-[color:var(--nimi-text-primary)]">{t('runtimeConfig.panel.title', { defaultValue: 'Runtime' })}</h1>} className="px-4" />
        <ScrollArea className="flex-1" contentClassName="px-2 pb-2 pt-1">
          <div className="space-y-3">
            {Object.entries(sidebarSections).map(([section, items]) => (
              <SidebarSection
                key={section}
                label={t(RUNTIME_SECTION_LABEL_KEY[section as keyof typeof RUNTIME_SECTION_LABEL_KEY], { defaultValue: section })}
              >
                {items.map((item) => {
                  const active = item.id === activePage;
                  return (
                    <SidebarItem
                      key={`sidebar-${item.id}`}
                      kind="nav-row"
                      data-testid={E2E_IDS.runtimeSidebarPage(item.id)}
                      active={active}
                      onClick={() => model.onChangePage(item.id)}
                      className="text-[length:var(--nimi-type-body-sm-size)]"
                      label={t(`runtimeConfig.sidebar.${item.id}`, { defaultValue: item.label })}
                      icon={<span className={active ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-muted)]'}>{item.icon}</span>}
                      trailing={active ? <SidebarAffordanceChevron /> : undefined}
                    />
                  );
                })}
              </SidebarSection>
            ))}
          </div>
        </ScrollArea>
        <SidebarResizeHandle
          ariaLabel={t('runtimeConfig.panel.resizeSidebar', { defaultValue: 'Resize runtime sidebar' })}
          onPointerCancel={stopResize}
          onPointerDown={startResize}
          onPointerMove={continueResize}
          onPointerUp={stopResize}
          className="hidden xl:block"
        />
      </SidebarShell>

      <Surface
        as="main"
        tone="panel"
        material="glass-regular"
        padding="none"
        className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden rounded-xl border-[var(--nimi-border-subtle)] shadow-[var(--nimi-elevation-base)]"
      >
        <div className="flex h-12 shrink-0 items-center px-4">
          <div className="flex w-full items-center justify-between">
            <h2 className="text-xl font-semibold leading-7 text-[color:var(--nimi-text-primary)]">{pageTitle}</h2>
            <div className="flex items-center gap-2">
              {model.checkingHealth && (
                <span className="flex items-center gap-1.5 text-xs text-[var(--nimi-text-muted)]">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--nimi-border-strong)] border-t-transparent" />
                  {t('runtimeConfig.panel.checkingHealth', { defaultValue: 'Checking Runtime...' })}
                </span>
              )}
              <RuntimeHealthBadge daemonRunning={daemonRunning} status={runtimeStatus} />
            </div>
          </div>
        </div>

        <ScrollArea className="min-w-0 flex-1" viewportClassName="bg-transparent [&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full [&>div]:!max-w-full" contentClassName="min-w-0 w-full max-w-full overflow-x-hidden">
          <Suspense fallback={<div className="p-4"><RuntimeSkeletonBlock className="h-64 w-full" /></div>}>
            {activePage === 'overview' && (
              <div data-testid={E2E_IDS.runtimePageRoot('overview')} className="min-w-0">
                <OverviewPage model={model} state={state} />
              </div>
            )}
            {activePage === 'profiles' && (
              <div data-testid={E2E_IDS.runtimePageRoot('profiles')} className="min-w-0">
                <ProfileCatalogPage />
              </div>
            )}
            {activePage === 'modelMarket' && (
              <div data-testid={E2E_IDS.runtimePageRoot('modelMarket')} className="min-w-0">
                <RecommendPage model={model} state={state} />
              </div>
            )}
            {activePage === 'localModels' && (
              <div data-testid={E2E_IDS.runtimePageRoot('localModels')} className="flex min-h-0 min-w-0 flex-1 flex-col">
                <LocalPage model={model} state={state} />
              </div>
            )}
            {activePage === 'loadouts' && (
              <div data-testid={E2E_IDS.runtimePageRoot('loadouts')} className="min-w-0">
                <LoadoutsPage />
              </div>
            )}
            {activePage === 'modelCatalog' && (
              <div data-testid={E2E_IDS.runtimePageRoot('modelCatalog')} className="min-w-0">
                <CatalogPage model={model} state={state} />
              </div>
            )}
            {activePage === 'cloud' && (
              <div data-testid={E2E_IDS.runtimePageRoot('cloud')} className="min-w-0">
                <CloudPage model={model} state={state} />
              </div>
            )}
            {activePage === 'environment' && (
              <div data-testid={E2E_IDS.runtimePageRoot('environment')} className="flex min-h-0 min-w-0 flex-1 flex-col">
                <EnvironmentPage model={model} />
              </div>
            )}
          </Suspense>
        </ScrollArea>
      </Surface>
    </div>
  );
}
