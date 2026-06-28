import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDesktopAvatarLaunchHandoffPayload,
  buildDesktopAvatarInstanceId,
  closeDesktopAvatarHandoff,
  launchDesktopAvatarHandoff,
  parseDesktopAvatarCloseHandoffResult,
  parseDesktopAvatarLaunchHandoffResult,
  prepareDesktopAvatarLaunchHandoffPayload,
} from '../src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-launcher';
import { parseAvatarLaunchContext } from '../../avatar/src/shell/renderer/bridge/launch-context.js';

const forbiddenLaunchFields = [
  'conversationAnchorId',
  'conversation_anchor_id',
  'avatarPackage',
  'avatar_package',
  'avatarPackageKind',
  'avatar_package_kind',
  'avatarPackageId',
  'avatar_package_id',
  'avatarPackageRef',
  'avatar_package_ref',
  'avatarPackageSchemaVersion',
  'avatar_package_schema_version',
  'backendCapabilityProfileRef',
  'backend_capability_profile_ref',
  'materializationRef',
  'materialization_ref',
  'localMaterializationRef',
  'local_materialization_ref',
  'live2dCalibrationRef',
  'live2d_calibration_ref',
  'live2dCalibration',
  'live2d_calibration',
  'modelDigest',
  'model_digest',
  'avatarInstanceCalibration',
  'avatar_instance_calibration',
  'previewArtifactRef',
  'preview_artifact_ref',
  'framingCalibration',
  'framing_calibration',
  'renderScale',
  'render_scale',
  'targetFps',
  'target_fps',
  'performancePolicy',
  'performance_policy',
  'expressionInventory',
  'expression_inventory',
  'manifestPath',
  'manifest_path',
  'packagePath',
  'package_path',
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

const avatarLaunchIdentity = {
  ownerUserId: 'owner-1',
  runtimeSourceRef: 'agent-1',
  localAgentRef: 'local-agent:opaque-1',
};

test('desktop avatar launcher builds deterministic instance ids from target context', () => {
  assert.equal(
    buildDesktopAvatarInstanceId({
      localAgentRef: 'local-agent:owner-1:agent:alpha',
      threadId: 'thread/42',
    }),
    'desktop-avatar-local-agent-owner-1-agent-alpha-thread-42',
  );
});

test('desktop avatar launcher rejects conversation anchor based instance identity', () => {
  assert.throws(
    () => buildDesktopAvatarInstanceId({
      localAgentRef: 'local-agent:owner-1:agent:alpha',
      conversationAnchorId: 'anchor-1',
    } as never),
    /conversationAnchorId/,
  );
});

test('desktop avatar launcher builds minimal launch intent payload', () => {
  const payload = buildDesktopAvatarLaunchHandoffPayload({
    ownerUserId: ` ${avatarLaunchIdentity.ownerUserId} `,
    runtimeSourceRef: ` ${avatarLaunchIdentity.runtimeSourceRef} `,
    localAgentRef: ` ${avatarLaunchIdentity.localAgentRef} `,
    avatarInstanceId: ' instance-1 ',
    sourceSurface: ' desktop-agent-chat ',
  });

  assert.deepEqual(payload, {
    agentId: avatarLaunchIdentity.localAgentRef,
    ownerUserId: avatarLaunchIdentity.ownerUserId,
    runtimeSourceRef: avatarLaunchIdentity.runtimeSourceRef,
    localAgentRef: avatarLaunchIdentity.localAgentRef,
    avatarInstanceId: 'instance-1',
    launchSource: 'desktop-agent-chat',
  });
  for (const field of forbiddenLaunchFields) {
    assert.equal(field in payload, false, `payload must not contain ${field}`);
  }
  assert.deepEqual(parseAvatarLaunchContext(payload), {
    agentId: avatarLaunchIdentity.localAgentRef,
    ...avatarLaunchIdentity,
    avatarInstanceId: 'instance-1',
    launchSource: 'desktop-agent-chat',
  });
});

test('desktop avatar launcher allows required agent selector only', () => {
  const payload = buildDesktopAvatarLaunchHandoffPayload({
    ...avatarLaunchIdentity,
  });

  assert.deepEqual(payload, {
    agentId: avatarLaunchIdentity.localAgentRef,
    ...avatarLaunchIdentity,
  });
  assert.deepEqual(parseAvatarLaunchContext(payload), {
    agentId: avatarLaunchIdentity.localAgentRef,
    ...avatarLaunchIdentity,
    avatarInstanceId: null,
    launchSource: null,
  });
});

test('desktop avatar launcher rejects bare runtime source ids', () => {
  assert.throws(
    () => buildDesktopAvatarLaunchHandoffPayload({
      ownerUserId: avatarLaunchIdentity.ownerUserId,
      runtimeSourceRef: avatarLaunchIdentity.runtimeSourceRef,
      localAgentRef: 'agent-1',
      avatarInstanceId: 'instance-1',
    }),
    /local-agent ref/,
  );
});

test('desktop avatar launcher rejects missing localAgentRef before invoking avatar', async () => {
  let invoked = false;
  await assert.rejects(
    launchDesktopAvatarHandoff({
      ownerUserId: avatarLaunchIdentity.ownerUserId,
      runtimeSourceRef: avatarLaunchIdentity.runtimeSourceRef,
      localAgentRef: ' ',
      avatarInstanceId: 'instance-1',
    }, {
      invokeLaunchHandoff: async () => {
        invoked = true;
        return { opened: true, handoffUri: 'nimi-avatar://launch?agent_id=local-agent%3Aowner-1%3Aagent-1' };
      },
    }),
    /localAgentRef/,
  );
  assert.equal(invoked, false);
});

test('desktop avatar launcher no longer reserves anchors or issues scoped bindings', async () => {
  const calls: string[] = [];
  const result = await launchDesktopAvatarHandoff({
    ...avatarLaunchIdentity,
    avatarInstanceId: 'instance-1',
    launchSource: 'desktop-agent-chat',
  }, {
    invokeLaunchHandoff: async (payload) => {
      calls.push(`invoke:${payload.agentId}`);
      assert.deepEqual(payload, {
        agentId: avatarLaunchIdentity.localAgentRef,
        ...avatarLaunchIdentity,
        avatarInstanceId: 'instance-1',
        launchSource: 'desktop-agent-chat',
      });
      return { opened: true, handoffUri: 'nimi-avatar://launch?agent_id=local-agent%3Aopaque-1' };
    },
  });

  assert.deepEqual(calls, ['invoke:local-agent:opaque-1']);
  assert.equal(result.opened, true);
});

test('desktop avatar prepared payload rejects old launch authority tuple inputs', async () => {
  await assert.rejects(
    prepareDesktopAvatarLaunchHandoffPayload({
      ...avatarLaunchIdentity,
      avatarInstanceId: 'instance-1',
      avatarPackage: { kind: 'live2d', packageId: 'live2d_ab12cd34ef56' },
    } as never),
    /forbidden field: avatarPackage/,
  );
});

test('desktop avatar prepared payload rejects Live2D calibration refs and payload fields', async () => {
  for (const field of [
    'live2dCalibrationRef',
    'live2d_calibration_ref',
    'live2dCalibration',
    'live2d_calibration',
    'modelDigest',
    'model_digest',
    'framingCalibration',
    'framing_calibration',
    'renderScale',
    'render_scale',
    'targetFps',
    'target_fps',
    'expressionInventory',
    'expression_inventory',
  ]) {
    await assert.rejects(
      prepareDesktopAvatarLaunchHandoffPayload({
        ...avatarLaunchIdentity,
        [field]: 'forbidden',
      } as never),
      /forbidden field/,
      `expected ${field} to be rejected before Avatar handoff`,
    );
  }
});

test('avatar launch parser rejects old binding package anchor and auth fields', () => {
  const basePayload = {
    agentId: avatarLaunchIdentity.localAgentRef,
    ...avatarLaunchIdentity,
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
      handoffUri: 'nimi-avatar://launch?agent_id=local-agent%3Aowner-1%3Aagent-1',
    }),
    {
      opened: true,
      handoffUri: 'nimi-avatar://launch?agent_id=local-agent%3Aowner-1%3Aagent-1',
    },
  );
});

test('desktop avatar launcher rejects coerced handoff result shapes', () => {
  assert.throws(
    () => parseDesktopAvatarLaunchHandoffResult({
      opened: 'false',
      handoffUri: 'nimi-avatar://launch?agent_id=local-agent%3Aowner-1%3Aagent-1',
    }),
    /invalid opened/,
  );
  assert.throws(
    () => parseDesktopAvatarLaunchHandoffResult({
      opened: true,
      handoffUri: 42,
    }),
    /invalid handoffUri/,
  );
  assert.throws(
    () => parseDesktopAvatarCloseHandoffResult({
      opened: 1,
      handoffUri: 'nimi-avatar://close?avatar_instance_id=instance-1',
    }),
    /invalid opened/,
  );
});
