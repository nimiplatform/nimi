import assert from 'node:assert/strict';
import test from 'node:test';

import { projectRemoveFriendConfirmationState } from '../src/shell/renderer/features/relationship/profile-detail-dialogs';

test('remove-friend confirmation gates dismissal and actions while mutation is pending', () => {
  assert.deepEqual(projectRemoveFriendConfirmationState(false), {
    actionsDisabled: false,
    canDismiss: true,
    confirmLabelKey: 'Profile.removeFriend',
    confirmLabelDefaultValue: 'Remove Friend',
  });
  assert.deepEqual(projectRemoveFriendConfirmationState(true), {
    actionsDisabled: true,
    canDismiss: false,
    confirmLabelKey: 'Profile.removing',
    confirmLabelDefaultValue: 'Removing...',
  });
});
