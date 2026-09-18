import { Button, PillTabs } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { FILTER_TABS, type NotificationFilterTab } from './notification-panel-types.js';

type NotificationPanelHeaderProps = {
  activeFilter: NotificationFilterTab;
  markingAllRead: boolean;
  unreadCount: number | null;
  onFilterChange: (filter: NotificationFilterTab) => void;
  onMarkAllRead: () => void;
};

export function NotificationPanelHeader({
  activeFilter,
  markingAllRead,
  unreadCount,
  onFilterChange,
  onMarkAllRead,
}: NotificationPanelHeaderProps) {
  const { t } = useTranslation();
  return (
    <div className="shrink-0 border-b border-[var(--nimi-border-subtle)] px-6 pb-4 pt-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-[var(--nimi-action-primary-bg)]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </span>
          <div className="min-w-0">
            <h1 className="nimi-type-page-title truncate text-[color:var(--nimi-text-primary)]">
              {t('NotificationPanel.title', { defaultValue: 'Notifications' })}
            </h1>
            {unreadCount !== null ? (
              <p className="mt-0.5 text-xs text-[var(--nimi-text-muted)]">
                {unreadCount > 0
                  ? t('NotificationPanel.unreadSummary', { count: unreadCount, defaultValue: '{{count}} unread' })
                  : t('NotificationPanel.allCaughtUp', { defaultValue: "You're all caught up" })}
              </p>
            ) : null}
          </div>
        </div>
        <Button
          tone="ghost"
          size="sm"
          disabled={markingAllRead || unreadCount === null || unreadCount <= 0}
          onClick={onMarkAllRead}
          leadingIcon={(
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        >
          {markingAllRead
            ? t('NotificationPanel.markingAllRead', { defaultValue: 'Marking...' })
            : t('NotificationPanel.markAllRead', { defaultValue: 'Mark All Read' })}
        </Button>
      </div>

      <div className="mt-4">
        <PillTabs
          size="sm"
          ariaLabel={t('NotificationPanel.title', { defaultValue: 'Notifications' })}
          value={activeFilter}
          onValueChange={(value) => onFilterChange(value as NotificationFilterTab)}
          items={FILTER_TABS.map((tab) => ({
            value: tab,
            label: t(`NotificationPanel.filters.${tab}`, {
              defaultValue: tab,
            }),
          }))}
        />
      </div>
    </div>
  );
}
