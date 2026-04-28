import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDesktopAvatarLaunchHandoffPayload,
  buildDesktopAvatarInstanceId,
  closeDesktopAvatarHandoff,
  launchDesktopAvatarHandoff,
  parseDesktopAvatarLaunchHandoffResult,
  prepareDesktopAvatarLaunchHandoffPayload,
  type DesktopAvatarScopedBindingProjection,
} from '../src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-launcher';
import { parseAvatarLaunchContext } from '../../avatar/src/shell/renderer/bridge/launch-context.js';

const validPackageContext = {
  avatarPackage: {
    kind: 'live2d' as const,
    packageId: 'live2d_ab12cd34ef56',
  },
};

function bindingProjection(input: {
  agentId: string;
  avatarInstanceId: string;
  conversationAnchorId: string;
  worldId?: string | null;
  bindingId?: string;
}): DesktopAvatarScopedBindingProjection {
  return {
    bindingId: input.bindingId || `binding-${input.conversationAnchorId}`,
    bindingHandle: `binding:${input.bindingId || input.conversationAnchorId}`,
    runtimeAppId: 'nimi.desktop',
    appInstanceId: 'nimi.desktop.local-first-party',
    windowId: 'desktop-agent-chat',
    avatarInstanceId: input.avatarInstanceId,
    agentId: input.agentId,
    conversationAnchorId: input.conversationAnchorId,
    worldId: input.worldId || null,
    purpose: 'avatar.interaction.consume',
    scopes: [
      'runtime.agent.turn.read',
      'runtime.agent.turn.write',
      'runtime.agent.presentation.read',
      'runtime.agent.state.read',
    ],
    issuedAt: '2026-04-28T00:00:00.000Z',
    expiresAt: '2026-04-28T01:00:00.000Z',
    state: 'active',
    reasonCode: 'action_executed',
  };
}

function buildPayload(input: Parameters<typeof buildDesktopAvatarLaunchHandoffPayload>[0]) {
  return buildDesktopAvatarLaunchHandoffPayload(
    input,
    bindingProjection({
      agentId: input.agentId,
      avatarInstanceId: input.avatarInstanceId,
      conversationAnchorId: input.conversationAnchorId || 'anchor-reserved',
      worldId: input.worldId,
    }),
  );
}

test('desktop avatar launcher builds deterministic instance ids from target context', () => {
  assert.equal(
    buildDesktopAvatarInstanceId({
      agentId: 'agent:alpha',
      threadId: 'thread/42',
    }),
    'desktop-avatar-agent-alpha-thread-42',
  );
});

test('desktop avatar launcher keeps same-agent different-anchor launches isolated', () => {
  const anchorOnePayload = buildPayload({
    ...validPackageContext,
    agentId: 'agent-alpha',
    avatarInstanceId: buildDesktopAvatarInstanceId({
      agentId: 'agent-alpha',
      conversationAnchorId: 'anchor-1',
    }),
    conversationAnchorId: 'anchor-1',
    anchorMode: 'existing',
  });
  const anchorTwoPayload = buildPayload({
    ...validPackageContext,
    agentId: 'agent-alpha',
    avatarInstanceId: buildDesktopAvatarInstanceId({
      agentId: 'agent-alpha',
      conversationAnchorId: 'anchor-2',
    }),
    conversationAnchorId: 'anchor-2',
    anchorMode: 'existing',
  });

  const anchorOneContext = parseAvatarLaunchContext(anchorOnePayload);
  const anchorTwoContext = parseAvatarLaunchContext(anchorTwoPayload);

  assert.equal(anchorOneContext.agentId, 'agent-alpha');
  assert.equal(anchorTwoContext.agentId, 'agent-alpha');
  assert.equal(anchorOneContext.conversationAnchorId, 'anchor-1');
  assert.equal(anchorTwoContext.conversationAnchorId, 'anchor-2');
  assert.notEqual(anchorOneContext.conversationAnchorId, anchorTwoContext.conversationAnchorId);
  assert.notEqual(anchorOneContext.avatarInstanceId, anchorTwoContext.avatarInstanceId);
});

