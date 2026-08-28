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

const AGENT_HANDLE = `agent_ref_${'a'.repeat(43)}`;
const CONVERSATION_ANCHOR_ID = 'anchor-1';
const FORBIDDEN_AUTHORITY_FIELDS = [
  'ownerUserId',
  'runtimeSourceRef',
  'localAgentRef',
  'accountId',
  'subjectUserId',
  'realmBaseUrl',
  'accessToken',
  'refreshToken',
  'jwt',
  'scopedBinding',
  'bindingId',
  'avatarPackage',
  'avatarAssetRef',
  'backendCapabilityProfileRef',
  'agentId',
] as const;

test('desktop avatar launcher builds deterministic instance ids from the Runtime Agent selector', () => {
  assert.equal(
    buildDesktopAvatarInstanceId({ agentHandle: AGENT_HANDLE, threadId: 'thread/42' }),
    `desktop-avatar-${AGENT_HANDLE.replaceAll('_', '-')}-thread-42`,
  );
});

test('desktop avatar launcher rejects conversation anchor based instance identity', () => {
  assert.throws(
    () => buildDesktopAvatarInstanceId({
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: 'anchor-1',
    } as never),
    /conversationAnchorId/,
  );
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

test('desktop avatar launcher requires canonical Conversation selectors', () => {
  const payload = buildDesktopAvatarLaunchHandoffPayload({
    agentHandle: AGENT_HANDLE,
    conversationAnchorId: CONVERSATION_ANCHOR_ID,
  });
  assert.deepEqual(payload, { agentHandle: AGENT_HANDLE, conversationAnchorId: CONVERSATION_ANCHOR_ID });
  assert.deepEqual(parseAvatarLaunchContext(payload), {
    agentHandle: AGENT_HANDLE,
    conversationAnchorId: CONVERSATION_ANCHOR_ID,
    avatarInstanceId: null,
    launchSource: null,
  });
});

test('desktop avatar launcher rejects malformed handles and renderer-carried authority', async () => {
  assert.throws(
    () => buildDesktopAvatarLaunchHandoffPayload({ agentHandle: 'agent-1', conversationAnchorId: CONVERSATION_ANCHOR_ID }),
    /canonical agentHandle/,
  );
  for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
    await assert.rejects(
      prepareDesktopAvatarLaunchHandoffPayload({
        agentHandle: AGENT_HANDLE,
        conversationAnchorId: CONVERSATION_ANCHOR_ID,
        [field]: field === 'scopedBinding' ? { bindingId: 'binding-1' } : 'forbidden',
      } as never),
      /forbidden field/,
      `expected ${field} to be rejected before Avatar handoff`,
    );
  }
});

test('desktop avatar launcher invokes only the minimal launch handoff', async () => {
  const calls: unknown[] = [];
  const result = await launchDesktopAvatarHandoff({
    agentHandle: AGENT_HANDLE,
    conversationAnchorId: CONVERSATION_ANCHOR_ID,
    avatarInstanceId: 'instance-1',
    launchSource: 'desktop-agent-chat',
  }, {
    invokeLaunchHandoff: async (payload) => {
      calls.push(payload);
      return { opened: true, handoffUri: 'desktop-supervised-avatar://instance-1' };
    },
  });
  assert.deepEqual(calls, [{
    agentHandle: AGENT_HANDLE,
    conversationAnchorId: CONVERSATION_ANCHOR_ID,
    avatarInstanceId: 'instance-1',
    launchSource: 'desktop-agent-chat',
  }]);
  assert.equal(result.opened, true);
});

test('desktop avatar close handoff remains scoped to the host-owned instance id', async () => {
  const calls: string[] = [];
  await closeDesktopAvatarHandoff({
    avatarInstanceId: 'instance-1',
    closedBy: 'desktop',
    sourceSurface: 'desktop-agent-chat',
  }, {
    invokeCloseHandoff: async ({ avatarInstanceId }) => {
      calls.push(avatarInstanceId);
      return { opened: true, handoffUri: 'desktop-supervised-avatar://close/instance-1' };
    },
  });
  assert.deepEqual(calls, ['instance-1']);
});

test('desktop avatar launcher parses exact handoff results', () => {
  assert.deepEqual(
    parseDesktopAvatarLaunchHandoffResult({ opened: true, handoffUri: 'desktop-supervised-avatar://instance-1' }),
    { opened: true, handoffUri: 'desktop-supervised-avatar://instance-1' },
  );
  assert.throws(
    () => parseDesktopAvatarLaunchHandoffResult({ opened: 'true', handoffUri: 'invalid' }),
    /invalid opened/,
  );
  assert.throws(
    () => parseDesktopAvatarCloseHandoffResult({ opened: true, handoffUri: 42 }),
    /invalid handoffUri/,
  );
});
