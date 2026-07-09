import { Button, StatusBadge } from '@nimiplatform/kit/ui';
import {
  getNimiNotificationBadgeKey,
  getNimiNotificationCategory,
} from '@nimiplatform/kit/core/notifications';
import type { SettingsRouteViewProps } from './view.js';

const liveRowClassName = "flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)] before:mr-2 before:rounded before:border before:border-[var(--nimi-border-subtle)] before:px-1.5 before:py-0.5 before:text-[10px] before:font-semibold before:uppercase before:text-[var(--nimi-text-muted)] before:content-['Live']";

export function SettingsRealmRows(props: SettingsRouteViewProps) {
  const {
    notificationProjection,
    refreshNotificationProjection,
    notificationListProjection,
    refreshNotificationListProjection,
    accountDataProjection,
    requestAccountDataExportProjection,
    accountSettingsProjection,
    refreshAccountSettingsProjection,
    humanChatProjection,
    refreshHumanChatProjection,
    groupChatProjection,
    refreshGroupChatProjection,
  } = props;
  const notificationListStatusLabel = (() => {
    if (notificationListProjection.status === 'ready') {
      const firstItem = notificationListProjection.list.items[0];
      if (!firstItem) {
        return '0 items via system filter';
      }
      const itemCount = notificationListProjection.list.items.length;
      const plural = itemCount === 1 ? '' : 's';
      const category = getNimiNotificationCategory(firstItem.type);
      const badgeKey = getNimiNotificationBadgeKey(firstItem);
      return `${itemCount} item${plural}; first ${category}:${badgeKey}`;
    }
    if (notificationListProjection.status === 'error') {
      return notificationListProjection.error;
    }
    return 'not loaded';
  })();

  return (
    <>
      <div data-settings-row-kind="live" className={liveRowClassName}>
        <span>Realm notification projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={notificationProjection.status === 'error' ? 'danger' : 'info'}>
            {notificationProjection.status === 'ready'
              ? `Unread ${notificationProjection.unread.total}`
              : notificationProjection.status === 'error'
                ? notificationProjection.error
                : 'not loaded'}
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
            Refresh
          </Button>
        </div>
      </div>
      <div data-settings-row-kind="live" className={liveRowClassName}>
        <span>Realm notification list + Kit headless projection</span>
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
            Refresh
          </Button>
        </div>
      </div>
      <div data-settings-row-kind="live" className={liveRowClassName}>
        <span>Realm account-data export projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={accountDataProjection.status === 'error' ? 'danger' : 'info'}>
            {accountDataProjection.status === 'ready'
              ? `${accountDataProjection.exportRequest.status}${accountDataProjection.exportRequest.taskId ? ` ${accountDataProjection.exportRequest.taskId}` : ''}`
              : accountDataProjection.status === 'error'
                ? accountDataProjection.error
                : 'not requested'}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={accountDataProjection.status === 'loading'}
            onClick={() => {
              void requestAccountDataExportProjection();
            }}
          >
            Request
          </Button>
        </div>
      </div>
      <div data-settings-row-kind="live" className={liveRowClassName}>
        <span>SDK Realm account settings projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={accountSettingsProjection.status === 'error' ? 'danger' : 'info'}>
            {accountSettingsProjection.status === 'ready'
              ? `${accountSettingsProjection.eligibility.tier}: ${accountSettingsProjection.eligibility.status}`
              : accountSettingsProjection.status === 'error'
                ? accountSettingsProjection.error
                : 'not loaded'}
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
            Refresh
          </Button>
        </div>
      </div>
      <div data-settings-row-kind="live" className={liveRowClassName}>
        <span>Kit Realm human chat projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={humanChatProjection.status === 'error' ? 'danger' : 'info'}>
            {humanChatProjection.status === 'ready'
              ? `${humanChatProjection.chats.items.length} chat${humanChatProjection.chats.items.length === 1 ? '' : 's'}`
              : humanChatProjection.status === 'error'
                ? humanChatProjection.error
                : 'not loaded'}
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
            Refresh
          </Button>
        </div>
      </div>
      <div data-settings-row-kind="live" className={liveRowClassName}>
        <span>SDK Realm group chat projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={groupChatProjection.status === 'error' ? 'danger' : 'info'}>
            {groupChatProjection.status === 'ready'
              ? `${groupChatProjection.groups.items.length} group${groupChatProjection.groups.items.length === 1 ? '' : 's'}`
              : groupChatProjection.status === 'error'
                ? groupChatProjection.error
                : 'not loaded'}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={groupChatProjection.status === 'loading'}
            onClick={() => {
              void refreshGroupChatProjection();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
    </>
  );
}
