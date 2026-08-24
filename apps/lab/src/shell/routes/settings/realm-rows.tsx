import { Button, StatusBadge } from '@nimiplatform/kit/ui';
import {
  getNimiNotificationBadgeKey,
  getNimiNotificationCategory,
} from '@nimiplatform/kit/core/notifications';
import { useTranslation } from '../../i18n/index.js';
import type { SettingsRouteViewProps } from './view.js';

const liveRowClassName = 'flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]';
const liveBadgeClassName = 'mr-2 rounded border border-[var(--nimi-border-subtle)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--nimi-text-muted)]';

export function SettingsRealmRows(props: SettingsRouteViewProps) {
  const { t } = useTranslation();
  const {
    notificationProjection,
    refreshNotificationProjection,
    notificationListProjection,
    refreshNotificationListProjection,
    accountSettingsProjection,
    refreshAccountSettingsProjection,
    humanChatProjection,
    refreshHumanChatProjection,
  } = props;
  const notificationListStatusLabel = (() => {
    if (notificationListProjection.status === 'ready') {
      const firstItem = notificationListProjection.list.items[0];
      if (!firstItem) {
        return t('Settings.notificationListEmpty');
      }
      const itemCount = notificationListProjection.list.items.length;
      const category = getNimiNotificationCategory(firstItem.type);
      const badgeKey = getNimiNotificationBadgeKey(firstItem);
      return t('Settings.notificationListSummary', {
        count: itemCount,
        plural: itemCount === 1 ? '' : 's',
        category,
        badgeKey,
      });
    }
    if (notificationListProjection.status === 'error') {
      return notificationListProjection.error;
    }
    return t('Settings.notLoaded');
  })();

  return (
    <>
      <div data-settings-row-kind="live" className={liveRowClassName}>
        <span><span className={liveBadgeClassName}>{t('Settings.liveBadge')}</span>{t('Settings.rows.notificationProjection')}</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={notificationProjection.status === 'error' ? 'danger' : 'info'}>
            {notificationProjection.status === 'ready'
              ? t('Settings.unreadCount', { count: notificationProjection.unread.total })
              : notificationProjection.status === 'error'
                ? notificationProjection.error
                : t('Settings.notLoaded')}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={notificationProjection.status === 'loading'}
            onClick={() => {
              void refreshNotificationProjection();
            }}
          >
            {t('Settings.refresh')}
          </Button>
        </div>
      </div>
      <div data-settings-row-kind="live" className={liveRowClassName}>
        <span><span className={liveBadgeClassName}>{t('Settings.liveBadge')}</span>{t('Settings.rows.notificationList')}</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={notificationListProjection.status === 'error' ? 'danger' : 'info'}>
            {notificationListStatusLabel}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={notificationListProjection.status === 'loading'}
            onClick={() => {
              void refreshNotificationListProjection();
            }}
          >
            {t('Settings.refresh')}
          </Button>
        </div>
      </div>
      <div data-settings-row-kind="live" className={liveRowClassName}>
        <span><span className={liveBadgeClassName}>{t('Settings.liveBadge')}</span>{t('Settings.rows.accountSettings')}</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={accountSettingsProjection.status === 'error' ? 'danger' : 'info'}>
            {accountSettingsProjection.status === 'ready'
              ? `${accountSettingsProjection.eligibility.tier}: ${accountSettingsProjection.eligibility.status}`
              : accountSettingsProjection.status === 'error'
                ? accountSettingsProjection.error
                : t('Settings.notLoaded')}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={accountSettingsProjection.status === 'loading'}
            onClick={() => {
              void refreshAccountSettingsProjection();
            }}
          >
            {t('Settings.refresh')}
          </Button>
        </div>
      </div>
      <div data-settings-row-kind="live" className={liveRowClassName}>
        <span><span className={liveBadgeClassName}>{t('Settings.liveBadge')}</span>{t('Settings.rows.humanChat')}</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={humanChatProjection.status === 'error' ? 'danger' : 'info'}>
            {humanChatProjection.status === 'ready'
              ? t('Settings.chatCount', { count: humanChatProjection.chats.items.length, plural: humanChatProjection.chats.items.length === 1 ? '' : 's' })
              : humanChatProjection.status === 'error'
                ? humanChatProjection.error
                : t('Settings.notLoaded')}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={humanChatProjection.status === 'loading'}
            onClick={() => {
              void refreshHumanChatProjection();
            }}
          >
            {t('Settings.refresh')}
          </Button>
        </div>
      </div>
    </>
  );
}
