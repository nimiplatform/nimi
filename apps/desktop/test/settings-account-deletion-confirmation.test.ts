import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DELETE_ACCOUNT_CONFIRMATION_TEXT,
  isDeleteAccountConfirmationMatch,
} from '../src/shell/renderer/features/settings/settings-data-management-page';

test('account deletion requires the exact typed acknowledgement', () => {
  assert.equal(DELETE_ACCOUNT_CONFIRMATION_TEXT, 'DELETE');
  assert.equal(isDeleteAccountConfirmationMatch('DELETE'), true);
  assert.equal(isDeleteAccountConfirmationMatch('  DELETE  '), true);
  assert.equal(isDeleteAccountConfirmationMatch('delete'), false);
  assert.equal(isDeleteAccountConfirmationMatch('DELETE account'), false);
  assert.equal(isDeleteAccountConfirmationMatch(''), false);
});
