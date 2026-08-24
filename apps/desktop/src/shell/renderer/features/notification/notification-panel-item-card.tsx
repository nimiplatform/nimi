import type { TFunction } from 'i18next';
import { AppCardSurface } from '@nimiplatform/kit/ui';
import { getNimiNotificationBadgeKey } from '@nimiplatform/kit/core/notifications';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { NotificationActionButtons } from './notification-action-buttons.js';
import { formatNotificationTime } from './notification-panel-helpers.js';
import { getBadgeDefaultLabel } from './notification-panel-labels.js';
import type { NotificationItemView, PendingItemAction } from './notification-panel-types.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';

type NotificationPanelItemCardProps = {
  item: NotificationItemView;
  itemBusy: boolean;
  pendingItemAction: PendingItemAction | null;
  t: TFunction;
  markOneRead: (id: string) => void;
  onAcceptFriendRequest: (item: NotificationItemView) => void;
  onRejectFriendRequest: (item: NotificationItemView) => void;
};

export function NotificationPanelItemCard({
  item,
  itemBusy,
  pendingItemAction,
  t,
  markOneRead,
  onAcceptFriendRequest,
  onRejectFriendRequest,
}: NotificationPanelItemCardProps) {
  const i18n = useDesktopI18nResource();
  const badgeKey = getNimiNotificationBadgeKey(item);
  const body = item.body.trim();

  return (
    <AppCardSurface
      key={item.id}
      onClick={() => {
        if (!itemBusy) {
          markOneRead(item.id);
        }
      }}
      interactive={!itemBusy}
      active={!item.isRead}
      className={`group relative cursor-pointer rounded-2xl border-white/60 p-4 shadow-[0_14px_34px_rgba(15,23,42,0.05)] ${itemBusy ? 'pointer-events-none' : ''}`}
      kind="promoted-glass"
    >
      {!item.isRead ? (
        <div className="absolute right-4 top-4 h-2.5 w-2.5 rounded-full bg-[var(--nimi-action-primary-bg)] shadow-sm" />
      ) : null}

      <div className="flex gap-4">
        <div className="relative shrink-0">
          <EntityAvatar
            imageUrl={item.actorAvatarUrl}
            name={item.actorName}
            kind="human"
            sizeClassName="h-12 w-12"
            className="ring-2 ring-[var(--nimi-border-subtle)]"
            fallbackClassName={item.isRead
              ? 'bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-muted)] ring-2 ring-[var(--nimi-border-subtle)]'
              : 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,var(--nimi-surface-card))] text-[var(--nimi-action-primary-bg)] ring-2 ring-[var(--nimi-border-subtle)]'}
            textClassName="text-sm font-semibold"
          />
        </div>

        <div className="min-w-0 flex-1 pr-6">
          <p className="text-sm text-[var(--nimi-text-primary)]">
            <span className="font-bold">{item.actorName}</span>{' '}
            <span className="text-[var(--nimi-text-secondary)]">{item.title.replace(item.actorName, '').trim()}</span>{' '}
            <span className="inline-flex items-center rounded-md bg-[var(--nimi-status-info-soft-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--nimi-status-info-soft-text)]">
              {t(`NotificationPanel.typeNotifications.${badgeKey}`, {
                defaultValue: getBadgeDefaultLabel(badgeKey),
              })}
            </span>
          </p>

          <p className="mt-0.5 text-xs text-[var(--nimi-text-muted)]">{formatNotificationTime(item.createdAt, i18n)}</p>

          {body ? (
            <div className="mt-2 inline-block max-w-full rounded-xl rounded-tl-sm bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_5%,white)] px-3 py-2">
              <p className="line-clamp-2 text-sm text-[var(--nimi-text-secondary)]">"{body}"</p>
            </div>
          ) : null}

          <div className="mt-3 flex items-center gap-2">
            <NotificationActionButtons
              item={item}
              pendingItemAction={pendingItemAction}
              t={t}
              onAcceptFriendRequest={onAcceptFriendRequest}
              onRejectFriendRequest={onRejectFriendRequest}
            />
          </div>
        </div>
      </div>
    </AppCardSurface>
  );
}
