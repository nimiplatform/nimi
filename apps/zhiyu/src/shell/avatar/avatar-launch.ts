import {
  buildAvatarLaunchInstanceId,
  type AvatarHostHandoffCommand,
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
      readonly command: Extract<AvatarHostHandoffCommand, 'launch' | 'focus'>;
    };

export function projectZhiyuAvatarLaunchAction(evidence: ZhiyuEvidence): ZhiyuAvatarLaunchAction {
  const agentHandle = evidence.conversation.agentHandle;
  const conversationAnchorId = evidence.conversation.conversationAnchorId;
  if (
    !evidence.localAgent.ready
    || !evidence.conversation.ready
    || !agentHandle
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
      agentHandle,
      sourceSurface: 'zhiyu',
    });
  } catch {
    return {
      state: 'blocked',
      reasonCode: 'zhiyu-avatar-local-agent-identity-invalid',
      message: 'Avatar launch requires an admitted Runtime-owned local-agent identity.',
    };
  }
  return {
    state: 'ready',
    reasonCode: 'zhiyu-avatar-launch-ready',
    message: 'Avatar launch can be requested through the common Host handoff port.',
    avatarInstanceId,
    command: evidence.avatar.hostHandoff?.state === 'present'
      || evidence.avatar.hostHandoff?.state === 'focused'
      ? 'focus'
      : 'launch',
  };
}
