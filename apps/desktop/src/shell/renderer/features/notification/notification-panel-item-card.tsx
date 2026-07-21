import type { TFunction } from 'i18next';
import { AppCardSurface } from '@nimiplatform/kit/ui';
import { getNimiNotificationBadgeKey } from '@nimiplatform/kit/core/notifications';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { NotificationActionButtons } from './notification-action-buttons.js';
import { formatNotificationTime } from './notification-panel-helpers.js';
import { getBadgeDefaultLabel } from './notification-panel-labels.js';
import type { ItemActionKind, NotificationItemView, PendingItemAction } from './notification-panel-types.js';

type ReviewRating = RealmModel<'ReviewRating'>;

type NotificationPanelItemCardProps = {
  item: NotificationItemView;
  itemBusy: boolean;
  pendingItemAction: PendingItemAction | null;
  t: TFunction;
  navigateToGiftInbox: (giftTransactionId?: string) => void;
  markOneRead: (id: string) => void;
  onAcceptFriendRequest: (item: NotificationItemView) => void;
  onRejectFriendRequest: (item: NotificationItemView) => void;
  onAcceptGift: (item: NotificationItemView) => void;
  onStartRejectGift: (item: NotificationItemView) => void;
  onCreateReview: (item: NotificationItemView, rating: ReviewRating, action: ItemActionKind) => void;
};

export function NotificationPanelItemCard({
  item,
  itemBusy,
  pendingItemAction,
  t,
  navigateToGiftInbox,
  markOneRead,
  onAcceptFriendRequest,
  onRejectFriendRequest,
  onAcceptGift,
  onStartRejectGift,
  onCreateReview,
}: NotificationPanelItemCardProps) {
  const badgeKey = getNimiNotificationBadgeKey(item);
  const giftMessage = item.giftMessage?.trim() || '';
  const body = item.body.trim();
  const showGiftMessage = Boolean(giftMessage);
  const showBody = Boolean(body) && (!showGiftMessage || body !== giftMessage);
  const shouldOpenGiftInbox = (
    (item.type === 'gift_received' || item.type === 'gift_status_updated')
    && Boolean(item.giftTransactionId)
  );

  return (
    <AppCardSurface
      key={item.id}
      onClick={() => {
        if (!itemBusy) {
          if (shouldOpenGiftInbox) {
            navigateToGiftInbox(item.giftTransactionId ?? undefined);
          }
          markOneRead(item.id);
        }
      }}
      interactive={!itemBusy}
      active={!item.isRead}
      className={`group relative cursor-pointer rounded-2xl border-white/60 p-4 shadow-[0_14px_34px_rgba(15,23,42,0.05)] ${itemBusy ? 'pointer-events-none' : ''}`}
      kind="promoted-glass"
    >
      {!item.isRead ? (
        <div className="absolute right-4 top-4 h-2.5 w-2.5 rounded-full bg-mint-500 shadow-sm" />
      ) : null}

      <div className="flex gap-4">
        <div className="relative shrink-0">
          <EntityAvatar
            imageUrl={item.actorAvatarUrl}
            name={item.actorName}
            kind="human"
            sizeClassName="h-12 w-12"
            className="ring-2 ring-gray-100"
            fallbackClassName={item.isRead
              ? 'bg-gray-100 text-gray-500 ring-2 ring-gray-100'
              : 'bg-mint-100 text-mint-700 ring-2 ring-gray-100'}
            textClassName="text-sm font-semibold"
          />
        </div>

        <div className="min-w-0 flex-1 pr-6">
          <p className="text-sm text-gray-800">
            <span className="font-bold">{item.actorName}</span>{' '}
            <span className="text-gray-600">{item.title.replace(item.actorName, '').trim()}</span>{' '}
            <span className="inline-flex items-center rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
              {t(`NotificationPanel.typeNotifications.${badgeKey}`, {
                defaultValue: getBadgeDefaultLabel(badgeKey),
              })}
            </span>
          </p>

          <p className="mt-0.5 text-xs text-gray-400">{formatNotificationTime(item.createdAt)}</p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {item.giftSparkCost ? (
              <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                {t('NotificationPanel.sparkAmount', {
                  amount: item.giftSparkCost,
                  defaultValue: '{{amount}} Spark',
                })}
              </span>
            ) : null}
          </div>

          {showBody ? (
            <div className="mt-2 inline-block max-w-full rounded-xl rounded-tl-sm bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_5%,white)] px-3 py-2">
              <p className="line-clamp-2 text-sm text-[var(--nimi-text-secondary)]">"{body}"</p>
            </div>
          ) : null}

          {showGiftMessage ? (
            <div className="mt-2 inline-block max-w-full rounded-xl rounded-tl-sm bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,white)] px-3 py-2">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--nimi-action-primary-bg)]">
                {t('NotificationPanel.senderMessage', { defaultValue: 'Sender message' })}
              </p>
              <p className="line-clamp-3 text-sm text-[var(--nimi-text-primary)]">"{giftMessage}"</p>
            </div>
          ) : null}

          <div className="mt-3 flex items-center gap-2">
            <NotificationActionButtons
              item={item}
              pendingItemAction={pendingItemAction}
              t={t}
              onAcceptFriendRequest={onAcceptFriendRequest}
              onRejectFriendRequest={onRejectFriendRequest}
              onAcceptGift={onAcceptGift}
              onStartRejectGift={onStartRejectGift}
              onCreateReview={onCreateReview}
            />
            {shouldOpenGiftInbox ? (
              <span className="inline-flex items-center gap-1 rounded-xl border border-mint-200 bg-mint-50 px-3 py-1.5 text-[12px] font-medium text-mint-700 transition-colors group-hover:border-mint-300 group-hover:bg-mint-100">
                {t('NotificationPanel.viewGift', { defaultValue: 'View Gift' })}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </AppCardSurface>
  );
}
