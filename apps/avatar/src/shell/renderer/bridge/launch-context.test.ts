import { describe, expect, it } from 'vitest';
import { parseAvatarLaunchContext } from './launch-context.js';

const baseLaunchIdentity = {
  agentId: 'local-agent:opaque-launch',
  ownerUserId: 'owner-1',
  runtimeSourceRef: 'agent-launch',
  localAgentRef: 'local-agent:opaque-launch',
};

describe('parseAvatarLaunchContext', () => {
  it('accepts the minimal Desktop launch selector', () => {
    expect(parseAvatarLaunchContext({
      ...baseLaunchIdentity,
      avatarInstanceId: 'instance-1',
      launchSource: 'desktop-agent-chat',
    })).toEqual({
      ...baseLaunchIdentity,
      avatarInstanceId: 'instance-1',
      launchSource: 'desktop-agent-chat',
    });
  });

  it('accepts snake_case launch selector from the Tauri command boundary', () => {
    expect(parseAvatarLaunchContext({
      agent_id: baseLaunchIdentity.agentId,
      owner_user_id: baseLaunchIdentity.ownerUserId,
      runtime_source_ref: baseLaunchIdentity.runtimeSourceRef,
      local_agent_ref: baseLaunchIdentity.localAgentRef,
      avatar_instance_id: 'instance-1',
      launch_source: 'desktop-agent-chat',
    })).toEqual({
      ...baseLaunchIdentity,
      avatarInstanceId: 'instance-1',
      launchSource: 'desktop-agent-chat',
    });
  });

  it('rejects bare agent identity', () => {
    expect(() => parseAvatarLaunchContext({
      agentId: 'agent-launch',
      ownerUserId: baseLaunchIdentity.ownerUserId,
      runtimeSourceRef: baseLaunchIdentity.runtimeSourceRef,
      localAgentRef: 'agent-launch',
      avatarInstanceId: 'instance-1',
      launchSource: 'desktop-agent-chat',
    })).toThrow(/local-agent ref/);
  });

  it('rejects missing identity and auth truth in launch context', () => {
    expect(() => parseAvatarLaunchContext({
      agentId: baseLaunchIdentity.agentId,
      runtimeSourceRef: baseLaunchIdentity.runtimeSourceRef,
      localAgentRef: baseLaunchIdentity.localAgentRef,
    })).toThrow(/ownerUserId/);
    expect(() => parseAvatarLaunchContext({
      ...baseLaunchIdentity,
      jwt: 'secret',
    })).toThrow(/forbidden field: jwt/);
  });

  it('rejects inconsistent identity and conversation truth in launch context', () => {
    expect(() => parseAvatarLaunchContext({
      ...baseLaunchIdentity,
      localAgentRef: 'local-agent:other',
    })).toThrow(/agentId to equal localAgentRef/);
    for (const field of [
      'conversationAnchorId',
      'conversation_anchor_id',
    ]) {
      expect(() => parseAvatarLaunchContext({
        ...baseLaunchIdentity,
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
        ...baseLaunchIdentity,
        [field]: 'opaque-ref',
      })).toThrow(new RegExp(`forbidden field: ${field}`));
    }
  });
});
