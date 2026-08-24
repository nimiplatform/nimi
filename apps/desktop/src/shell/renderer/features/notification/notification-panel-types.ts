import type { NimiNotificationFilterTab } from '@nimiplatform/kit/core/notifications';
import type { NimiRealmNotificationItemView } from '@nimiplatform/sdk/realm';

export const PAGE_SIZE = 20;
export const FILTER_TABS: NotificationFilterTab[] = ['all', 'request', 'mention', 'like', 'system'];

export type ItemActionKind =
  | 'friend-accept'
  | 'friend-reject';

export type PendingItemAction = {
  itemId: string;
  action: ItemActionKind;
};

export type NotificationFilterTab = NimiNotificationFilterTab;
export type NotificationItemView = NimiRealmNotificationItemView;
