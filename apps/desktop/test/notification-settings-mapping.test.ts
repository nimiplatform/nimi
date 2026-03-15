import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NOTIFICATION_FORM,
  notificationsEqual,
  toNotificationForm,
  toNotificationPayload,
} from '../src/shell/renderer/features/settings/settings-preferences-panel.js';

describe('notification settings mapping', () => {
  test('desktop defaults match backend notification defaults', () => {
    assert.equal(DEFAULT_NOTIFICATION_FORM.email, true);
    assert.equal(DEFAULT_NOTIFICATION_FORM.push, false);
  });

  test('compressed gift toggles read all mapped backend fields', () => {
    const form = toNotificationForm({
      channels: {
        email: true,
        inApp: true,
        push: false,
      },
      activity: {
        directMessages: true,
        friendRequests: true,
        likes: true,
        mentions: true,
      },
      gifts: {
        received: true,
        acceptedRejected: false,
        actionRequired: true,
        refunds: true,
        paymentFailed: false,
      },
    });

    assert.equal(form.giftReceived, false);
    assert.equal(form.giftActionRequired, false);
  });

  test('compressed gift toggles fan back out to all backend fields', () => {
    const payload = toNotificationPayload({
      ...DEFAULT_NOTIFICATION_FORM,
      giftReceived: false,
      giftActionRequired: true,
    });

    assert.deepEqual(payload.gifts, {
      acceptedRejected: false,
      received: false,
      actionRequired: true,
      paymentFailed: true,
      refunds: true,
    });
  });

  test('settings equality detects channel default drift', () => {
    assert.equal(notificationsEqual(DEFAULT_NOTIFICATION_FORM, {
      ...DEFAULT_NOTIFICATION_FORM,
      email: false,
    }), false);
  });
});
