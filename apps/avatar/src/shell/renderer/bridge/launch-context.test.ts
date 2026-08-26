import { describe, expect, it } from 'vitest';
import { parseAvatarLaunchContext } from './launch-context.js';

const baseLaunchIdentity = {
  agentId: 'local-agent:opaque-launch',
  agentHandle: `agent_ref_${'a'.repeat(43)}`,
  conversationAnchorId: 'anchor-1',
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
      agent_handle: baseLaunchIdentity.agentHandle,
      conversation_anchor_id: baseLaunchIdentity.conversationAnchorId,
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
      agentHandle: baseLaunchIdentity.agentHandle,
      conversationAnchorId: baseLaunchIdentity.conversationAnchorId,
      avatarInstanceId: 'instance-1',
      launchSource: 'desktop-agent-chat',
    })).toThrow(/local-agent ref/);
  });

  it('rejects Runtime identity and auth truth in launch context', () => {
    expect(() => parseAvatarLaunchContext({
      agentId: baseLaunchIdentity.agentId,
      ownerUserId: 'owner-1',
    })).toThrow(/ownerUserId/);
    expect(() => parseAvatarLaunchContext({
      ...baseLaunchIdentity,
      jwt: 'secret',
    })).toThrow(/forbidden field: jwt/);
  });

  it('rejects raw Runtime identity truth in launch context', () => {
    for (const field of ['runtimeSourceRef', 'localAgentRef']) {
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
