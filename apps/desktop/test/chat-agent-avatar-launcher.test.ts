import assert from 'node:assert/strict';
import test from 'node:test';
import type { AvatarHostHandoffRequest } from '@nimiplatform/kit/features/avatar/headless';

import {
  buildDesktopAvatarLaunchHandoffPayload,
  buildDesktopAvatarInstanceId,
  launchDesktopAvatarHandoff,
  prepareDesktopAvatarLaunchHandoffPayload,
} from '../src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-launcher';
import { parseAvatarLaunchContext } from '../../avatar/src/shell/renderer/bridge/launch-context.js';

const AGENT_HANDLE = `agent_ref_${'a'.repeat(43)}`;
const CONVERSATION_ANCHOR_ID = 'anchor-1';

test('desktop avatar launcher builds deterministic instance ids from the Runtime Agent selector', () => {
  assert.equal(
    buildDesktopAvatarInstanceId({ agentHandle: AGENT_HANDLE }),
    `desktop-avatar-${AGENT_HANDLE.replaceAll('_', '-')}`,
  );
});

test('desktop avatar launcher rejects Conversation or thread based instance identity', () => {
  for (const extra of [
    { conversationAnchorId: 'anchor-1' },
    { threadId: 'thread-1' },
  ]) {
    assert.throws(
      () => buildDesktopAvatarInstanceId({ agentHandle: AGENT_HANDLE, ...extra } as never),
      /only on Agent identity/,
    );
  }
});

test('desktop avatar launcher builds the minimal Desktop-supervised launch intent', () => {
  const payload = buildDesktopAvatarLaunchHandoffPayload({
    agentHandle: AGENT_HANDLE,
    conversationAnchorId: CONVERSATION_ANCHOR_ID,
    avatarInstanceId: ' instance-1 ',
    sourceSurface: ' desktop-agent-chat ',
  });
  assert.deepEqual(payload, {
    agentHandle: AGENT_HANDLE,
    conversationAnchorId: CONVERSATION_ANCHOR_ID,
    avatarInstanceId: 'instance-1',
    launchSource: 'desktop-agent-chat',
  });
  assert.deepEqual(parseAvatarLaunchContext(payload), {
    agentHandle: AGENT_HANDLE,
    conversationAnchorId: CONVERSATION_ANCHOR_ID,
    avatarInstanceId: 'instance-1',
    launchSource: 'desktop-agent-chat',
  });
});

test('desktop avatar launcher preserves an omitted Conversation anchor for Host-side Runtime resolution', () => {
  const payload = buildDesktopAvatarLaunchHandoffPayload({
    agentHandle: AGENT_HANDLE,
  });
  assert.deepEqual(payload, { agentHandle: AGENT_HANDLE, conversationAnchorId: null });
});

test('desktop avatar launcher rejects malformed handles and constructs only the exact payload', async () => {
  assert.throws(
    () => buildDesktopAvatarLaunchHandoffPayload({ agentHandle: 'agent-1', conversationAnchorId: CONVERSATION_ANCHOR_ID }),
    /canonical agentHandle/,
  );
  assert.deepEqual(await prepareDesktopAvatarLaunchHandoffPayload({
    agentHandle: AGENT_HANDLE,
    conversationAnchorId: CONVERSATION_ANCHOR_ID,
    ownerUserId: 'must-not-project',
    avatarAssetRef: 'must-not-project',
  } as never), {
    agentHandle: AGENT_HANDLE,
    conversationAnchorId: CONVERSATION_ANCHOR_ID,
  });
});

test('desktop avatar launcher invokes only the minimal launch handoff', async () => {
  const calls: unknown[] = [];
  const result = await launchDesktopAvatarHandoff({
    agentHandle: AGENT_HANDLE,
    conversationAnchorId: CONVERSATION_ANCHOR_ID,
    avatarInstanceId: 'instance-1',
    launchSource: 'desktop-agent-chat',
  }, {
    invokeLaunchHandoff: async (request) => {
      calls.push(request);
      return {
        command: 'launch',
        state: 'present',
        avatarInstanceRef: 'instance-1',
        switchIntentRef: null,
        committedPresentationRef: null,
        temporaryCustodyRef: null,
      };
    },
  });
  assert.deepEqual(calls, [{
    command: 'launch',
    target: {
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: CONVERSATION_ANCHOR_ID,
      avatarInstanceId: 'instance-1',
      launchSource: 'desktop-agent-chat',
      switchIntentRef: null,
      committedPresentationRef: null,
      temporaryCustodyRef: null,
    },
  }]);
  assert.equal(result.opened, true);
  assert.equal(result.handoffUri, 'instance-1');
});

test('desktop avatar launcher explicitly confirms a different active Agent before resubmitting once', async () => {
  const calls: AvatarHostHandoffRequest[] = [];
  const result = await launchDesktopAvatarHandoff({
    agentHandle: AGENT_HANDLE,
    conversationAnchorId: CONVERSATION_ANCHOR_ID,
  }, {
    confirmSwitch: async () => true,
    invokeLaunchHandoff: async (request) => {
      calls.push(request);
      if (calls.length === 1) {
        return {
          command: 'launch', state: 'confirmation-required', avatarInstanceRef: null,
          switchIntentRef: 'avatar_switch_once', committedPresentationRef: null, temporaryCustodyRef: null,
        };
      }
      return {
        command: 'launch', state: 'present', avatarInstanceRef: 'instance-switched',
        switchIntentRef: null, committedPresentationRef: null, temporaryCustodyRef: null,
      };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.target.switchIntentRef, null);
  assert.equal(calls[1]?.target.switchIntentRef, 'avatar_switch_once');
  assert.deepEqual(result, { opened: true, handoffUri: 'instance-switched' });
});

test('desktop avatar launcher cancellation does not resubmit the switch intent', async () => {
  let calls = 0;
  const result = await launchDesktopAvatarHandoff({ agentHandle: AGENT_HANDLE }, {
    confirmSwitch: async () => false,
    invokeLaunchHandoff: async () => {
      calls += 1;
      return {
        command: 'launch', state: 'confirmation-required', avatarInstanceRef: null,
        switchIntentRef: 'avatar_switch_once', committedPresentationRef: null, temporaryCustodyRef: null,
      };
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { opened: false, handoffUri: '' });
});
