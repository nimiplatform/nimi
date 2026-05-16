import { describe, expect, it } from 'vitest';
import { parseAvatarLaunchContext } from './launch-context.js';

describe('parseAvatarLaunchContext', () => {
  it('accepts the minimal Desktop launch selector', () => {
    expect(parseAvatarLaunchContext({
      agentId: 'agent-launch',
      avatarInstanceId: 'instance-1',
      launchSource: 'desktop-agent-chat',
    })).toEqual({
      agentId: 'agent-launch',
      avatarInstanceId: 'instance-1',
      launchSource: 'desktop-agent-chat',
    });
  });

  it('accepts snake_case launch selector from the Tauri command boundary', () => {
    expect(parseAvatarLaunchContext({
      agent_id: 'agent-launch',
      avatar_instance_id: 'instance-1',
      launch_source: 'desktop-agent-chat',
    })).toEqual({
      agentId: 'agent-launch',
      avatarInstanceId: 'instance-1',
      launchSource: 'desktop-agent-chat',
    });
  });

  it('rejects bare agent identity and auth truth in launch context', () => {
    expect(() => parseAvatarLaunchContext({
      agentId: 'agent-launch',
      ownerUserId: 'account-runtime',
    })).toThrow(/forbidden field: ownerUserId/);
    expect(() => parseAvatarLaunchContext({
      agentId: 'agent-launch',
      jwt: 'secret',
    })).toThrow(/forbidden field: jwt/);
  });

  it('rejects Runtime-owned identity and conversation truth in launch context', () => {
    for (const field of [
      'ownerUserId',
      'owner_user_id',
      'realmAgentId',
      'realm_agent_id',
      'localAgentRef',
      'local_agent_ref',
      'conversationAnchorId',
      'conversation_anchor_id',
    ]) {
      expect(() => parseAvatarLaunchContext({
        agentId: 'agent-launch',
        [field]: 'forbidden',
      })).toThrow(new RegExp(`forbidden field: ${field}`));
    }
  });

  it('rejects package refs and materialization fields in launch context', () => {
    for (const field of [
      'avatarPackageRef',
      'avatar_package_ref',
      'backendCapabilityProfileRef',
      'backend_capability_profile_ref',
      'materializationRef',
      'materialization_ref',
      'localMaterializationRef',
      'local_materialization_ref',
    ]) {
      expect(() => parseAvatarLaunchContext({
        agentId: 'agent-launch',
        [field]: 'opaque-ref',
      })).toThrow(new RegExp(`forbidden field: ${field}`));
    }
  });
});
