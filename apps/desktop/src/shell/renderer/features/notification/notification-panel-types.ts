import type { NimiNotificationFilterTab } from '@nimiplatform/kit/core/notifications';
import type { NimiRealmNotificationItemProjection } from '@nimiplatform/sdk/realm';

export const PAGE_SIZE = 20;
export const FILTER_TABS: NotificationFilterTab[] = ['all', 'gift', 'request', 'mention', 'like', 'system'];

export type ItemActionKind =
  | 'friend-accept'
  | 'friend-reject'
  | 'gift-accept'
  | 'gift-reject'
  | 'review-positive'
  | 'review-negative';

export type PendingItemAction = {
  itemId: string;
  action: ItemActionKind;
};

export type NotificationFilterTab = NimiNotificationFilterTab;
export type NotificationItemView = NimiRealmNotificationItemProjection;
