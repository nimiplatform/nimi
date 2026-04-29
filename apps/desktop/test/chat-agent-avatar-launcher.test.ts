import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDesktopAvatarLaunchHandoffPayload,
  buildDesktopAvatarInstanceId,
  closeDesktopAvatarHandoff,
  launchDesktopAvatarHandoff,
  parseDesktopAvatarLaunchHandoffResult,
  prepareDesktopAvatarLaunchHandoffPayload,
} from '../src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-launcher';
import { parseAvatarLaunchContext } from '../../avatar/src/shell/renderer/bridge/launch-context.js';

const forbiddenLaunchFields = [
  'avatarPackage',
  'avatarPackageKind',
  'avatarPackageId',
  'avatarPackageSchemaVersion',
  'conversationAnchorId',
  'anchorMode',
  'runtimeAppId',
  'worldId',
  'scopedBinding',
  'bindingId',
  'bindingHandle',
  'scopes',
  'state',
  'reason',
  'accountId',
  'userId',
  'subjectUserId',
  'realmBaseUrl',
  'accessToken',
  'refreshToken',
  'jwt',
] as const;

test('desktop avatar launcher builds deterministic instance ids from target context', () => {
  assert.equal(
    buildDesktopAvatarInstanceId({
      agentId: 'agent:alpha',
      threadId: 'thread/42',
    }),
    'desktop-avatar-agent-alpha-thread-42',
  );
});

test('desktop avatar launcher rejects conversation anchor based instance identity', () => {
  assert.throws(
    () => buildDesktopAvatarInstanceId({
      agentId: 'agent:alpha',
      conversationAnchorId: 'anchor-1',
    } as never),
    /conversationAnchorId/,
  );
});

test('desktop avatar launcher builds minimal launch intent payload', () => {
  const payload = buildDesktopAvatarLaunchHandoffPayload({
    agentId: ' agent-1 ',
    avatarInstanceId: ' instance-1 ',
    sourceSurface: ' desktop-agent-chat ',
  });

  assert.deepEqual(payload, {
    agentId: 'agent-1',
    avatarInstanceId: 'instance-1',
    sourceSurface: 'desktop-agent-chat',
  });
  for (const field of forbiddenLaunchFields) {
    assert.equal(field in payload, false, `payload must not contain ${field}`);
  }
  assert.deepEqual(parseAvatarLaunchContext(payload), {
    agentId: 'agent-1',
    avatarInstanceId: 'instance-1',
    launchSource: 'desktop-agent-chat',
  });
});

test('desktop avatar launcher allows required agent id only', () => {
  const payload = buildDesktopAvatarLaunchHandoffPayload({
    agentId: 'agent-1',
  });

  assert.deepEqual(payload, {
    agentId: 'agent-1',
  });
  assert.deepEqual(parseAvatarLaunchContext(payload), {
    agentId: 'agent-1',
    avatarInstanceId: null,
    launchSource: null,
  });
});

test('desktop avatar launcher rejects missing agent id before invoking avatar', async () => {
  let invoked = false;
  await assert.rejects(
    launchDesktopAvatarHandoff({
      agentId: ' ',
      avatarInstanceId: 'instance-1',
    }, {
      invokeLaunchHandoff: async () => {
        invoked = true;
        return { opened: true, handoffUri: 'nimi-avatar://launch?agent_id=agent-1' };
      },
    }),
    /agentId/,
  );
  assert.equal(invoked, false);
});

test('desktop avatar launcher no longer reserves anchors or issues scoped bindings', async () => {
  const calls: string[] = [];
  const result = await launchDesktopAvatarHandoff({
    agentId: 'agent-1',
    avatarInstanceId: 'instance-1',
    launchSource: 'desktop-agent-chat',
  }, {
    invokeLaunchHandoff: async (payload) => {
      calls.push(`invoke:${payload.agentId}`);
      assert.deepEqual(payload, {
        agentId: 'agent-1',
        avatarInstanceId: 'instance-1',
        launchSource: 'desktop-agent-chat',
      });
      return { opened: true, handoffUri: 'nimi-avatar://launch?agent_id=agent-1' };
    },
  });

  assert.deepEqual(calls, ['invoke:agent-1']);
  assert.equal(result.opened, true);
});

test('desktop avatar prepared payload rejects old launch authority tuple inputs', async () => {
  await assert.rejects(
    prepareDesktopAvatarLaunchHandoffPayload({
      agentId: 'agent-1',
      avatarInstanceId: 'instance-1',
      sourceSurface: 'desktop-agent-chat',
      avatarPackage: { kind: 'live2d', packageId: 'live2d_ab12cd34ef56' },
      conversationAnchorId: 'anchor-1',
      scopedBinding: { bindingId: 'binding-1' },
      runtimeAppId: 'nimi.desktop',
      worldId: 'world-1',
    } as never),
    /forbidden field: avatarPackage/,
  );
});

test('avatar launch parser rejects old binding package anchor and auth fields', () => {
  const basePayload = {
    agentId: 'agent-1',
    avatarInstanceId: 'instance-1',
  };
  for (const field of forbiddenLaunchFields) {
    assert.throws(
      () => parseAvatarLaunchContext({
        ...basePayload,
        [field]: field === 'scopedBinding' ? { bindingId: 'binding-1' } : 'forbidden',
      }),
      /forbidden field/,
      `expected ${field} to be rejected`,
    );
  }
});

test('desktop avatar close handoff does not revoke scoped bindings', async () => {
  const calls: string[] = [];
  await closeDesktopAvatarHandoff({
    avatarInstanceId: 'instance-1',
    closedBy: 'desktop',
    sourceSurface: 'desktop-agent-chat',
  }, {
    invokeCloseHandoff: async ({ avatarInstanceId }) => {
      calls.push(`close:${avatarInstanceId}`);
      return { opened: true, handoffUri: 'nimi-avatar://close?avatar_instance_id=instance-1' };
    },
  });
  assert.deepEqual(calls, ['close:instance-1']);
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
