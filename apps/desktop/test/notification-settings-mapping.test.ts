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

  test('settings equality detects channel default drift', () => {
    assert.equal(notificationsEqual(DEFAULT_NOTIFICATION_FORM, {
      ...DEFAULT_NOTIFICATION_FORM,
      email: false,
    }), false);
  });

  test('launch settings preserve friend and DM choices without rewriting historical posting preferences', () => {
    const form = toNotificationForm({
      activity: { directMessages: false, friendRequests: true, mentions: false, likes: false },
      channels: { inApp: true, push: false, email: true },
    });
    assert.deepEqual(form, {
      directMessages: false,
      friendRequests: true,
      inApp: true,
      push: false,
      email: true,
    });
    assert.deepEqual(toNotificationPayload({ ...form, directMessages: true, email: false }), {
      activity: { directMessages: true, friendRequests: true },
      channels: { inApp: true, push: false, email: false },
    });
  });
});
