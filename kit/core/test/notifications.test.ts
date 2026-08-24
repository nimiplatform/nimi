import { describe, expect, it } from 'vitest';

import {
  getNimiNotificationBadgeKey,
  getNimiNotificationCategory,
  getNimiNotificationServerFilter,
} from '../src/notifications.js';

describe('notification headless primitives', () => {
  it('classifies notification categories and server filters', () => {
    expect(getNimiNotificationCategory('system_announcement')).toBe('system');
    expect(getNimiNotificationCategory('friend_request_accepted')).toBe('request');
    expect(getNimiNotificationCategory('friend_request_rejected')).toBe('request');
    expect(getNimiNotificationCategory('post_liked')).toBe('like');
    expect(getNimiNotificationServerFilter('like')).toBe('post_liked');
    expect(getNimiNotificationServerFilter('system')).toBe('system_announcement');
    expect(getNimiNotificationServerFilter('request')).toBeNull();
  });

  it('derives admitted notification badge keys', () => {
    expect(getNimiNotificationBadgeKey({
      type: 'friend_request_accepted',
    })).toBe('friendRequestAccepted');
    expect(getNimiNotificationBadgeKey({
      type: 'system_announcement',
    })).toBe('system');
  });
});
