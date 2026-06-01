import { describe, expect, it } from 'vitest';

import {
  getNimiNotificationBadgeKey,
  getNimiNotificationCategory,
  getNimiNotificationServerFilter,
  isNimiGiftNotificationReviewable,
} from '../src/notifications.js';

describe('notification headless primitives', () => {
  it('classifies notification categories and server filters', () => {
    expect(getNimiNotificationCategory('review_received')).toBe('gift');
    expect(getNimiNotificationCategory('friend_request_accepted')).toBe('request');
    expect(getNimiNotificationCategory('friend_request_rejected')).toBe('request');
    expect(getNimiNotificationCategory('post_liked')).toBe('like');
    expect(getNimiNotificationServerFilter('like')).toBe('post_liked');
    expect(getNimiNotificationServerFilter('system')).toBe('system_announcement');
    expect(getNimiNotificationServerFilter('gift')).toBeNull();
  });

  it('derives notification badge keys and gift review posture', () => {
    expect(getNimiNotificationBadgeKey({
      type: 'gift_status_updated',
      giftStatus: 'accepted',
    })).toBe('giftAccepted');
    expect(getNimiNotificationBadgeKey({
      type: 'gift_status_updated',
      giftStatus: 'rejected',
    })).toBe('giftRejected');
    expect(isNimiGiftNotificationReviewable({
      type: 'gift_status_updated',
      giftTransactionId: 'gift-1',
      giftStatus: 'accepted',
    })).toBe(true);
    expect(isNimiGiftNotificationReviewable({
      type: 'gift_status_updated',
      giftTransactionId: 'gift-2',
      giftStatus: 'accepted',
      reviewId: 'review-1',
    })).toBe(false);
  });
});
