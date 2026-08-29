import {
  buildAvatarHostHandoffRequest,
  invokeAvatarHostHandoff,
  type AvatarHostHandoffPort,
  type AvatarHostHandoffRequest,
  type AvatarHostHandoffResult,
} from '@nimiplatform/kit/features/avatar/headless';
import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuAvatarLaunchAction } from './avatar-launch';

export type ZhiyuAvatarLaunchHandoff = {
  readonly request: AvatarHostHandoffRequest;
};

export type ZhiyuAvatarLaunchResult =
  | {
      readonly state: 'opened';
      readonly reasonCode: 'zhiyu-avatar-launch-requested';
      readonly actionHint: 'inspect_avatar_window';
      readonly message: string;
      readonly handoff: AvatarHostHandoffResult;
    }
  | {
      readonly state: 'blocked';
      readonly reasonCode: string;
      readonly actionHint: string;
      readonly message: string;
    };

export type ZhiyuAvatarLaunchOptions = {
  readonly evidence: ZhiyuEvidence;
  readonly action: ZhiyuAvatarLaunchAction;
  readonly hostPort?: AvatarHostHandoffPort;
};

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r011
// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r012
export function buildZhiyuAvatarLaunchHandoff(input: {
  readonly evidence: ZhiyuEvidence;
  readonly action: ZhiyuAvatarLaunchAction;
}): ZhiyuAvatarLaunchHandoff {
  if (input.action.state !== 'ready') {
    throw new Error(`Zhiyu Avatar launch is not ready: ${input.action.reasonCode}`);
  }
  const agentHandle = requireText(input.evidence.conversation.agentHandle, 'agentHandle');
  const conversationAnchorId = requireText(
    input.evidence.conversation.conversationAnchorId,
    'conversationAnchorId',
  );
  return {
    request: buildAvatarHostHandoffRequest({
      command: input.action.command,
      target: {
        agentHandle,
        conversationAnchorId,
        avatarInstanceId: input.action.avatarInstanceId,
        launchSource: 'zhiyu',
        committedPresentationRef: input.evidence.avatar.hostHandoff?.committedPresentationRef ?? null,
        temporaryCustodyRef: input.evidence.avatar.hostHandoff?.temporaryCustodyRef ?? null,
      },
    }),
  };
}

export async function launchZhiyuAvatar(
  options: ZhiyuAvatarLaunchOptions,
): Promise<ZhiyuAvatarLaunchResult> {
  try {
    if (!options.hostPort) {
      throw Object.assign(new Error('Zhiyu Avatar launch requires the common Host handoff port.'), {
        reasonCode: 'zhiyu-avatar-host-handoff-unavailable',
        actionHint: 'restart_desktop_supervised_zhiyu',
        source: 'host',
      });
    }
    const handoff = buildZhiyuAvatarLaunchHandoff(options);
    const result = await invokeAvatarHostHandoff(options.hostPort, handoff.request);
    return {
      state: 'opened',
      reasonCode: 'zhiyu-avatar-launch-requested',
      actionHint: 'inspect_avatar_window',
      message: `Avatar Host ${result.command} completed with ${result.state} state.`,
      handoff: result,
    };
  } catch (error) {
    return {
      state: 'blocked',
      reasonCode: errorField(error, 'reasonCode') || errorField(error, 'code') || 'zhiyu-avatar-launch-failed',
      actionHint: errorField(error, 'actionHint') || 'check_avatar_host_handoff',
      message: error instanceof Error && error.message.trim()
        ? error.message.trim()
        : 'Avatar Host handoff failed closed.',
    };
  }
}

function requireText(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`Zhiyu Avatar launch requires ${field}`);
  return normalized;
}

function errorField(error: unknown, key: string): string {
  if (!error || typeof error !== 'object') return '';
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}