test('desktop avatar launcher keeps different agents isolated even on the same anchor', () => {
  const alphaInstanceId = buildDesktopAvatarInstanceId({
    agentId: 'agent-alpha',
    conversationAnchorId: 'anchor-shared',
  });
  const betaInstanceId = buildDesktopAvatarInstanceId({
    agentId: 'agent-beta',
    conversationAnchorId: 'anchor-shared',
  });

  assert.notEqual(alphaInstanceId, betaInstanceId);

  const alphaContext = parseAvatarLaunchContext(buildPayload({
    ...validPackageContext,
    agentId: 'agent-alpha',
    avatarInstanceId: alphaInstanceId,
    conversationAnchorId: 'anchor-shared',
    anchorMode: 'existing',
  }));
  const betaContext = parseAvatarLaunchContext(buildPayload({
    ...validPackageContext,
    agentId: 'agent-beta',
    avatarInstanceId: betaInstanceId,
    conversationAnchorId: 'anchor-shared',
    anchorMode: 'existing',
  }));

  assert.equal(alphaContext.agentId, 'agent-alpha');
  assert.equal(betaContext.agentId, 'agent-beta');
  assert.equal(alphaContext.conversationAnchorId, 'anchor-shared');
  assert.equal(betaContext.conversationAnchorId, 'anchor-shared');
});

test('desktop avatar launcher payload round-trips into avatar launch context without auth payload bleed', () => {
  const payload = buildPayload({
    ...validPackageContext,
    agentId: 'agent-1',
    avatarInstanceId: 'desktop-avatar-agent-1-anchor-1',
    conversationAnchorId: 'anchor-1',
    anchorMode: 'existing',
    launchedBy: 'desktop',
    sourceSurface: 'desktop-agent-chat',
  });

  assert.equal('accessToken' in payload, false);
  assert.equal('refreshToken' in payload, false);
  assert.equal('subjectUserId' in payload, false);
  assert.equal('subject_user_id' in payload, false);
  assert.equal('realmBaseUrl' in payload, false);
  assert.equal('realm_base_url' in payload, false);
  assert.equal('jwt' in payload, false);
  assert.equal('accountAccessToken' in payload, false);
  assert.equal('account_access_token' in payload, false);
  assert.equal('agentCenterAccountId' in payload, false);
  assert.equal('agent_center_account_id' in payload, false);
  assert.equal('sharedAuth' in payload, false);
  assert.equal('shared_auth' in payload, false);
  assert.equal('loginRoute' in payload, false);
  assert.equal('login_route' in payload, false);
  assert.equal('anchorMode' in payload, false);
  assert.equal('manifestPath' in payload, false);
  assert.equal('manifest_path' in payload, false);
  assert.equal('packagePath' in payload, false);
  assert.equal('package_path' in payload, false);

  assert.deepEqual(parseAvatarLaunchContext(payload), {
    agentId: 'agent-1',
    avatarPackageKind: 'live2d',
    avatarPackageId: 'live2d_ab12cd34ef56',
    avatarPackageSchemaVersion: 1,
    avatarInstanceId: 'desktop-avatar-agent-1-anchor-1',
    conversationAnchorId: 'anchor-1',
    launchedBy: 'desktop',
    runtimeAppId: 'nimi.desktop',
    sourceSurface: 'desktop-agent-chat',
    worldId: null,
    scopedBinding: bindingProjection({
      agentId: 'agent-1',
      avatarInstanceId: 'desktop-avatar-agent-1-anchor-1',
      conversationAnchorId: 'anchor-1',
    }),
  });
});

test('desktop avatar launcher round-trips formerly open-new handoff with committed runtime anchor', () => {
  const payload = buildPayload({
    ...validPackageContext,
    agentId: 'agent-1',
    avatarInstanceId: 'desktop-avatar-agent-1-anchor-reserved',
    conversationAnchorId: 'anchor-reserved',
    anchorMode: 'open_new',
    launchedBy: 'desktop',
    sourceSurface: 'desktop-agent-chat',
  });

  assert.deepEqual(parseAvatarLaunchContext(payload), {
    agentId: 'agent-1',
    avatarPackageKind: 'live2d',
    avatarPackageId: 'live2d_ab12cd34ef56',
    avatarPackageSchemaVersion: 1,
    avatarInstanceId: 'desktop-avatar-agent-1-anchor-reserved',
    conversationAnchorId: 'anchor-reserved',
    launchedBy: 'desktop',
    runtimeAppId: 'nimi.desktop',
    sourceSurface: 'desktop-agent-chat',
    worldId: null,
    scopedBinding: bindingProjection({
      agentId: 'agent-1',
      avatarInstanceId: 'desktop-avatar-agent-1-anchor-reserved',
      conversationAnchorId: 'anchor-reserved',
    }),
  });
  assert.equal('anchorMode' in payload, false);
});

