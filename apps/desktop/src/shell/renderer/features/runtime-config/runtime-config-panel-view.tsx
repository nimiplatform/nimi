// @nimi-authority: rule.nimi.desktop.shell-ui.r023

import { lazy, Suspense, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ConfirmDialog,
  NimiTabs,
  ScrollArea,
  Surface,
} from '@nimiplatform/kit/ui';
import { E2E_IDS } from '../../testability/e2e-ids';
import { RUNTIME_NAV_DESTINATIONS } from './runtime-config-nav';
import { RuntimeHealthBadge } from './runtime-config-primitives';
import { resetRuntimePageViewport } from './runtime-config-page-shell';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { useRuntimeConfigPanelController } from './runtime-config-panel-controller';

const AiSettingsPage = lazy(async () => ({
  default: (await import('./runtime-config-page-ai-settings')).AiSettingsPage,
}));
const ModelLibraryPage = lazy(async () => ({
  default: (await import('./runtime-config-page-model-library')).ModelLibraryPage,
}));
// Hoisted so the panel can warm the model-library discover chunk before first open.
const importDiscoverChunk = () => import('./runtime-config-page-recommend');
const CloudServicesPage = lazy(async () => ({
  default: (await import('./runtime-config-page-cloud')).CloudServicesPage,
}));
const AdvancedDiagnosticsPage = lazy(async () => ({
  default: (await import('./runtime-config-page-advanced-diagnostics')).AdvancedDiagnosticsPage,
}));

function RuntimeSkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)] ${className}`} />;
}

export function RuntimeConfigPanelBody() {
  const model = useRuntimeConfigPanelController();
  return <RuntimeConfigPanelView model={model} />;
}

export function RuntimeConfigPanelView(props: { model: RuntimeConfigPanelControllerModel }) {
  const { t } = useTranslation();
  const { model } = props;
  const { state } = model;
  const pageViewportRef = useRef<HTMLDivElement>(null);

  const daemonRunning = model.runtimeDaemonStatus?.running === true;
  const activePage = model.activePage;

  useEffect(() => {
    resetRuntimePageViewport(pageViewportRef.current);
  }, [activePage]);

  // Warm only the discover chunk. Data ownership and source status stay with
  // the page's scoped Runtime queries.
  useEffect(() => {
    void importDiscoverChunk();
  }, []);

  if (!state) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col px-3 pb-3 pt-2">
        <Surface
          as="main"
          tone="panel"
          material="glass-regular"
          padding="none"
          className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden rounded-xl border-[var(--nimi-border-subtle)] shadow-[var(--nimi-elevation-base)]"
        >
          <div className="flex min-h-[var(--nimi-sidebar-header-height)] shrink-0 items-center justify-between gap-2 px-4">
            <RuntimeSkeletonBlock className="h-7 w-32 rounded-xl" />
            <RuntimeSkeletonBlock className="h-6 w-24 rounded-xl" />
          </div>
          <div className="px-4 pb-2">
            <RuntimeSkeletonBlock className="h-9 w-full max-w-xl rounded-xl" />
          </div>
          <div className="mx-auto min-w-0 w-full max-w-5xl space-y-4 px-4 pb-4 pt-6">
            <RuntimeSkeletonBlock className="h-32 w-full" />
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <RuntimeSkeletonBlock className="h-44 w-full" />
              <RuntimeSkeletonBlock className="h-44 w-full" />
            </div>
          </div>
        </Surface>
      </div>
    );
  }

  const runtimeStatus = model.runtimeStatus || state.local.status;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col px-3 pb-3 pt-2">
      <Surface
        as="main"
        tone="panel"
        material="glass-regular"
        padding="none"
        className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden rounded-xl border-[var(--nimi-border-subtle)] shadow-[var(--nimi-elevation-base)]"
      >
        <div className="flex min-h-[var(--nimi-sidebar-header-height)] shrink-0 items-center justify-between gap-2 px-4">
          <h1 className="text-xl font-semibold leading-7 text-[color:var(--nimi-text-primary)]">{t('runtimeConfig.panel.title', { defaultValue: 'Runtime' })}</h1>
          <div className="flex items-center gap-2" data-testid={E2E_IDS.panel('runtime-health')}>
            <RuntimeHealthBadge daemonRunning={daemonRunning} status={runtimeStatus} />
            {model.checkingHealth && (
              <span className="flex items-center gap-1.5 text-xs text-[var(--nimi-text-muted)]">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--nimi-border-strong)] border-t-transparent" />
                {t('runtimeConfig.panel.checkingHealth', { defaultValue: 'Checking Runtime...' })}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 overflow-x-auto px-2">
          <NimiTabs
            ariaLabel={t('runtimeConfig.panel.navLabel', { defaultValue: 'Runtime destinations' })}
            value={activePage}
            onValueChange={(value) => model.onChangePage(value as typeof activePage)}
            items={RUNTIME_NAV_DESTINATIONS.map((destination) => ({
              value: destination.id,
              label: t(destination.labelKey, { defaultValue: destination.label }),
            }))}
          />
        </div>
        <ScrollArea viewportRef={pageViewportRef} className="min-w-0 flex-1" viewportClassName="bg-transparent [&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full [&>div]:!max-w-full" contentClassName="min-w-0 w-full max-w-full overflow-x-hidden pt-6">
          <Suspense fallback={<div className="p-4"><RuntimeSkeletonBlock className="h-64 w-full" /></div>}>
            {activePage === 'aiSettings' && (
              <div data-testid={E2E_IDS.runtimePageRoot('aiSettings')} className="min-w-0">
                <AiSettingsPage
                  runtimeWritesDisabled={model.runtimeWritesDisabled}
                  focusedTaskId={model.setupTaskFocus?.taskId ?? null}
                  actionFocus={state.actionFocus}
                  savedConfigsContext={model.loadoutNavigationContext}
                  profileUseOwner={model.profileUseOwner}
                  onOpenSetupTask={model.onOpenSetupTask}
                  onCloseSetupTask={model.onCloseSetupTask}
                  onOpenSavedConfigs={model.onOpenSavedConfigs}
                  onOpenModelMarket={model.onOpenModelMarket}
                  onOpenAdvancedDiagnostics={() => model.onChangePage('advancedDiagnostics')}
                  onOpenCloudServices={() => model.onChangePage('cloudServices')}
                  onClearActionFocus={() => model.updateState((prev) => (prev.actionFocus ? { ...prev, actionFocus: null } : prev))}
                  onCloseProfileUseOwner={model.onCloseProfileUseOwner}
                  onCloseSavedConfigs={model.onCloseSavedConfigs}
                />
              </div>
            )}
            {activePage === 'modelLibrary' && (
              <div data-testid={E2E_IDS.runtimePageRoot('modelLibrary')} className="min-w-0">
                <ModelLibraryPage
                  model={model}
                  onClearActionFocus={() => model.updateState((prev) => (prev.actionFocus ? { ...prev, actionFocus: null } : prev))}
                />
              </div>
            )}
            {activePage === 'cloudServices' && (
              <div data-testid={E2E_IDS.runtimePageRoot('cloudServices')} className="min-w-0">
                <CloudServicesPage model={model} state={state} />
              </div>
            )}
            {activePage === 'advancedDiagnostics' && (
              <div data-testid={E2E_IDS.runtimePageRoot('advancedDiagnostics')} className="flex min-h-0 min-w-0 flex-1 flex-col">
                <AdvancedDiagnosticsPage model={model} />
              </div>
            )}
          </Suspense>
        </ScrollArea>
      </Surface>

      <ConfirmDialog
        open={model.installConfirmation !== null}
        title={t('runtimeConfig.local.confirmInstallTitle', { defaultValue: 'Install model' })}
        message={<span className="whitespace-pre-wrap">{model.installConfirmation?.message ?? ''}</span>}
        confirmLabel={t('runtimeConfig.local.confirmInstallConfirm', { defaultValue: 'Install' })}
        cancelLabel={t('runtimeConfig.local.confirmInstallCancel', { defaultValue: 'Cancel' })}
        confirmTone="primary"
        onConfirm={() => model.resolveInstallConfirmation(true)}
        onClose={() => model.resolveInstallConfirmation(false)}
      />
    </div>
  );
}
