import { useEffect, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ScrollArea, Surface } from '@nimiplatform/kit/ui';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { dispatchSettingsOpenSection } from '@renderer/features/settings/settings-storage';
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
  const navigate = useNavigate();
  const requestedDetailAppId = useAppStore((state) => state.appsDetailAppId);
  const setAppsDetailAppId = useAppStore((state) => state.setAppsDetailAppId);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const authUser = useAppStore((state) => state.auth.user);
  const accountName = [authUser?.displayName, authUser?.handle, authUser?.username]
    .map((value) => String(value ?? '').trim())
    .find(Boolean) ?? t('Apps.sourceManager.accountFallback');
  const controller = useAppsPanelController({
    requestSignIn: () => {
      navigate('/login', { replace: false });
    },
  });
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
      ? projection.entries.find((entry) => entry.app.appId === detailAppId) ?? null
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
        </header>

        <Surface tone="panel" material="glass-regular" padding="none" className="min-h-[220px] p-5 shadow-[0_16px_44px_rgba(15,23,42,0.06)]">
          {projection ? (
            <AppsPanelView
              projection={projection}
              onCardAction={runCardAction}
              onOpenDeveloperMode={() => {
                dispatchSettingsOpenSection('performance');
                setActiveTab('settings');
              }}
              onManageAccount={() => {
                dispatchSettingsOpenSection('profile');
                setActiveTab('settings');
              }}
              onRetry={retryProjection}
              accountName={accountName}
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
