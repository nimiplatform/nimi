import assert from 'node:assert/strict';
import test from 'node:test';
import { projectZhiyuAvatarLaunchAction } from '../src/shell/avatar/avatar-launch.ts';
import {
  buildZhiyuAvatarLaunchHandoff,
  launchZhiyuAvatar,
} from '../src/shell/avatar/avatar-launch-handoff.ts';

const AGENT_HANDLE = `agent_ref_${'a'.repeat(43)}`;

function readyEvidence(overrides = {}) {
  return {
    localAgent: { ready: true },
    conversation: {
      ready: true,
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: 'conversation-anchor:must-stay-in-runtime',
    },
    avatar: {
      launchAvailable: true,
      hostHandoff: null,
    },
    ...overrides,
  };
}

test('Zhiyu projects a ready Avatar action with a Conversation-independent instance id', () => {
  const action = projectZhiyuAvatarLaunchAction(readyEvidence());

  assert.equal(action.state, 'ready');
  assert.equal(action.command, 'launch');
  assert.equal(action.avatarInstanceId, `zhiyu-avatar-agent-ref-${'a'.repeat(43)}`);
  assert.doesNotMatch(action.avatarInstanceId, /conversation-anchor|must-stay-in-runtime/u);
});

test('Zhiyu builds the exact common Host handoff without identity or product authority', () => {
  const evidence = readyEvidence();
  const action = projectZhiyuAvatarLaunchAction(evidence);
  const handoff = buildZhiyuAvatarLaunchHandoff({ evidence, action });

  assert.deepEqual(handoff.request, {
    command: 'launch',
    target: {
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: 'conversation-anchor:must-stay-in-runtime',
      avatarInstanceId: `zhiyu-avatar-agent-ref-${'a'.repeat(43)}`,
      launchSource: 'zhiyu',
      switchIntentRef: null,
      committedPresentationRef: null,
      temporaryCustodyRef: null,
    },
  });
  assert.doesNotMatch(
    JSON.stringify(handoff.request),
    /accessToken|subjectUserId|runtimeAppId|ownerUserId|runtimeSourceRef|localAgentRef|configurationRef|coverage|availability/u,
  );
});

test('Zhiyu invokes the common Host port and preserves opaque custody refs', async () => {
  const evidence = readyEvidence({
    avatar: {
      launchAvailable: true,
      hostHandoff: {
        command: 'presence',
        state: 'absent',
        avatarInstanceRef: null,
        switchIntentRef: null,
        committedPresentationRef: null,
        temporaryCustodyRef: null,
      },
    },
  });
  const action = projectZhiyuAvatarLaunchAction(evidence);
  const calls = [];
  const result = await launchZhiyuAvatar({
    evidence,
    action,
    hostPort: {
      async invoke(request) {
        calls.push(request);
        return {
          command: request.command,
          state: 'present',
          avatarInstanceRef: request.target.avatarInstanceId,
          switchIntentRef: null,
          committedPresentationRef: 'presentation:opaque',
          temporaryCustodyRef: 'custody:opaque',
        };
      },
    },
  });

  assert.equal(result.state, 'opened');
  assert.equal(result.handoff.state, 'present');
  assert.equal(calls.length, 1);
  assert.doesNotMatch(JSON.stringify(calls), /ownerUserId|runtimeSourceRef|localAgentRef|configurationRef/u);
});

test('an already present Avatar is focused through the same port', () => {
  const action = projectZhiyuAvatarLaunchAction(readyEvidence({
    avatar: {
      launchAvailable: true,
      hostHandoff: {
        command: 'presence',
        state: 'present',
        avatarInstanceRef: 'avatar:opaque',
        switchIntentRef: null,
        committedPresentationRef: null,
        temporaryCustodyRef: null,
      },
    },
  }));
  assert.equal(action.state, 'ready');
  assert.equal(action.command, 'focus');
});

test('focus returning absent fails closed instead of reporting an opened Avatar', async () => {
  const evidence = readyEvidence({
    avatar: {
      launchAvailable: true,
      hostHandoff: {
        command: 'presence',
        state: 'present',
        avatarInstanceRef: 'avatar:opaque',
        switchIntentRef: null,
        committedPresentationRef: null,
        temporaryCustodyRef: null,
      },
    },
  });
  const action = projectZhiyuAvatarLaunchAction(evidence);
  const result = await launchZhiyuAvatar({
    evidence,
    action,
    hostPort: {
      async invoke(request) {
        return {
          command: request.command,
          state: 'absent',
          avatarInstanceRef: null,
          switchIntentRef: null,
          committedPresentationRef: null,
          temporaryCustodyRef: null,
        };
      },
    },
  });

  assert.deepEqual(result, {
    state: 'blocked',
    reasonCode: 'zhiyu-avatar-host-focus-absent',
    actionHint: 'retry_avatar_host_handoff',
    message: 'Avatar Host focus did not establish a present window.',
  });
});

test('Zhiyu explicitly confirms and resubmits a one-time switch intent', async () => {
  const evidence = readyEvidence();
  const action = projectZhiyuAvatarLaunchAction(evidence);
  const calls = [];
  const result = await launchZhiyuAvatar({
    evidence,
    action,
    confirmSwitch: async () => true,
    hostPort: {
      async invoke(request) {
        calls.push(request);
        if (calls.length === 1) {
          return {
            command: 'launch', state: 'confirmation-required', avatarInstanceRef: null,
            switchIntentRef: 'avatar_switch_once', committedPresentationRef: null, temporaryCustodyRef: null,
          };
        }
        return {
          command: 'launch', state: 'present', avatarInstanceRef: 'avatar:switched',
          switchIntentRef: null, committedPresentationRef: null, temporaryCustodyRef: null,
        };
      },
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].target.switchIntentRef, null);
  assert.equal(calls[1].target.switchIntentRef, 'avatar_switch_once');
  assert.equal(result.state, 'opened');
});

test('Zhiyu switch cancellation keeps the current companion without resubmission', async () => {
  const evidence = readyEvidence();
  const action = projectZhiyuAvatarLaunchAction(evidence);
  let calls = 0;
  const result = await launchZhiyuAvatar({
    evidence,
    action,
    confirmSwitch: async () => false,
    hostPort: {
      async invoke() {
        calls += 1;
        return {
          command: 'launch', state: 'confirmation-required', avatarInstanceRef: null,
          switchIntentRef: 'avatar_switch_once', committedPresentationRef: null, temporaryCustodyRef: null,
        };
      },
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, {
    state: 'blocked',
    reasonCode: 'zhiyu-avatar-switch-cancelled',
    actionHint: 'keep_current_companion',
    message: 'Kept the current desktop companion.',
  });
});
