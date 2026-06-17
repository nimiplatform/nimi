import { describe, expect, it } from 'vitest';
import { parseAvatarLaunchContext } from './launch-context.js';

describe('parseAvatarLaunchContext', () => {
  it('accepts the minimal Desktop launch selector', () => {
    expect(parseAvatarLaunchContext({
      agentId: 'local-agent:owner-1:agent-launch',
      avatarInstanceId: 'instance-1',
      launchSource: 'desktop-agent-chat',
    })).toEqual({
      agentId: 'local-agent:owner-1:agent-launch',
      avatarInstanceId: 'instance-1',
      launchSource: 'desktop-agent-chat',
    });
  });

  it('accepts snake_case launch selector from the Tauri command boundary', () => {
    expect(parseAvatarLaunchContext({
      agent_id: 'local-agent:owner-1:agent-launch',
      avatar_instance_id: 'instance-1',
      launch_source: 'desktop-agent-chat',
    })).toEqual({
      agentId: 'local-agent:owner-1:agent-launch',
      avatarInstanceId: 'instance-1',
      launchSource: 'desktop-agent-chat',
    });
  });

  it('rejects bare agent identity', () => {
    expect(() => parseAvatarLaunchContext({
      agentId: 'agent-launch',
      avatarInstanceId: 'instance-1',
      launchSource: 'desktop-agent-chat',
    })).toThrow(/local-agent ref/);
  });

  it('rejects bare agent identity and auth truth in launch context', () => {
    expect(() => parseAvatarLaunchContext({
      agentId: 'local-agent:owner-1:agent-launch',
      ownerUserId: 'account-runtime',
    })).toThrow(/forbidden field: ownerUserId/);
    expect(() => parseAvatarLaunchContext({
      agentId: 'local-agent:owner-1:agent-launch',
      jwt: 'secret',
    })).toThrow(/forbidden field: jwt/);
  });

  it('rejects Runtime-owned identity and conversation truth in launch context', () => {
    for (const field of [
      'ownerUserId',
      'owner_user_id',
      'runtimeSourceRef',
      'runtime_source_ref',
      'localAgentRef',
      'local_agent_ref',
      'conversationAnchorId',
      'conversation_anchor_id',
    ]) {
      expect(() => parseAvatarLaunchContext({
        agentId: 'local-agent:owner-1:agent-launch',
        [field]: 'forbidden',
      })).toThrow(new RegExp(`forbidden field: ${field}`));
    }
  });

  it('rejects backend capability and materialization fields in launch context', () => {
    for (const field of [
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
    ]) {
      expect(() => parseAvatarLaunchContext({
        agentId: 'local-agent:owner-1:agent-launch',
        [field]: 'opaque-ref',
      })).toThrow(new RegExp(`forbidden field: ${field}`));
    }
  });
});