test('desktop avatar launcher fails closed before invoking handoff for invalid anchor context', () => {
  assert.throws(
    () => buildPayload({
      ...validPackageContext,
      agentId: 'agent-1',
      avatarInstanceId: 'instance-1',
      conversationAnchorId: null,
      anchorMode: 'existing',
    }),
    /committed conversationAnchorId/,
  );
  assert.throws(
    () => buildPayload({
      ...validPackageContext,
      agentId: 'agent-1',
      avatarInstanceId: 'instance-1',
      conversationAnchorId: null,
      anchorMode: 'invalid' as never,
    }),
    /anchorMode to be existing or open_new/,
  );
});

test('desktop avatar launcher fails closed before invoking handoff for invalid package context', () => {
  assert.throws(
	    () => buildPayload({
	      agentId: 'agent-1',
      avatarPackage: {
        kind: 'vrm',
        packageId: 'live2d_ab12cd34ef56',
      },
      avatarInstanceId: 'instance-1',
      conversationAnchorId: 'anchor-1',
      anchorMode: 'open_new',
    }),
    /packageId to match/,
  );
  assert.throws(
	    () => buildPayload({
	      agentId: 'agent-1',
      avatarPackage: {
        kind: 'live2d',
        packageId: 'live2d_NOTHEX0000',
      },
      avatarInstanceId: 'instance-1',
      conversationAnchorId: 'anchor-1',
      anchorMode: 'open_new',
    }),
    /packageId to match/,
  );
});

test('avatar launch parser rejects forbidden auth account and login fields', () => {
  const basePayload = buildPayload({
    ...validPackageContext,
    agentId: 'agent-1',
    avatarInstanceId: 'instance-1',
    conversationAnchorId: 'anchor-1',
    anchorMode: 'existing',
  });
  const forbiddenFields = [
    'realmBaseUrl',
    'realm_url',
    'accessToken',
    'accountAccessToken',
    'refreshToken',
    'jwt',
    'rawJwt',
    'subject_user_id',
    'agentCenterAccountId',
    'agent_center_account_id',
    'sharedAuth',
    'loginRoute',
    'anchorMode',
  ] as const;
  for (const field of forbiddenFields) {
    assert.throws(
      () => parseAvatarLaunchContext({
        ...basePayload,
        [field]: 'forbidden',
      }),
      /forbidden field/,
      `expected ${field} to be rejected`,
    );
  }
});

test('desktop avatar launcher reserves anchor and issues binding before invoking avatar', async () => {
  const calls: string[] = [];
  const result = await launchDesktopAvatarHandoff({
    ...validPackageContext,
    agentId: 'agent-1',
    avatarInstanceId: 'instance-1',
    conversationAnchorId: null,
    anchorMode: 'open_new',
  }, {
    reserveConversationAnchor: async () => {
      calls.push('reserve');
      return 'anchor-reserved';
    },
    issueScopedAppBinding: async (target) => {
      calls.push(`bind:${target.conversationAnchorId}`);
      assert.deepEqual(target.scopes, [
        'runtime.agent.turn.read',
        'runtime.agent.presentation.read',
        'runtime.agent.state.read',
        'runtime.agent.turn.write',
      ]);
      return bindingProjection({
        agentId: target.agentId,
        avatarInstanceId: target.avatarInstanceId,
        conversationAnchorId: target.conversationAnchorId,
      });
    },
    invokeLaunchHandoff: async (payload) => {
      calls.push(`invoke:${payload.conversationAnchorId}`);
      return { opened: true, handoffUri: 'nimi-avatar://launch?agent_id=agent-1' };
    },
  });

  assert.deepEqual(calls, ['reserve', 'bind:anchor-reserved', 'invoke:anchor-reserved']);
  assert.equal(result.opened, true);
});

