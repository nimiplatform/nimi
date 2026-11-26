import { Tooltip } from '@nimiplatform/kit/ui';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDesktopReducedMotion } from '../../ui/motion/desktop-motion.js';
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
  const titleId = useId();
  const reducedMotion = useDesktopReducedMotion();
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const notificationControls = useHomeExecutionNotificationControls();
  const isPaused = notificationControls.pausedUntil > 0;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          key="home-messages-side-sheet"
          role="complementary"
          aria-labelledby={titleId}
          data-testid="home-messages-drawer"
          initial={reducedMotion ? { opacity: 0 } : { x: '100%', opacity: 0 }}
          animate={reducedMotion ? { opacity: 1 } : { x: 0, opacity: 1 }}
          exit={reducedMotion ? { opacity: 0 } : { x: '100%', opacity: 0 }}
          transition={
            reducedMotion
              ? { duration: 0.15 }
              : { type: 'spring', stiffness: 380, damping: 36, mass: 0.9 }
          }
          className="fixed top-[calc(var(--nimi-titlebar-area-height,env(titlebar-area-height,0px))+0.5rem)] right-2.5 bottom-2.5 z-[var(--nimi-z-dialog)] flex w-[min(408px,calc(100vw-1.25rem))] flex-col overflow-hidden rounded-3xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-home-drawer-bg)] shadow-[var(--nimi-elevation-floating)]"
        >
          <div className="flex items-center justify-between gap-2 px-5 pt-5 pb-3">
            <h2
              id={titleId}
              className="text-base font-semibold tracking-tight text-[var(--nimi-text-primary)]"
            >
              {t('runtimeConfig.overview.messages.sectionItems')}
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-expanded={preferencesOpen}
                onClick={() => setPreferencesOpen((current) => !current)}
                data-testid="home-messages-drawer-preferences-toggle"
                className="rounded-xl bg-[var(--nimi-home-soft-well)] px-2.5 py-1 text-xs font-medium text-[var(--nimi-text-secondary)] transition-[transform,background-color,color] duration-150 hover:bg-[var(--nimi-home-soft-well-hover)] hover:text-[var(--nimi-text-primary)] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
              >
                {t('runtimeConfig.overview.messages.quickPreferences')}
              </button>
              <Tooltip content={t('Common.close', { defaultValue: 'Close' })} placement="bottom">
                <button
                  type="button"
                  aria-label={t('Common.close', { defaultValue: 'Close' })}
                  onClick={onClose}
                  data-testid="home-messages-drawer-close"
                  className="flex size-7 items-center justify-center rounded-full bg-[var(--nimi-home-soft-well)] text-[var(--nimi-text-secondary)] transition-[transform,background-color,color] duration-150 hover:bg-[var(--nimi-home-soft-well-hover)] hover:text-[var(--nimi-text-primary)] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </Tooltip>
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
                    className="rounded-xl bg-[var(--nimi-home-porcelain-card)] px-2.5 py-1 font-medium text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)] transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
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
              className="transition-[transform,color] duration-150 hover:text-[var(--nimi-text-primary)] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
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
              className="font-medium text-[var(--nimi-text-primary)] transition-[transform,color] duration-150 hover:text-[var(--nimi-action-primary-bg)] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
            >
              {t('runtimeConfig.overview.messages.viewAll')} →
            </button>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
