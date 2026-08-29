import {
  buildAvatarHostHandoffRequest,
  buildAvatarLaunchInstanceId,
  invokeAvatarHostHandoff,
  type AvatarHostHandoffPort,
  type AvatarHostHandoffTarget,
} from '@nimiplatform/kit/features/avatar/headless';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import type { ZhiyuConversationHomeStatus } from '../agent/conversation-home';
import type { ZhiyuEvidence } from '../app/evidence';

export type ZhiyuAvatarPresenceStatus = ZhiyuEvidence['avatar'];
type ZhiyuAvatarHostTarget = AvatarHostHandoffTarget & Readonly<{
  readonly agentHandle: NimiLocalAppAgentHandle;
}>;

export interface ZhiyuAvatarPresenceProbeOptions {
  readonly hostPort?: AvatarHostHandoffPort;
}

// Host presence is mechanical evidence only. Product launch availability is
// derived from the current formal Agent plus exact Conversation anchor.
// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r011
export async function probeZhiyuAvatarPresence(
  conversation: ZhiyuConversationHomeStatus,
  options: ZhiyuAvatarPresenceProbeOptions = {},
): Promise<ZhiyuAvatarPresenceStatus> {
  const target = zhiyuAvatarHostTarget(conversation);
  if (!target) {
    return avatarUnavailable({
      reasonCode: 'zhiyu-avatar-current-conversation-required',
      actionHint: 'open_runtime_conversation_anchor',
      source: conversation.source,
      message: 'Avatar launch requires the current formal Agent and exact Conversation anchor.',
      agentHandle: conversation.agentHandle,
      conversationAnchorId: conversation.conversationAnchorId,
    });
  }

  if (!options.hostPort) {
    return avatarUnavailable({
      reasonCode: 'zhiyu-avatar-host-presence-unavailable',
      actionHint: 'restart_desktop_supervised_zhiyu',
      source: 'host',
      message: 'Avatar Host presence cannot be resolved without the common Host handoff port.',
      agentHandle: target.agentHandle,
      conversationAnchorId: target.conversationAnchorId,
    });
  }

  try {
    const hostHandoff = await invokeAvatarHostHandoff(
      options.hostPort,
      buildAvatarHostHandoffRequest({ command: 'presence', target }),
    );
    if (hostHandoff.state === 'launching' || hostHandoff.state === 'closing') {
      return avatarUnavailable({
        reasonCode: `zhiyu-avatar-host-${hostHandoff.state}`,
        actionHint: 'retry_avatar_host_handoff',
        source: 'host',
        message: `Avatar Host presence is ${hostHandoff.state}; a new handoff is not admitted yet.`,
        agentHandle: target.agentHandle,
        conversationAnchorId: target.conversationAnchorId,
        hostHandoff,
      });
    }
    return avatarAvailable({
      target,
      reasonCode: `zhiyu-avatar-host-${hostHandoff.state}`,
      actionHint: hostHandoff.state === 'present' || hostHandoff.state === 'focused'
        ? 'focus_avatar_through_host_port'
        : 'launch_avatar_through_host_port',
      source: 'host',
      message: `Avatar Host presence is ${hostHandoff.state}.`,
      hostHandoff,
    });
  } catch (error) {
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    return avatarUnavailable({
      reasonCode: text(record.reasonCode) || text(record.code) || 'zhiyu-avatar-host-presence-unavailable',
      actionHint: text(record.actionHint) || 'retry_avatar_host_handoff',
      source: text(record.source) || 'host',
      message: error instanceof Error && error.message.trim()
        ? error.message.trim()
        : 'Avatar Host presence is unavailable.',
      agentHandle: target.agentHandle,
      conversationAnchorId: target.conversationAnchorId,
    });
  }
}

export function zhiyuAvatarHostTarget(
  conversation: ZhiyuConversationHomeStatus,
): ZhiyuAvatarHostTarget | null {
  if (!conversation.ready || !conversation.agentHandle || !conversation.conversationAnchorId) return null;
  return {
    agentHandle: conversation.agentHandle,
    conversationAnchorId: conversation.conversationAnchorId,
    avatarInstanceId: buildAvatarLaunchInstanceId({
      agentHandle: conversation.agentHandle,
      sourceSurface: 'zhiyu',
    }),
    launchSource: 'zhiyu',
    committedPresentationRef: null,
    temporaryCustodyRef: null,
  };
}

function avatarAvailable(input: {
  readonly target: ZhiyuAvatarHostTarget;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly hostHandoff: ZhiyuAvatarPresenceStatus['hostHandoff'];
}): ZhiyuAvatarPresenceStatus {
  return {
    transport: 'electron-ipc',
    ready: true,
    state: 'projected',
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    agentHandle: input.target.agentHandle,
    conversationAnchorId: input.target.conversationAnchorId ?? null,
    launchAvailable: true,
    hostHandoff: input.hostHandoff,
  };
}

function avatarUnavailable(input: {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly agentHandle?: ZhiyuConversationHomeStatus['agentHandle'];
  readonly conversationAnchorId?: string | null;
  readonly hostHandoff?: ZhiyuAvatarPresenceStatus['hostHandoff'];
}): ZhiyuAvatarPresenceStatus {
  return {
    transport: 'electron-ipc',
    ready: false,
    state: 'blocked',
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    agentHandle: input.agentHandle ?? null,
    conversationAnchorId: input.conversationAnchorId ?? null,
    launchAvailable: false,
    hostHandoff: input.hostHandoff ?? null,
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
