import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasAvatarInstanceInLiveInventory,
  resolveAvatarInstanceCloseFeedback,
  resolveAvatarInstanceLaunchFeedback,
} from '../src/shell/renderer/features/chat/chat-agent-avatar-instance-action-feedback.js';

test('avatar instance launch feedback downgrades unopened handoff to warning', () => {
  assert.deepEqual(resolveAvatarInstanceLaunchFeedback(true), {
    outcome: 'confirmed',
  });
  assert.deepEqual(resolveAvatarInstanceLaunchFeedback(false), {
    outcome: 'unconfirmed',
  });
});

test('avatar instance inventory helper only treats listed ids as actionable', () => {
  assert.equal(hasAvatarInstanceInLiveInventory([
    { avatarInstanceId: 'instance-1' },
  ], 'instance-1'), true);
  assert.equal(hasAvatarInstanceInLiveInventory([
    { avatarInstanceId: 'instance-1' },
  ], 'instance-2'), false);
});

test('avatar instance close feedback distinguishes still-live and refresh-failed states', () => {
  assert.deepEqual(resolveAvatarInstanceCloseFeedback({
    opened: true,
    instanceStillLive: false,
    inventoryRefreshFailed: false,
  }), {
    outcome: 'confirmed',
  });

  assert.deepEqual(resolveAvatarInstanceCloseFeedback({
    opened: true,
    instanceStillLive: true,
    inventoryRefreshFailed: false,
  }), {
    outcome: 'still_live',
  });

  assert.deepEqual(resolveAvatarInstanceCloseFeedback({
    opened: true,
    instanceStillLive: false,
    inventoryRefreshFailed: true,
  }), {
    outcome: 'refresh_failed',
  });

  assert.deepEqual(resolveAvatarInstanceCloseFeedback({
    opened: false,
    instanceStillLive: false,
    inventoryRefreshFailed: false,
  }), {
    outcome: 'unconfirmed',
  });
});
