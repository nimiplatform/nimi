import {
  buildAvatarHostHandoffRequest,
  invokeAvatarHostHandoff,
  type AvatarHostHandoffPort,
  type AvatarHostHandoffRequest,
  type AvatarHostHandoffResult,
} from '@nimiplatform/kit/features/avatar/headless';
import { confirmDialog } from '@nimiplatform/kit/shell/renderer/bridge';
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
  readonly confirmSwitch?: () => Promise<boolean>;
};

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r011
// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r012
export function buildZhiyuAvatarLaunchHandoff(input: {
  readonly evidence: ZhiyuEvidence;
  readonly action: ZhiyuAvatarLaunchAction;
  readonly switchIntentRef?: string | null;
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
        switchIntentRef: input.switchIntentRef ?? null,
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
    let handoff = buildZhiyuAvatarLaunchHandoff(options);
    let result = await invokeAvatarHostHandoff(options.hostPort, handoff.request);
    if (handoff.request.command === 'launch' && result.state === 'confirmation-required') {
      const confirmed = await (options.confirmSwitch
        ? options.confirmSwitch()
        : confirmZhiyuAvatarSwitch());
      if (!confirmed) {
        return {
          state: 'blocked',
          reasonCode: 'zhiyu-avatar-switch-cancelled',
          actionHint: 'keep_current_companion',
          message: 'Kept the current desktop companion.',
        };
      }
      handoff = buildZhiyuAvatarLaunchHandoff({
        evidence: options.evidence,
        action: options.action,
        switchIntentRef: result.switchIntentRef,
      });
      result = await invokeAvatarHostHandoff(options.hostPort, handoff.request);
      if (result.state === 'confirmation-required') {
        throw Object.assign(new Error('Avatar Host switch confirmation did not converge.'), {
          reasonCode: 'zhiyu-avatar-switch-confirmation-invalid',
          actionHint: 'retry_avatar_host_handoff',
        });
      }
    }
    if (result.state !== 'present' && result.state !== 'focused') {
      return {
        state: 'blocked',
        reasonCode: `zhiyu-avatar-host-${result.command}-${result.state}`,
        actionHint: 'retry_avatar_host_handoff',
        message: `Avatar Host ${result.command} did not establish a present window.`,
      };
    }
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

async function confirmZhiyuAvatarSwitch(): Promise<boolean> {
  const result = await confirmDialog({
    title: 'Switch current companion?',
    description: 'Another companion is already active. Switch the desktop companion to this Agent?',
    level: 'warning',
  });
  return result.confirmed;
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
