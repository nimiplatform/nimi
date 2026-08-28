import { describe, expect, it } from 'vitest';
import {
  buildAvatarLaunchHandoffPayload,
  buildAvatarLaunchInstanceId,
  parseAvatarLaunchHandoffPayload,
  parseAvatarLaunchHandoffResult,
  parseAvatarRendererLaunchContext,
} from '../src/headless';

const AGENT_HANDLE = `agent_ref_${'a'.repeat(43)}`;
const CONVERSATION_ANCHOR_ID = 'anchor-1';

describe('avatar launch handoff', () => {
  it('builds the canonical Conversation launch payload without auth custody', () => {
    const avatarInstanceId = buildAvatarLaunchInstanceId({
      agentHandle: AGENT_HANDLE,
      sourceSurface: 'zhiyu',
    });

    expect(avatarInstanceId).toBe(`zhiyu-avatar-agent-ref-${'a'.repeat(43)}`);
    expect(avatarInstanceId).not.toContain('anchor');

    const payload = buildAvatarLaunchHandoffPayload({
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: CONVERSATION_ANCHOR_ID,
      avatarInstanceId,
      sourceSurface: 'zhiyu',
    });

    expect(payload).toEqual({
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: CONVERSATION_ANCHOR_ID,
      avatarInstanceId,
      launchSource: 'zhiyu',
    });
    expect(JSON.stringify(payload)).not.toMatch(/accessToken|subjectUserId|runtimeAppId/);
  });

  it('parses the same payload shape that Avatar Electron consumes', () => {
    expect(parseAvatarLaunchHandoffPayload({
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: CONVERSATION_ANCHOR_ID,
      avatarInstanceId: 'avatar-instance:1',
      launchSource: 'zhiyu',
    })).toEqual({
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: CONVERSATION_ANCHOR_ID,
      avatarInstanceId: 'avatar-instance:1',
      launchSource: 'zhiyu',
    });
  });

  it('projects a strict renderer launch context without raw LocalAgent identity', () => {
    expect(parseAvatarRendererLaunchContext({
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: CONVERSATION_ANCHOR_ID,
      avatarInstanceId: 'avatar-instance:1',
      launchSource: 'zhiyu',
    })).toEqual({
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: CONVERSATION_ANCHOR_ID,
      avatarInstanceId: 'avatar-instance:1',
      launchSource: 'zhiyu',
    });
    expect(() => parseAvatarRendererLaunchContext({
      agentId: 'local-agent:owner-1:agent-1',
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: CONVERSATION_ANCHOR_ID,
    })).toThrow(/forbidden field: agentId/u);
  });

  it('fails closed on parallel truth, private auth, or malformed local identity fields', () => {
    expect(() => parseAvatarLaunchHandoffPayload({
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: CONVERSATION_ANCHOR_ID,
      ownerUserId: 'user-1',
      runtimeSourceRef: 'runtime-source:owner-1',
      localAgentRef: 'local-agent:owner-1:agent-1',
    })).toThrow(/forbidden field: ownerUserId/);

    expect(() => parseAvatarLaunchHandoffPayload({
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: CONVERSATION_ANCHOR_ID,
      accessToken: 'secret',
    })).toThrow(/forbidden field: accessToken/);

    expect(() => buildAvatarLaunchHandoffPayload({
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: CONVERSATION_ANCHOR_ID,
      localAgentRef: 'local-agent:owner-1:agent-1',
      sourceSurface: 'zhiyu',
    } as never)).toThrow(/forbidden field: localAgentRef/);

    expect(() => buildAvatarLaunchHandoffPayload({
      agentHandle: 'agent-1',
      conversationAnchorId: CONVERSATION_ANCHOR_ID,
      sourceSurface: 'zhiyu',
    })).toThrow(/requires a canonical agentHandle/);
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