test('desktop avatar launcher fails before avatar starts when anchor reservation fails', async () => {
  let invoked = false;
  await assert.rejects(
    launchDesktopAvatarHandoff({
      ...validPackageContext,
      agentId: 'agent-1',
      avatarInstanceId: 'instance-1',
      conversationAnchorId: null,
      anchorMode: 'open_new',
    }, {
      reserveConversationAnchor: async () => {
        throw new Error('reservation unavailable');
      },
      issueScopedAppBinding: async () => {
        throw new Error('binding should not be issued');
      },
      invokeLaunchHandoff: async () => {
        invoked = true;
        return { opened: true, handoffUri: 'nimi-avatar://launch' };
      },
    }),
    /reservation unavailable/,
  );
  assert.equal(invoked, false);
});

test('desktop avatar launcher treats empty anchor reservation as launch failure before binding', async () => {
  let issued = false;
  let invoked = false;
  await assert.rejects(
    launchDesktopAvatarHandoff({
      ...validPackageContext,
      agentId: 'agent-1',
      avatarInstanceId: 'instance-1',
      conversationAnchorId: null,
      anchorMode: 'open_new',
    }, {
      reserveConversationAnchor: async () => ' ',
      issueScopedAppBinding: async () => {
        issued = true;
        throw new Error('binding should not be issued');
      },
      invokeLaunchHandoff: async () => {
        invoked = true;
        return { opened: true, handoffUri: 'nimi-avatar://launch' };
      },
    }),
    /committed conversationAnchorId/,
  );
  assert.equal(issued, false);
  assert.equal(invoked, false);
});

test('desktop avatar launcher fails before avatar starts when scoped binding issuance fails', async () => {
  let invoked = false;
  await assert.rejects(
    launchDesktopAvatarHandoff({
      ...validPackageContext,
      agentId: 'agent-1',
      avatarInstanceId: 'instance-1',
      conversationAnchorId: 'anchor-1',
      anchorMode: 'existing',
    }, {
      issueScopedAppBinding: async () => {
        throw new Error('binding unavailable');
      },
      invokeLaunchHandoff: async () => {
        invoked = true;
        return { opened: true, handoffUri: 'nimi-avatar://launch' };
      },
    }),
    /binding unavailable/,
  );
  assert.equal(invoked, false);
});

test('desktop avatar close revokes scoped binding before close handoff when relation is known', async () => {
  const calls: string[] = [];
  await closeDesktopAvatarHandoff({
    avatarInstanceId: 'instance-1',
    bindingId: 'binding-1',
  }, {
    revokeScopedAppBinding: async ({ bindingId }) => {
      calls.push(`revoke:${bindingId}`);
    },
    invokeCloseHandoff: async ({ avatarInstanceId }) => {
      calls.push(`close:${avatarInstanceId}`);
      return { opened: true, handoffUri: 'nimi-avatar://close?avatar_instance_id=instance-1' };
    },
  });
  assert.deepEqual(calls, ['revoke:binding-1', 'close:instance-1']);
});

test('desktop avatar prepared binding omits write scope when input is disabled', async () => {
  let requestedScopes: string[] = [];
  const payload = await prepareDesktopAvatarLaunchHandoffPayload({
    ...validPackageContext,
    agentId: 'agent-1',
    avatarInstanceId: 'instance-1',
    conversationAnchorId: 'anchor-1',
    anchorMode: 'existing',
    inputEnabled: false,
  }, {
    issueScopedAppBinding: async (target) => {
      requestedScopes = target.scopes;
      return bindingProjection({
        agentId: target.agentId,
        avatarInstanceId: target.avatarInstanceId,
        conversationAnchorId: target.conversationAnchorId,
      });
    },
  });
  assert.equal(payload.conversationAnchorId, 'anchor-1');
  assert.deepEqual(requestedScopes, [
    'runtime.agent.turn.read',
    'runtime.agent.presentation.read',
    'runtime.agent.state.read',
  ]);
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
