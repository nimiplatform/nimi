import assert from 'node:assert/strict';
import test from 'node:test';

import { projectAccountDeletionConfirmationState } from '../src/shell/renderer/features/settings/settings-data-management-page';

test('account deletion requires the explicit confirm-dialog step and gates it while pending', () => {
  // Idle: the confirm dialog's actions are live and the dialog can be
  // dismissed without sending any deletion request.
  assert.deepEqual(projectAccountDeletionConfirmationState(false), {
    actionsDisabled: false,
    canDismiss: true,
  });

  // Pending: the in-flight deletion request locks the dialog actions and
  // blocks dismissal so the request cannot be doubled or abandoned silently.
  assert.deepEqual(projectAccountDeletionConfirmationState(true), {
    actionsDisabled: true,
    canDismiss: false,
  });
});
