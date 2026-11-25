import { DialogTitle, OverlayShell } from '@nimiplatform/kit/ui';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useHomeExecutionNotificationControls,
  type ExecutionNoticeAppArtworkResolver,
} from './execution-notices.js';
import type { HomeMessageCardContext } from './home-message-card.js';
import { HomeMessagesColumn } from './home-messages-column.js';
import type { HomeMessages } from './home-messages-controller.js';
import type { HomeTimelineQuickFilter } from './home-messages-model.js';

export type HomeMessagesDrawerProps = {
  open: boolean;
  initialFilter?: HomeTimelineQuickFilter;
  messages: HomeMessages | null;
  context: HomeMessageCardContext | null;
  appArtworkForNotice?: ExecutionNoticeAppArtworkResolver;
  onClose: () => void;
  onViewAll: () => void;
  onOpenSettings: () => void;
  onOpenPermissions: () => void;
};

// @nimi-authority: rule.nimi.desktop.product-surfaces.r015
// @nimi-authority: rule.nimi.desktop.product-surfaces.r036
export function HomeMessagesDrawer({
  open,
  initialFilter = 'all',
  messages,
  context,
  appArtworkForNotice,
  onClose,
  onViewAll,
  onOpenSettings,
  onOpenPermissions,
}: HomeMessagesDrawerProps) {
  const { t } = useTranslation();
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const notificationControls = useHomeExecutionNotificationControls();
  const isPaused = notificationControls.pausedUntil > 0;

  return (
    <OverlayShell
      open={open}
      kind="drawer"
      onClose={onClose}
      dataTestId="home-messages-drawer"
      panelClassName="top-11 right-2.5 bottom-2.5 flex h-auto max-w-[408px] flex-col overflow-hidden rounded-3xl border-transparent! bg-[var(--nimi-home-drawer-bg)]! shadow-[var(--nimi-home-drawer-shadow)]!"
      contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
    >
      <div className="flex items-center justify-between gap-2 px-5 pt-5 pb-3">
        <DialogTitle className="text-base font-semibold tracking-tight text-[var(--nimi-text-primary)]">
          {t('runtimeConfig.overview.messages.sectionItems')}
        </DialogTitle>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-expanded={preferencesOpen}
            onClick={() => setPreferencesOpen((current) => !current)}
            data-testid="home-messages-drawer-preferences-toggle"
            className="rounded-xl bg-[var(--nimi-home-soft-well)] px-2.5 py-1 text-xs font-medium text-[var(--nimi-text-secondary)] transition-colors hover:bg-[var(--nimi-home-soft-well-hover)] hover:text-[var(--nimi-text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
          >
            {t('runtimeConfig.overview.messages.quickPreferences')}
          </button>
          <button
            type="button"
            aria-label={t('Common.close', { defaultValue: 'Close' })}
            onClick={onClose}
            data-testid="home-messages-drawer-close"
            className="flex size-7 items-center justify-center rounded-full bg-[var(--nimi-home-soft-well)] text-[var(--nimi-text-secondary)] transition-colors hover:bg-[var(--nimi-home-soft-well-hover)] hover:text-[var(--nimi-text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      {preferencesOpen ? (
        <div
          className="mx-5 mb-3 flex flex-col gap-2.5 rounded-2xl bg-[var(--nimi-home-soft-well)] p-3.5 text-xs"
          data-testid="home-messages-drawer-preferences"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.overview.messages.settings')}
            </span>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenSettings();
              }}
              className="font-medium text-[var(--nimi-action-primary-bg)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
            >
              {t('runtimeConfig.overview.messages.view')} →
            </button>
          </div>

          {notificationControls.enabled ? (
            <div className="flex items-center justify-between gap-2 text-[var(--nimi-text-secondary)]">
              <span>{t('runtimeConfig.overview.messages.desktopAlertsLabel')}</span>
              <button
                type="button"
                onClick={() => {
                  void (isPaused ? notificationControls.resume() : notificationControls.pause()).catch(() => undefined);
                }}
                className="rounded-xl bg-[var(--nimi-home-porcelain-card)] px-2.5 py-1 font-medium text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
              >
                {t(isPaused ? 'runtimeConfig.overview.messages.resumeAlerts' : 'runtimeConfig.overview.messages.pauseOneHour')}
              </button>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-2 text-[var(--nimi-text-secondary)]">
            <span>{t('runtimeConfig.overview.messages.appPermissionsLabel')}</span>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenPermissions();
              }}
              className="font-medium text-[var(--nimi-action-primary-bg)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
            >
              {t('Integrations.homeManagePermissions')} →
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col px-5 pb-3">
        {messages && context ? (
          <HomeMessagesColumn
            variant="drawer"
            initialFilter={initialFilter}
            messages={messages}
            context={context}
            appArtworkForNotice={appArtworkForNotice}
            onViewAll={() => {
              onClose();
              onViewAll();
            }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-2xl bg-[var(--nimi-home-soft-well)] px-4 py-8 text-center text-xs text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.overview.messages.empty')}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 bg-[var(--nimi-home-soft-well)] px-5 py-3.5 text-xs text-[var(--nimi-text-secondary)]">
        <button
          type="button"
          onClick={() => {
            onClose();
            onOpenPermissions();
          }}
          className="transition-colors hover:text-[var(--nimi-text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
        >
          {t('runtimeConfig.overview.messages.appPermissionsLabel')}
        </button>
        <button
          type="button"
          onClick={() => {
            onClose();
            onViewAll();
          }}
          data-testid="home-messages-drawer-view-all"
          className="font-medium text-[var(--nimi-text-primary)] transition-colors hover:text-[var(--nimi-action-primary-bg)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
        >
          {t('runtimeConfig.overview.messages.viewAll')} →
        </button>
      </div>
    </OverlayShell>
  );
}
