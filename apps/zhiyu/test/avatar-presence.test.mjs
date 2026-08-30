import assert from 'node:assert/strict';
import test from 'node:test';
import { probeZhiyuAvatarPresence } from '../src/shell/avatar/avatar-presence.ts';

const AGENT_HANDLE = `agent_ref_${'a'.repeat(43)}`;

function conversationReady() {
  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'conversation-anchor-open',
    actionHint: 'send_runtime_agent_turn',
    source: 'runtime',
    message: 'Conversation ready.',
    agentHandle: AGENT_HANDLE,
    conversationAnchorId: 'conversation-anchor:1',
    threadId: 'conversation-anchor:1',
  };
}

test('projects only common Host presence mechanics for the current formal Conversation', async () => {
  const calls = [];
  const avatar = await probeZhiyuAvatarPresence(conversationReady(), {
    hostPort: {
      async invoke(request) {
        calls.push(request);
        return {
          command: 'presence',
          state: 'present',
          avatarInstanceRef: request.target.avatarInstanceId,
          switchIntentRef: null,
          committedPresentationRef: 'presentation:opaque',
          temporaryCustodyRef: 'custody:opaque',
        };
      },
    },
  });

  assert.equal(avatar.ready, true);
  assert.equal(avatar.launchAvailable, true);
  assert.equal(avatar.hostHandoff.state, 'present');
  assert.deepEqual(calls, [{
    command: 'presence',
    target: {
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: 'conversation-anchor:1',
      avatarInstanceId: `zhiyu-avatar-agent-ref-${'a'.repeat(43)}`,
      launchSource: 'zhiyu',
      switchIntentRef: null,
      committedPresentationRef: null,
      temporaryCustodyRef: null,
    },
  }]);
  assert.doesNotMatch(JSON.stringify(avatar), /ownerUserId|runtimeSourceRef|localAgentRef|configurationRef/u);
});

test('fails closed before Host presence when the current Conversation is unavailable', async () => {
  let called = false;
  const avatar = await probeZhiyuAvatarPresence({
    ...conversationReady(),
    ready: false,
    agentHandle: null,
    conversationAnchorId: null,
  }, {
    hostPort: { async invoke() { called = true; } },
  });

  assert.equal(called, false);
  assert.equal(avatar.ready, false);
  assert.equal(avatar.launchAvailable, false);
  assert.equal(avatar.reasonCode, 'zhiyu-avatar-current-conversation-required');
});

test('missing presence transport fails closed without launch availability', async () => {
  const avatar = await probeZhiyuAvatarPresence(conversationReady());

  assert.equal(avatar.ready, false);
  assert.equal(avatar.launchAvailable, false);
  assert.equal(avatar.hostHandoff, null);
  assert.equal(avatar.reasonCode, 'zhiyu-avatar-host-presence-unavailable');
});

test('Host presence failure remains mechanical and fails closed', async () => {
  const avatar = await probeZhiyuAvatarPresence(conversationReady(), {
    hostPort: {
      async invoke() {
        throw Object.assign(new Error('Desktop Host is restarting.'), {
          reasonCode: 'avatar-host-restarting',
          actionHint: 'retry_avatar_host_handoff',
          source: 'host',
        });
      },
    },
  });

  assert.equal(avatar.ready, false);
  assert.equal(avatar.launchAvailable, false);
  assert.equal(avatar.hostHandoff, null);
  assert.equal(avatar.reasonCode, 'avatar-host-restarting');
});
