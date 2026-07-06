import {
  arbitrateAvatarLaunch,
  buildAvatarLaunchInstanceId,
  type AvatarLaunchArbitrationResult,
} from '@nimiplatform/kit/features/avatar/headless';
import type { ZhiyuEvidence } from '../app/evidence';

export type ZhiyuAvatarLaunchAction =
  | {
      readonly state: 'hidden';
      readonly reasonCode: string;
      readonly message: string;
    }
  | {
      readonly state: 'blocked';
      readonly reasonCode: string;
      readonly message: string;
    }
  | {
      readonly state: 'ready';
      readonly reasonCode: 'zhiyu-avatar-launch-ready';
      readonly message: string;
      readonly avatarInstanceId: string;
    };

export function projectZhiyuAvatarLaunchAction(evidence: ZhiyuEvidence): ZhiyuAvatarLaunchAction {
  const ownerUserId = evidence.conversation.ownerUserId ?? evidence.localAgent.ownerUserId;
  const runtimeSourceRef = evidence.conversation.runtimeSourceRef ?? evidence.localAgent.runtimeSourceRef;
  const localAgentRef = evidence.conversation.localAgentRef ?? evidence.localAgent.localAgentRef;
  const conversationAnchorId = evidence.conversation.conversationAnchorId;
  if (
    !evidence.localAgent.ready
    || !evidence.conversation.ready
    || !ownerUserId
    || !runtimeSourceRef
    || !localAgentRef
    || !conversationAnchorId
  ) {
    return {
      state: 'hidden',
      reasonCode: 'zhiyu-avatar-launch-current-partner-required',
      message: 'Avatar launch requires a current Runtime-owned local partner and conversation anchor.',
    };
  }
  if (!evidence.avatar.launchAvailable) {
    return {
      state: 'blocked',
      reasonCode: 'zhiyu-avatar-public-handoff-not-admitted',
      message: 'Avatar launch is waiting for an admitted public handoff projection; Zhiyu will not import Desktop private bridge code.',
    };
  }

  let avatarInstanceId: string;
  try {
    avatarInstanceId = buildAvatarLaunchInstanceId({
      localAgentRef,
      sourceSurface: 'zhiyu',
    });
  } catch {
    return {
      state: 'blocked',
      reasonCode: 'zhiyu-avatar-local-agent-identity-invalid',
      message: 'Avatar launch requires an admitted Runtime-owned local-agent identity.',
    };
  }
  const arbitration = arbitrateAvatarLaunch({
    avatarInstancePolicy: 'reuse_active_instance',
    trigger: 'explicit_user_action',
    localAgentRef,
    conversationAnchorId,
    reuseInstanceId: avatarInstanceId,
    newInstanceId: `${avatarInstanceId}-new`,
    liveInstances: [],
    newInstanceAlreadySpawnedForThisOpenEvent: false,
  });

  return avatarActionFromArbitration(arbitration);
}

function avatarActionFromArbitration(
  arbitration: AvatarLaunchArbitrationResult,
): ZhiyuAvatarLaunchAction {
  if (arbitration.decision === 'launch_instance' || arbitration.decision === 'reuse_instance') {
    return {
      state: 'ready',
      reasonCode: 'zhiyu-avatar-launch-ready',
      message: 'Avatar launch can be requested through the admitted public handoff.',
      avatarInstanceId: arbitration.avatarInstanceId,
    };
  }
  if (arbitration.decision === 'require_user_selection') {
    return {
      state: 'blocked',
      reasonCode: 'zhiyu-avatar-instance-selection-required',
      message: 'Choose which Avatar instance should attach to this partner before launching.',
    };
  }
  return {
    state: 'blocked',
    reasonCode: `zhiyu-avatar-${arbitration.state}`,
    message: 'Avatar launch arbitration failed closed.',
  };
}
