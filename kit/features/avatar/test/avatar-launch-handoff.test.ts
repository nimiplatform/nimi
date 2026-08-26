import { describe, expect, it } from 'vitest';
import {
  buildAvatarLaunchHandoffPayload,
  buildAvatarLaunchInstanceId,
  parseAvatarLaunchHandoffPayload,
  parseAvatarLaunchHandoffResult,
} from '../src/headless';

const LOCAL_AGENT = 'local-agent:owner-1:agent-1';
const AGENT_HANDLE = `agent_ref_${'a'.repeat(43)}`;
const CONVERSATION_ANCHOR_ID = 'anchor-1';

describe('avatar launch handoff', () => {
  it('builds the canonical Conversation launch payload without auth custody', () => {
    const avatarInstanceId = buildAvatarLaunchInstanceId({
      agentId: LOCAL_AGENT,
      sourceSurface: 'zhiyu',
    });

    expect(avatarInstanceId).toBe('zhiyu-avatar-local-agent-owner-1-agent-1');
    expect(avatarInstanceId).not.toContain('anchor');

    const payload = buildAvatarLaunchHandoffPayload({
      agentId: LOCAL_AGENT,
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: CONVERSATION_ANCHOR_ID,
      avatarInstanceId,
      sourceSurface: 'zhiyu',
    });

    expect(payload).toEqual({
      agentId: LOCAL_AGENT,
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: CONVERSATION_ANCHOR_ID,
      avatarInstanceId,
      launchSource: 'zhiyu',
    });
    expect(JSON.stringify(payload)).not.toMatch(/accessToken|subjectUserId|runtimeAppId/);
  });

  it('parses the same payload shape that Avatar Electron consumes', () => {
    expect(parseAvatarLaunchHandoffPayload({
      agentId: LOCAL_AGENT,
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: CONVERSATION_ANCHOR_ID,
      avatarInstanceId: 'avatar-instance:1',
      launchSource: 'zhiyu',
    })).toEqual({
      agentId: LOCAL_AGENT,
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: CONVERSATION_ANCHOR_ID,
      avatarInstanceId: 'avatar-instance:1',
      launchSource: 'zhiyu',
    });
  });

  it('fails closed on parallel truth, private auth, or malformed local identity fields', () => {
    expect(() => parseAvatarLaunchHandoffPayload({
      agentId: LOCAL_AGENT,
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: CONVERSATION_ANCHOR_ID,
      ownerUserId: 'user-1',
      runtimeSourceRef: 'runtime-source:owner-1',
      localAgentRef: LOCAL_AGENT,
    })).toThrow(/forbidden field: ownerUserId/);

    expect(() => parseAvatarLaunchHandoffPayload({
      agentId: LOCAL_AGENT,
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: CONVERSATION_ANCHOR_ID,
      ownerUserId: 'user-1',
      runtimeSourceRef: 'runtime-source:owner-1',
      localAgentRef: LOCAL_AGENT,
      accessToken: 'secret',
    })).toThrow(/forbidden field: accessToken/);

    expect(() => buildAvatarLaunchHandoffPayload({
      agentId: LOCAL_AGENT,
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: CONVERSATION_ANCHOR_ID,
      localAgentRef: LOCAL_AGENT,
      sourceSurface: 'zhiyu',
    } as never)).toThrow(/forbidden field: localAgentRef/);

    expect(() => buildAvatarLaunchHandoffPayload({
      agentId: 'agent-1',
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: CONVERSATION_ANCHOR_ID,
      sourceSurface: 'zhiyu',
    })).toThrow(/agentId to be a local-agent ref/);
  });

  it('normalizes host launch results without pretending that a blocked launch opened', () => {
    expect(parseAvatarLaunchHandoffResult({
      opened: true,
      avatarInstanceId: 'avatar-instance:1',
      handoffUri: 'electron:avatar',
      launchSource: 'zhiyu',
      pid: 1234,
    })).toEqual({
      opened: true,
      avatarInstanceId: 'avatar-instance:1',
      handoffUri: 'electron:avatar',
      launchSource: 'zhiyu',
      pid: 1234,
    });

    expect(() => parseAvatarLaunchHandoffResult({
      opened: false,
      reasonCode: 'avatar-main-missing',
    })).toThrow(/Avatar launch handoff did not open/);
  });
});
