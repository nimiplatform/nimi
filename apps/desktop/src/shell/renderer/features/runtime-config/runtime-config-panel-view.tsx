import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
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
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { RUNTIME_PAGE_META } from './runtime-config-meta-v11';
import { RUNTIME_SIDEBAR_ITEMS } from './runtime-config-sidebar';
import { RuntimeHealthBadge } from './runtime-config-primitives';
import { OverviewPage } from './runtime-config-page-overview';
import { CloudPage } from './runtime-config-page-cloud';
import { ModelsPage } from './runtime-config-page-models';
import { EnvironmentPage } from './runtime-config-page-environment';
import { AdvancedPage } from './runtime-config-page-advanced';
import { ProfileCatalogPage } from './runtime-config-page-profiles';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { useRuntimeConfigPanelController } from './runtime-config-panel-controller';
import { InlineFeedback } from '@renderer/ui/feedback/inline-feedback';

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
  const resizingRef = useRef(false);

  const daemonRunning = model.runtimeDaemonStatus?.running === true;

  const dragCleanupRef = useRef<(() => void) | null>(null);

  // Unmount safety: if the component tears down mid-drag, remove stale listeners.
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  const startResize = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const cleanup = () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      dragCleanupRef.current = null;
    };

    const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
      if (!resizingRef.current || !containerRef.current) {
        return;
      }
      const rect = containerRef.current.getBoundingClientRect();
      const nextWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, Math.round(moveEvent.clientX - rect.left)),
      );
      setSidebarWidth(nextWidth);
    };

    const onMouseUp = () => {
      cleanup();
    };

    dragCleanupRef.current = cleanup;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  if (!state) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-3 pb-3 pt-2 xl:flex-row">
        <aside className="flex max-h-[min(44vh,360px)] w-full shrink-0 flex-col bg-white px-3 py-2 xl:max-h-none xl:w-[216px]">
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
          className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden rounded-xl border-white/60 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
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
          onMouseDown={startResize}
          className="hidden xl:block"
        />
      </SidebarShell>

      <Surface
        as="main"
        tone="panel"
        material="glass-regular"
        padding="none"
        className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden rounded-xl border-white/60 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
      >
        <div className="flex h-12 shrink-0 items-center px-4">
          <div className="flex w-full items-center justify-between">
            <h2 className="text-xl font-semibold leading-7 text-[color:var(--nimi-text-primary)]">{pageTitle}</h2>
            <div className="flex items-center gap-2">
              {(model.discovering || model.checkingHealth) && (
                <span className="flex items-center gap-1.5 text-xs text-[var(--nimi-text-muted)]">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--nimi-border-strong)] border-t-transparent" />
                  {model.discovering
                    ? t('runtimeConfig.panel.discovering', { defaultValue: 'Discovering...' })
                    : t('runtimeConfig.panel.checkingHealth', { defaultValue: 'Checking...' })}
                </span>
              )}
              <RuntimeHealthBadge daemonRunning={daemonRunning} providerStatus={runtimeStatus} />
            </div>
          </div>
        </div>

        <ScrollArea className="min-w-0 flex-1" viewportClassName="bg-transparent [&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full [&>div]:!max-w-full" contentClassName="min-w-0 w-full max-w-full overflow-x-hidden">
          {model.pageFeedback ? (
            <div className="mx-auto min-w-0 w-full max-w-5xl px-4 pt-3">
              <InlineFeedback
                feedback={model.pageFeedback}
                title={t('runtimeConfig.panel.statusTitle', { defaultValue: 'Runtime status' })}
                onDismiss={() => model.setPageFeedback(null)}
              />
            </div>
          ) : null}
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
          {activePage === 'models' && (
            <div data-testid={E2E_IDS.runtimePageRoot('models')} className="flex min-h-0 min-w-0 flex-1 flex-col">
              <ModelsPage model={model} state={state} />
            </div>
          )}
          {activePage === 'cloud' && (
            <div data-testid={E2E_IDS.runtimePageRoot('cloud')} className="min-w-0">
              <CloudPage model={model} state={state} />
            </div>
          )}
          {activePage === 'environment' && (
            <div data-testid={E2E_IDS.runtimePageRoot('environment')} className="flex min-h-0 min-w-0 flex-1 flex-col">
              <EnvironmentPage model={model} state={state} />
            </div>
          )}
          {activePage === 'advanced' && (
            <div data-testid={E2E_IDS.runtimePageRoot('advanced')} className="flex min-h-0 min-w-0 flex-1 flex-col">
              <AdvancedPage />
            </div>
          )}
        </ScrollArea>
      </Surface>
    </div>
  );
}
