// @nimi-authority: rule.nimi.desktop.shell-ui.r023

import { Button, ConfirmDialog, ScrollArea, Surface } from '@nimiplatform/kit/ui';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { resetRuntimePageViewport } from './runtime-config-page-shell';
import { useRuntimeConfigPanelController } from './runtime-config-panel-controller';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { RuntimeHealthBadge } from './runtime-config-primitives';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';

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
  const browseContext = activePage === 'modelLibrary' && model.modelMarketContext?.kind === 'browse'
    ? model.modelMarketContext
    : null;

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
      <div className={activePage === 'aiSettings' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <Suspense fallback={<RuntimeSkeletonBlock className="h-64 w-full" />}>
          <AiSettingsPage
            runtimeWritesDisabled={model.runtimeWritesDisabled}
            focusedTaskId={model.setupTaskFocus?.taskId ?? null}
            actionFocus={state.actionFocus}
            savedConfigsContext={model.loadoutNavigationContext}
            profileUseOwner={model.profileUseOwner}
            onOpenSetupTask={model.onOpenSetupTask}
            onCloseSetupTask={model.onCloseSetupTask}
            onOpenSavedConfigs={model.onOpenSavedConfigs}
            onOpenModelFiles={() => model.onChangePage('modelLibrary')}
            onOpenModelImport={model.onOpenModelImport}
            onOpenModelMarket={model.onOpenModelMarket}
            onOpenAdvancedDiagnostics={() => model.onChangePage('advancedDiagnostics')}
            onOpenCloudServices={() => model.onChangePage('cloudServices')}
            onClearActionFocus={() =>
              model.updateState((prev) => (prev.actionFocus ? { ...prev, actionFocus: null } : prev))
            }
            onCloseProfileUseOwner={model.onCloseProfileUseOwner}
            onCloseSavedConfigs={model.onCloseSavedConfigs}
          />
        </Suspense>
      </div>
      {activePage !== 'aiSettings' ? (
        <Surface
          as="main"
          tone="panel"
          material="glass-regular"
          padding="none"
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          {activePage !== 'cloudServices' ? <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3 pb-1">
            <Button tone="ghost" size="sm" className="-ml-1 gap-1 text-[var(--nimi-text-secondary)]" onClick={browseContext ? model.onReturnToContextualLoadout : () => model.onChangePage('aiSettings')} data-testid="runtime-model-library-back">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
              {browseContext
                ? t('runtimeConfig.product.modelPicker.backToCapability', { capability: displayRuntimeConfigCapabilityLabel(browseContext.capabilityContract, t) })
                : t('runtimeConfig.capabilities.backWorkspace')}
            </Button>
            <RuntimeHealthBadge daemonRunning={daemonRunning} status={runtimeStatus} />
          </div> : null}
          <ScrollArea
            viewportRef={pageViewportRef}
            className="min-h-0 min-w-0 flex-1"
            contentClassName="min-w-0 pt-3"
          >
            <Suspense fallback={<RuntimeSkeletonBlock className="h-64 w-full" />}>
              {activePage === 'modelLibrary' ? (
                <ModelLibraryPage
                  model={model}
                  onClearActionFocus={() => model.updateState((prev) => ({ ...prev, actionFocus: null }))}
                />
              ) : null}
              {activePage === 'cloudServices' ? <CloudServicesPage model={model} state={state} /> : null}
              {activePage === 'advancedDiagnostics' ? <AdvancedDiagnosticsPage model={model} /> : null}
            </Suspense>
          </ScrollArea>
        </Surface>
      ) : null}
      <ConfirmDialog
        open={model.installConfirmation !== null}
        title={t('runtimeConfig.local.confirmInstallTitle')}
        message={<span className="whitespace-pre-wrap">{model.installConfirmation?.message ?? ''}</span>}
        confirmLabel={t('runtimeConfig.local.confirmInstallConfirm')}
        cancelLabel={t('runtimeConfig.local.confirmInstallCancel')}
        confirmTone="primary"
        onConfirm={() => model.resolveInstallConfirmation(true)}
        onClose={() => model.resolveInstallConfirmation(false)}
      />
    </div>
  );
}
