import { Button } from '@nimiplatform/kit/ui';
import type { TFunction } from 'i18next';
import { getActionLabel } from './notification-panel-labels.js';
import type { NotificationItemView, PendingItemAction } from './notification-panel-types.js';

export function NotificationActionButtons(props: {
  item: NotificationItemView;
  pendingItemAction: PendingItemAction | null;
  t: TFunction;
  onAcceptFriendRequest: (item: NotificationItemView) => void;
  onRejectFriendRequest: (item: NotificationItemView) => void;
}) {
  const {
    item,
    pendingItemAction,
    t,
    onAcceptFriendRequest,
    onRejectFriendRequest,
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

  return null;
}
