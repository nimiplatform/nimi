import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDesktopAvatarLaunchHandoffPayload,
  buildDesktopAvatarInstanceId,
  parseDesktopAvatarLaunchHandoffResult,
} from '../src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-launcher';
import { parseAvatarLaunchContext } from '../../avatar/src/shell/renderer/bridge/launch-context.js';

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
    agentId: 'agent-alpha',
    avatarInstanceId: buildDesktopAvatarInstanceId({
      agentId: 'agent-alpha',
      conversationAnchorId: 'anchor-1',
    }),
    conversationAnchorId: 'anchor-1',
    anchorMode: 'existing',
  });
  const anchorTwoPayload = buildDesktopAvatarLaunchHandoffPayload({
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
    agentId: 'agent-alpha',
    avatarInstanceId: alphaInstanceId,
    conversationAnchorId: 'anchor-shared',
    anchorMode: 'existing',
  }));
  const betaContext = parseAvatarLaunchContext(buildDesktopAvatarLaunchHandoffPayload({
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

  assert.deepEqual(parseAvatarLaunchContext(payload), {
    agentId: 'agent-1',
    avatarInstanceId: 'desktop-avatar-agent-1-anchor-1',
    conversationAnchorId: 'anchor-1',
    anchorMode: 'existing',
    launchedBy: 'desktop',
    sourceSurface: 'desktop-agent-chat',
  });
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
