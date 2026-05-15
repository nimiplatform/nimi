import { describe, expect, it } from 'vitest';
import { parseAvatarLaunchContext } from './launch-context.js';

describe('parseAvatarLaunchContext', () => {
  it('accepts the minimal Desktop launch selector', () => {
    expect(parseAvatarLaunchContext({
      ownerUserId: 'account-runtime',
      realmAgentId: 'agent-launch',
      localAgentRef: 'local-agent:account-runtime:agent-launch',
      conversationAnchorId: 'anchor-1',
      avatarInstanceId: 'instance-1',
      launchSource: 'desktop-agent-chat',
    })).toEqual({
      ownerUserId: 'account-runtime',
      realmAgentId: 'agent-launch',
      localAgentRef: 'local-agent:account-runtime:agent-launch',
      conversationAnchorId: 'anchor-1',
      avatarInstanceId: 'instance-1',
      launchSource: 'desktop-agent-chat',
    });
  });

  it('accepts snake_case launch selector from the Tauri command boundary', () => {
    expect(parseAvatarLaunchContext({
      owner_user_id: 'account-runtime',
      realm_agent_id: 'agent-launch',
      local_agent_ref: 'local-agent:account-runtime:agent-launch',
      conversation_anchor_id: 'anchor-1',
      avatar_instance_id: 'instance-1',
      launch_source: 'desktop-agent-chat',
    })).toEqual({
      ownerUserId: 'account-runtime',
      realmAgentId: 'agent-launch',
      localAgentRef: 'local-agent:account-runtime:agent-launch',
      conversationAnchorId: 'anchor-1',
      avatarInstanceId: 'instance-1',
      launchSource: 'desktop-agent-chat',
    });
  });

  it('rejects bare agent identity and auth truth in launch context', () => {
    expect(() => parseAvatarLaunchContext({
      agent_id: 'agent-launch',
      ownerUserId: 'account-runtime',
      realmAgentId: 'agent-launch',
      localAgentRef: 'local-agent:account-runtime:agent-launch',
    })).toThrow(/forbidden field: agent_id/);
    expect(() => parseAvatarLaunchContext({
      ownerUserId: 'account-runtime',
      realmAgentId: 'agent-launch',
      localAgentRef: 'local-agent:account-runtime:agent-launch',
      jwt: 'secret',
    })).toThrow(/forbidden field: jwt/);
  });
});
