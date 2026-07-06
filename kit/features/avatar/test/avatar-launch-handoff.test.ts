import { describe, expect, it } from 'vitest';
import {
  buildAvatarLaunchHandoffPayload,
  buildAvatarLaunchInstanceId,
  parseAvatarLaunchHandoffPayload,
  parseAvatarLaunchHandoffResult,
} from '../src/headless';

const LOCAL_AGENT = 'local-agent:owner-1:agent-1';
const RUNTIME_SOURCE = 'runtime-source:owner-1';
const OWNER = 'user-1';

describe('avatar launch handoff', () => {
  it('builds the minimal public launch payload without Runtime anchor or auth custody', () => {
    const avatarInstanceId = buildAvatarLaunchInstanceId({
      localAgentRef: LOCAL_AGENT,
      sourceSurface: 'zhiyu',
    });

    expect(avatarInstanceId).toBe('zhiyu-avatar-local-agent-owner-1-agent-1');
    expect(avatarInstanceId).not.toContain('anchor');

    const payload = buildAvatarLaunchHandoffPayload({
      ownerUserId: OWNER,
      runtimeSourceRef: RUNTIME_SOURCE,
      localAgentRef: LOCAL_AGENT,
      avatarInstanceId,
      sourceSurface: 'zhiyu',
    });

    expect(payload).toEqual({
      agentId: LOCAL_AGENT,
      ownerUserId: OWNER,
      runtimeSourceRef: RUNTIME_SOURCE,
      localAgentRef: LOCAL_AGENT,
      avatarInstanceId,
      launchSource: 'zhiyu',
    });
    expect(JSON.stringify(payload)).not.toMatch(/conversationAnchorId|accessToken|subjectUserId|runtimeAppId/);
  });

  it('parses the same payload shape that Avatar Electron consumes', () => {
    expect(parseAvatarLaunchHandoffPayload({
      agentId: LOCAL_AGENT,
      ownerUserId: OWNER,
      runtimeSourceRef: RUNTIME_SOURCE,
      localAgentRef: LOCAL_AGENT,
      avatarInstanceId: 'avatar-instance:1',
      launchSource: 'zhiyu',
    })).toEqual({
      agentId: LOCAL_AGENT,
      ownerUserId: OWNER,
      runtimeSourceRef: RUNTIME_SOURCE,
      localAgentRef: LOCAL_AGENT,
      avatarInstanceId: 'avatar-instance:1',
      launchSource: 'zhiyu',
    });
  });

  it('fails closed on parallel truth, private auth, or malformed local identity fields', () => {
    expect(() => parseAvatarLaunchHandoffPayload({
      agentId: LOCAL_AGENT,
      ownerUserId: OWNER,
      runtimeSourceRef: RUNTIME_SOURCE,
      localAgentRef: LOCAL_AGENT,
      conversationAnchorId: 'anchor-1',
    })).toThrow(/forbidden field: conversationAnchorId/);

    expect(() => parseAvatarLaunchHandoffPayload({
      agentId: LOCAL_AGENT,
      ownerUserId: OWNER,
      runtimeSourceRef: RUNTIME_SOURCE,
      localAgentRef: LOCAL_AGENT,
      accessToken: 'secret',
    })).toThrow(/forbidden field: accessToken/);

    expect(() => buildAvatarLaunchHandoffPayload({
      ownerUserId: OWNER,
      runtimeSourceRef: LOCAL_AGENT,
      localAgentRef: LOCAL_AGENT,
      sourceSurface: 'zhiyu',
    })).toThrow(/localAgentRef to be Runtime-owned/);

    expect(() => buildAvatarLaunchHandoffPayload({
      ownerUserId: OWNER,
      runtimeSourceRef: RUNTIME_SOURCE,
      localAgentRef: 'agent-1',
      sourceSurface: 'zhiyu',
    })).toThrow(/localAgentRef to be a local-agent ref/);
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
