import { useEffect, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea, Surface } from '@nimiplatform/kit/ui';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import { useAppsPanelController } from './apps-panel-controller.js';
import { AppsDetailView } from './apps-detail-view.js';
import { AppsPanelView } from './apps-panel-view.js';

function LoadingAppsProjection(): ReactElement {
  const { t } = useTranslation();
  return (
    <section data-testid="apps-panel-loading" className="flex min-h-32 animate-pulse items-center justify-center rounded-lg border border-dashed border-[color:var(--nimi-border-subtle)] text-sm text-[var(--nimi-text-secondary)]">
      {t('Apps.loading')}
    </section>
  );
}

export function AppsPanel(): ReactElement {
  const { t } = useTranslation();
  const settings = useDesktopRendererCommands().settings;
  const requestedDetailAppId = useAppStore((state) => state.appsDetailAppId);
  const setAppsDetailAppId = useAppStore((state) => state.setAppsDetailAppId);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const controller = useAppsPanelController();
  const {
    projection,
    detailAppId,
    actionError,
    runCardAction,
    retryProjection,
    closeDetail,
  } = controller;

  useEffect(() => {
    if (requestedDetailAppId) {
      runCardAction(requestedDetailAppId, 'details');
    }
  }, [requestedDetailAppId, runCardAction]);

  const detailEntry =
    projection?.status === 'loaded' && detailAppId
      ? projection.entries.find((entry) => entry.registration.appId === detailAppId) ?? null
      : null;

  return (
    <div data-testid="apps-panel" className="flex min-h-0 flex-1 flex-col">
      <ScrollArea
        className="flex-1"
        viewportClassName="bg-transparent"
        contentClassName="mx-auto flex w-full max-w-6xl flex-col gap-5 px-5 py-5"
      >
        <header>
          <h1 className="text-2xl font-semibold text-[var(--nimi-text-primary)]">
            {t('Navigation.apps', { defaultValue: 'Apps' })}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--nimi-text-secondary)]">
            {t('Apps.description')}
          </p>
        </header>

        <Surface tone="panel" material="glass-regular" padding="none" className="min-h-[220px] p-5 shadow-[0_16px_44px_rgba(15,23,42,0.06)]">
          {projection ? (
            <AppsPanelView
              projection={projection}
              onCardAction={runCardAction}
              onOpenDeveloperMode={() => {
                settings.openSection('performance');
                setActiveTab('settings');
              }}
              onRetry={retryProjection}
              actionError={actionError}
            />
          ) : (
            <LoadingAppsProjection />
          )}
        </Surface>
      </ScrollArea>

      <AppsDetailView
        entry={detailEntry}
        onCardAction={runCardAction}
        onClose={() => {
          setAppsDetailAppId(null);
          closeDetail();
        }}
      />
    </div>
  );
}
