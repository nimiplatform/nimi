import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NOTIFICATION_FORM,
  notificationsEqual,
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
});
