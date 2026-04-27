import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDesktopAvatarLaunchHandoffPayload,
  buildDesktopAvatarInstanceId,
  parseDesktopAvatarLaunchHandoffResult,
} from '../src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-launcher';
import { parseAvatarLaunchContext } from '../../avatar/src/shell/renderer/bridge/launch-context.js';

const validPackageContext = {
  accountId: 'account_1',
  avatarPackage: {
    kind: 'live2d' as const,
    packageId: 'live2d_ab12cd34ef56',
  },
};

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
  const anchorOnePayload = buildDesktopAvatarLaunchHandoffPayload({
    ...validPackageContext,
    agentId: 'agent-alpha',
    avatarInstanceId: buildDesktopAvatarInstanceId({
      agentId: 'agent-alpha',
      conversationAnchorId: 'anchor-1',
    }),
    conversationAnchorId: 'anchor-1',
    anchorMode: 'existing',
  });
  const anchorTwoPayload = buildDesktopAvatarLaunchHandoffPayload({
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

  const alphaContext = parseAvatarLaunchContext(buildDesktopAvatarLaunchHandoffPayload({
    ...validPackageContext,
    agentId: 'agent-alpha',
    avatarInstanceId: alphaInstanceId,
    conversationAnchorId: 'anchor-shared',
    anchorMode: 'existing',
  }));
  const betaContext = parseAvatarLaunchContext(buildDesktopAvatarLaunchHandoffPayload({
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
  const payload = buildDesktopAvatarLaunchHandoffPayload({
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
  assert.equal('manifestPath' in payload, false);
  assert.equal('manifest_path' in payload, false);
  assert.equal('packagePath' in payload, false);
  assert.equal('package_path' in payload, false);

  assert.deepEqual(parseAvatarLaunchContext(payload), {
    agentCenterAccountId: 'account_1',
    agentId: 'agent-1',
    avatarPackageKind: 'live2d',
    avatarPackageId: 'live2d_ab12cd34ef56',
    avatarPackageSchemaVersion: 1,
    avatarInstanceId: 'desktop-avatar-agent-1-anchor-1',
    conversationAnchorId: 'anchor-1',
    anchorMode: 'existing',
    launchedBy: 'desktop',
    runtimeAppId: 'nimi.desktop',
    sourceSurface: 'desktop-agent-chat',
    realmBaseUrl: null,
    worldId: null,
  });
});

test('desktop avatar launcher round-trips open-new handoff without existing anchor leakage', () => {
  const payload = buildDesktopAvatarLaunchHandoffPayload({
    ...validPackageContext,
    agentId: 'agent-1',
    avatarInstanceId: 'desktop-avatar-agent-1-open-new-anchor',
    conversationAnchorId: null,
    anchorMode: 'open_new',
    launchedBy: 'desktop',
    sourceSurface: 'desktop-agent-chat',
  });

  assert.deepEqual(parseAvatarLaunchContext(payload), {
    agentCenterAccountId: 'account_1',
    agentId: 'agent-1',
    avatarPackageKind: 'live2d',
    avatarPackageId: 'live2d_ab12cd34ef56',
    avatarPackageSchemaVersion: 1,
    avatarInstanceId: 'desktop-avatar-agent-1-open-new-anchor',
    conversationAnchorId: null,
    anchorMode: 'open_new',
    launchedBy: 'desktop',
    runtimeAppId: 'nimi.desktop',
    sourceSurface: 'desktop-agent-chat',
    realmBaseUrl: null,
    worldId: null,
  });
});

test('desktop avatar launcher fails closed before invoking handoff for invalid anchor context', () => {
  assert.throws(
    () => buildDesktopAvatarLaunchHandoffPayload({
      ...validPackageContext,
      agentId: 'agent-1',
      avatarInstanceId: 'instance-1',
      conversationAnchorId: null,
      anchorMode: 'existing',
    }),
    /conversationAnchorId when anchorMode=existing/,
  );
  assert.throws(
    () => buildDesktopAvatarLaunchHandoffPayload({
      ...validPackageContext,
      agentId: 'agent-1',
      avatarInstanceId: 'instance-1',
      conversationAnchorId: 'anchor-1',
      anchorMode: 'open_new',
    }),
    /must omit conversationAnchorId/,
  );
  assert.throws(
    () => buildDesktopAvatarLaunchHandoffPayload({
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
    () => buildDesktopAvatarLaunchHandoffPayload({
      accountId: 'account_1',
      agentId: 'agent-1',
      avatarPackage: {
        kind: 'vrm',
        packageId: 'live2d_ab12cd34ef56',
      },
      avatarInstanceId: 'instance-1',
      conversationAnchorId: null,
      anchorMode: 'open_new',
    }),
    /packageId to match/,
  );
  assert.throws(
    () => buildDesktopAvatarLaunchHandoffPayload({
      accountId: 'account_1',
      agentId: 'agent-1',
      avatarPackage: {
        kind: 'live2d',
        packageId: 'live2d_NOTHEX0000',
      },
      avatarInstanceId: 'instance-1',
      conversationAnchorId: null,
      anchorMode: 'open_new',
    }),
    /packageId to match/,
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
