import {
  buildAvatarLaunchHandoffPayload,
  parseAvatarLaunchHandoffResult,
  type AvatarLaunchHandoffPayload,
  type AvatarLaunchHandoffResult,
} from '@nimiplatform/kit/features/avatar/headless';
import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuAvatarLaunchAction } from './avatar-launch';

export type ZhiyuAvatarLaunchHandoff = {
  readonly payload: AvatarLaunchHandoffPayload;
};

export type ZhiyuAvatarLaunchResult =
  | {
      readonly state: 'opened';
      readonly reasonCode: 'zhiyu-avatar-launch-requested';
      readonly actionHint: 'inspect_avatar_window';
      readonly message: string;
      readonly handoff: AvatarLaunchHandoffResult;
    }
  | {
      readonly state: 'blocked';
      readonly reasonCode: string;
      readonly actionHint: string;
      readonly message: string;
    };

export type ZhiyuAvatarLaunchHostInvoker = (
  payload: AvatarLaunchHandoffPayload,
) => Promise<unknown>;

export type ZhiyuAvatarLaunchOptions = {
  readonly evidence: ZhiyuEvidence;
  readonly action: ZhiyuAvatarLaunchAction;
  readonly invokeHost?: ZhiyuAvatarLaunchHostInvoker;
};

declare global {
  interface Window {
    readonly __nimiZhiyuAvatarLaunchHandoff?: {
      invoke(command: string, payload: Record<string, unknown>): Promise<unknown>;
    };
  }
}

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
  const conversationAnchorId = requireText(input.evidence.conversation.conversationAnchorId, 'conversationAnchorId');
  const avatarInstanceId = input.action.avatarInstanceId;
  return {
    payload: buildAvatarLaunchHandoffPayload({
      agentHandle,
      conversationAnchorId,
      avatarInstanceId,
      sourceSurface: 'zhiyu',
    }),
  };
}

export async function launchZhiyuAvatar(
  options: ZhiyuAvatarLaunchOptions,
): Promise<ZhiyuAvatarLaunchResult> {
  try {
    const handoff = buildZhiyuAvatarLaunchHandoff(options);
    const rawResult = await (options.invokeHost ?? invokeZhiyuAvatarLaunchHandoff)(handoff.payload);
    const result = parseAvatarLaunchHandoffResult(rawResult);
    return {
      state: 'opened',
      reasonCode: 'zhiyu-avatar-launch-requested',
      actionHint: 'inspect_avatar_window',
      message: 'Avatar launch was requested through the public Runtime live-instance handoff.',
      handoff: result,
    };
  } catch (error) {
    return {
      state: 'blocked',
      reasonCode: errorField(error, 'reasonCode') || errorField(error, 'code') || 'zhiyu-avatar-launch-failed',
      actionHint: errorField(error, 'actionHint') || 'check_avatar_launch_handoff',
      message: error instanceof Error && error.message.trim()
        ? error.message.trim()
        : 'Avatar launch handoff failed closed.',
    };
  }
}

export async function invokeZhiyuAvatarLaunchHandoff(
  payload: AvatarLaunchHandoffPayload,
): Promise<unknown> {
  if (typeof window === 'undefined' || !window.__nimiZhiyuAvatarLaunchHandoff) {
    throw Object.assign(new Error('Zhiyu Avatar launch requires the Electron handoff bridge.'), {
      reasonCode: 'zhiyu-avatar-electron-handoff-unavailable',
      actionHint: 'restart_zhiyu_electron_shell',
      source: 'renderer',
    });
  }
  return window.__nimiZhiyuAvatarLaunchHandoff.invoke(
    'avatar.launch',
    payload as unknown as Record<string, unknown>,
  );
}

function requireText(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`Zhiyu Avatar launch requires ${field}`);
  }
  return normalized;
}

function errorField(error: unknown, key: string): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}
