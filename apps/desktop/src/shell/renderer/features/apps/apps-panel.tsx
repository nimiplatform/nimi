import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog, ScrollArea, Surface } from '@nimiplatform/kit/ui';
import { useAppsPanelController } from './apps-panel-controller.js';
import { AppsAIProfileSection } from './apps-ai-profile-section.js';
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
  const controller = useAppsPanelController({
    requestSignIn: () => {
      navigate('/login', { replace: false });
    },
  });
  const {
    projection,
    detailAppId,
    pendingConfirm,
    actionError,
    actionErrorAppId,
    busyAppId,
    runCardAction,
    confirmPending,
    dismissPending,
    closeDetail,
    connectLocalApp,
  } = controller;

  const detailEntry =
    projection?.status === 'loaded' && detailAppId
      ? projection.entries.find((entry) => entry.app.appId === detailAppId) ?? null
      : null;

  return (
    <div data-testid="apps-panel" className="flex min-h-0 flex-1 flex-col">
      <ScrollArea
        className="flex-1"
        viewportClassName="bg-transparent"
        contentClassName="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-5"
      >
        <header>
          <p className="text-xs font-semibold uppercase text-[var(--nimi-text-secondary)]">Nimi</p>
          <h1 className="mt-2 text-3xl font-semibold text-[var(--nimi-text-primary)]">
            {t('Navigation.apps', { defaultValue: 'Apps' })}
          </h1>
        </header>

        <Surface tone="panel" material="glass-regular" padding="none" className="min-h-[220px] p-5 shadow-[0_16px_44px_rgba(15,23,42,0.06)]">
          {projection ? (
            <AppsPanelView
              projection={projection}
              onCardAction={runCardAction}
              onConnectLocalApp={connectLocalApp}
              busyAppId={busyAppId}
              actionError={actionError}
            />
          ) : (
            <LoadingAppsProjection />
          )}
        </Surface>
      </ScrollArea>

      <AppsDetailView
        entry={detailEntry}
        aiProfileSection={detailEntry ? (
          <AppsAIProfileSection
            entry={detailEntry}
            actionError={actionErrorAppId === detailEntry.app.appId ? actionError : null}
          />
        ) : null}
        onCardAction={runCardAction}
        onClose={closeDetail}
      />

      {pendingConfirm ? (
        <ConfirmDialog
          open
          title={t('Apps.confirm.deleteAppData.title')}
          message={t('Apps.confirm.deleteAppData.message', { app: pendingConfirm.displayName })}
          confirmLabel={t('Apps.confirm.deleteAppData.confirm')}
          cancelLabel={t('Apps.action.cancel')}
          confirmTone="danger"
          onConfirm={confirmPending}
          onClose={dismissPending}
        />
      ) : null}
    </div>
  );
}
