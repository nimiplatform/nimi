import { Button } from '@nimiplatform/kit/ui';
import { isNimiGiftNotificationReviewable } from '@nimiplatform/kit/core/notifications';
import { ReviewRatingValue, type ReviewRating } from '@nimiplatform/sdk/realm/generated';
import type { TFunction } from 'i18next';
import { getActionLabel } from './notification-panel-labels.js';
import type { ItemActionKind, NotificationItemView, PendingItemAction } from './notification-panel-types.js';

export function NotificationActionButtons(props: {
  item: NotificationItemView;
  pendingItemAction: PendingItemAction | null;
  t: TFunction;
  onAcceptFriendRequest: (item: NotificationItemView) => void;
  onRejectFriendRequest: (item: NotificationItemView) => void;
  onAcceptGift: (item: NotificationItemView) => void;
  onStartRejectGift: (item: NotificationItemView) => void;
  onCreateReview: (
    item: NotificationItemView,
    rating: ReviewRating,
    action: ItemActionKind,
  ) => void;
}) {
  const {
    item,
    pendingItemAction,
    t,
    onAcceptFriendRequest,
    onRejectFriendRequest,
    onAcceptGift,
    onStartRejectGift,
    onCreateReview,
  } = props;
  const itemBusy = pendingItemAction?.itemId === item.id;

  if (item.type === 'friend_request_received') {
    return (
      <>
        <Button
          tone="primary"
          size="sm"
          disabled={itemBusy}
          onClick={(event) => {
            event.stopPropagation();
            onAcceptFriendRequest(item);
          }}
          leadingIcon={(
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        >
          {getActionLabel(
            pendingItemAction,
            item.id,
            'friend-accept',
            t('Relationship.accept', { defaultValue: 'Accept' }),
            t('NotificationPanel.accepting', { defaultValue: 'Accepting...' }),
          )}
        </Button>
        <Button
          tone="secondary"
          size="sm"
          disabled={itemBusy}
          onClick={(event) => {
            event.stopPropagation();
            onRejectFriendRequest(item);
          }}
          leadingIcon={(
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          )}
        >
          {getActionLabel(
            pendingItemAction,
            item.id,
            'friend-reject',
            t('Relationship.reject', { defaultValue: 'Reject' }),
            t('NotificationPanel.rejecting', { defaultValue: 'Rejecting...' }),
          )}
        </Button>
      </>
    );
  }

  if (item.type === 'gift_received' && item.giftTransactionId) {
    return (
      <>
        <Button
          tone="primary"
          size="sm"
          disabled={itemBusy}
          onClick={(event) => {
            event.stopPropagation();
            onAcceptGift(item);
          }}
          leadingIcon={(
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        >
          {getActionLabel(
            pendingItemAction,
            item.id,
            'gift-accept',
            t('NotificationPanel.accept', { defaultValue: 'Accept' }),
            t('NotificationPanel.accepting', { defaultValue: 'Accepting...' }),
          )}
        </Button>
        <Button
          tone="secondary"
          size="sm"
          disabled={itemBusy}
          onClick={(event) => {
            event.stopPropagation();
            onStartRejectGift(item);
          }}
          leadingIcon={(
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          )}
        >
          {t('NotificationPanel.reject', { defaultValue: 'Reject' })}
        </Button>
      </>
    );
  }

  if (isNimiGiftNotificationReviewable(item)) {
    return (
      <>
        <Button
          tone="primary"
          size="sm"
          disabled={itemBusy}
            onClick={(event) => {
              event.stopPropagation();
              onCreateReview(item, ReviewRatingValue.POSITIVE, 'review-positive');
            }}
          leadingIcon={(
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          )}
        >
          {getActionLabel(
            pendingItemAction,
            item.id,
            'review-positive',
            t('NotificationPanel.reviewPositive', { defaultValue: 'Review+' }),
            t('NotificationPanel.submitting', { defaultValue: 'Submitting...' }),
          )}
        </Button>
        <Button
          tone="secondary"
          size="sm"
          disabled={itemBusy}
            onClick={(event) => {
              event.stopPropagation();
              onCreateReview(item, ReviewRatingValue.NEGATIVE, 'review-negative');
            }}
        >
          {getActionLabel(
            pendingItemAction,
            item.id,
            'review-negative',
            t('NotificationPanel.reviewNegative', { defaultValue: 'Review-' }),
            t('NotificationPanel.submitting', { defaultValue: 'Submitting...' }),
          )}
        </Button>
      </>
    );
  }

  return null;
}
