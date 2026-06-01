import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toRealmNotificationListProjection,
  type RealmNotificationItemProjection,
} from '@nimiplatform/sdk/realm';
import {
  getNimiNotificationBadgeKey,
  getNimiNotificationCategory,
  getNimiNotificationServerFilter,
  isNimiGiftNotificationReviewable,
} from '@nimiplatform/kit/core/notifications';

function createNotificationItem(input: Partial<RealmNotificationItemProjection> & {
  id: string;
  type: RealmNotificationItemProjection['type'];
}): RealmNotificationItemProjection {
  return {
    id: input.id,
    type: input.type,
    title: input.title ?? 'Notification',
    body: input.body ?? '',
    createdAt: input.createdAt ?? '2026-03-15T00:00:00.000Z',
    isRead: input.isRead ?? false,
    actorId: input.actorId ?? 'user-2',
    actorName: input.actorName ?? 'Actor',
    actorHandle: input.actorHandle ?? '@actor',
    actorAvatarUrl: input.actorAvatarUrl ?? null,
    actorIsAgent: input.actorIsAgent ?? false,
    giftTransactionId: input.giftTransactionId ?? null,
    giftStatus: input.giftStatus ?? null,
    giftMessage: input.giftMessage ?? null,
    giftSparkCost: input.giftSparkCost ?? null,
    reviewId: input.reviewId ?? null,
  };
}

describe('notification model mapping', () => {
  test('review notifications are classified as gifts', () => {
    assert.equal(getNimiNotificationCategory('review_received'), 'gift');
  });

  test('request tab includes resolved friend request notifications', () => {
    assert.equal(getNimiNotificationCategory('friend_request_accepted'), 'request');
    assert.equal(getNimiNotificationCategory('friend_request_rejected'), 'request');
  });

  test('server filters are only pushed down for single-type tabs', () => {
    assert.equal(getNimiNotificationServerFilter('like'), 'post_liked');
    assert.equal(getNimiNotificationServerFilter('system'), 'system_announcement');
    assert.equal(getNimiNotificationServerFilter('gift'), null);
  });

  test('gift status badges reflect accepted and rejected payloads', () => {
    assert.equal(getNimiNotificationBadgeKey(createNotificationItem({
      id: 'notif-1',
      type: 'gift_status_updated',
      giftStatus: 'accepted',
    })), 'giftAccepted');
    assert.equal(getNimiNotificationBadgeKey(createNotificationItem({
      id: 'notif-2',
      type: 'gift_status_updated',
      giftStatus: 'rejected',
    })), 'giftRejected');
  });

  test('gift reviewability requires resolved gift status without existing review', () => {
    assert.equal(isNimiGiftNotificationReviewable(createNotificationItem({
      id: 'notif-1',
      type: 'gift_status_updated',
      giftTransactionId: 'gift-1',
      giftStatus: 'accepted',
    })), true);
    assert.equal(isNimiGiftNotificationReviewable(createNotificationItem({
      id: 'notif-2',
      type: 'gift_status_updated',
      giftTransactionId: 'gift-2',
      giftStatus: 'accepted',
      reviewId: 'review-1',
    })), false);
  });

  test('list parsing preserves page metadata and actor fallback names', () => {
    const result = toRealmNotificationListProjection({
      items: [
        {
          id: 'notif-1',
          type: 'friend_request_received',
          title: 'Someone sent you a friend request',
          body: null,
          createdAt: '2026-03-15T00:00:00.000Z',
          isRead: false,
          actor: null,
          target: null,
          data: null,
        },
      ],
      page: {
        hasNext: true,
        nextCursor: 'cursor-2',
      },
    }, 'Notification', 'Unknown');

    assert.equal(result.items[0]?.actorName, 'Unknown');
    assert.equal(result.nextCursor, 'cursor-2');
    assert.equal(result.hasNext, true);
  });

  test('gift payload parsing preserves message and spark amount fields', () => {
    const result = toRealmNotificationListProjection({
      items: [
        {
          id: 'notif-gift',
          type: 'gift_received',
          title: 'A gift arrived',
          body: 'For you',
          createdAt: '2026-03-15T00:00:00.000Z',
          isRead: false,
          actor: {
            id: 'user-9',
            createdAt: '2026-03-15T00:00:00.000Z',
            displayName: 'Sender',
            handle: '@sender',
            avatarUrl: null,
            isAgent: false,
          },
          target: {
            interactionId: 'gift-tx-1',
          },
          data: {
            sparkCost: '88',
            message: 'Enjoy this one',
          },
        },
      ],
      page: {
        hasNext: false,
        nextCursor: null,
      },
    }, 'Notification', 'Unknown');

    assert.equal(result.items[0]?.giftTransactionId, 'gift-tx-1');
    assert.equal(result.items[0]?.giftSparkCost, '88');
    assert.equal(result.items[0]?.giftMessage, 'Enjoy this one');
  });
});
