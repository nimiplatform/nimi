import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDesktopAvatarInstanceId,
  parseDesktopAvatarLaunchHandoffResult,
} from '../src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-launcher';

test('desktop avatar launcher builds deterministic instance ids from target context', () => {
  assert.equal(
    buildDesktopAvatarInstanceId({
      agentId: 'agent:alpha',
      threadId: 'thread/42',
    }),
    'desktop-avatar-agent-alpha-thread-42',
  );
});

test('desktop avatar launcher parses handoff results', () => {
  assert.deepEqual(
    parseDesktopAvatarLaunchHandoffResult({
      opened: true,
      handoffUri: 'nimi-avatar://launch?agent_id=agent-1',
    }),
    {
      opened: true,
      handoffUri: 'nimi-avatar://launch?agent_id=agent-1',
    },
  );
});
