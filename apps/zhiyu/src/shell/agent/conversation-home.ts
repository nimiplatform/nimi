import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import type { ZhiyuEvidence } from '../app/evidence';
import { getZhiyuLocalAppClient } from '../auth/runtime-platform';
import type { ZhiyuLocalAgentStatus } from './local-agent-status';

export type ZhiyuConversationHomeStatus = ZhiyuEvidence['conversation'];
type LocalAgentIdentity = {
  readonly agentHandle: NimiLocalAppAgentHandle;
};

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r003
export async function probeZhiyuRuntimeConversationHome(
  localAgent: ZhiyuLocalAgentStatus,
): Promise<ZhiyuConversationHomeStatus> {
  const identity = localAgentIdentity(localAgent);
  if (!identity) {
    return conversationUnavailable({
      reasonCode: 'zhiyu-local-agent-required',
      actionHint: localAgent.actionHint || 'wait_for_app_access_admission',
      source: localAgent.source,
      message: 'Zhiyu requires a Runtime-inventory Agent before opening a conversation.',
      agentHandle: localAgent.agentHandle,
      ownerUserId: localAgent.ownerUserId,
      runtimeSourceRef: localAgent.runtimeSourceRef,
      localAgentRef: localAgent.localAgentRef,
    });
  }
  if (typeof window === 'undefined' || !hasElectronRuntime()) {
    return conversationUnavailable({
      reasonCode: 'electron-runtime-bridge-unavailable',
      actionHint: 'restart_zhiyu_electron_shell',
      source: 'renderer',
      message: 'Electron local-app bridge is not available.',
      ...identity,
    });
  }

  const conversation = getZhiyuLocalAppClient().conversation;
  try {
    const opened = await conversation.open({
      agentHandle: identity.agentHandle,
    });
    return conversationReady(identity, opened.conversationAnchorId);
  } catch (error) {
    return normalizeConversationError(error, identity);
  }
}

function conversationReady(
  identity: LocalAgentIdentity,
  conversationAnchorId: string,
): ZhiyuConversationHomeStatus {
  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'conversation-anchor-open',
    actionHint: 'send_runtime_agent_turn',
    source: 'runtime',
    message: 'Runtime-owned conversation anchor is open through localApp.conversation.',
    agentHandle: identity.agentHandle,
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
    conversationAnchorId,
    threadId: conversationAnchorId,
  };
}

function localAgentIdentity(localAgent: ZhiyuLocalAgentStatus): LocalAgentIdentity | null {
  if (!localAgent.ready) return null;
  return localAgent.agentHandle ? { agentHandle: localAgent.agentHandle } : null;
}

function normalizeConversationError(error: unknown, identity: LocalAgentIdentity): ZhiyuConversationHomeStatus {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  return conversationUnavailable({
    reasonCode: stringOr(record.reasonCode, 'zhiyu-conversation-anchor-unavailable'),
    actionHint: stringOr(record.actionHint, 'check_local_app_conversation'),
    source: stringOr(record.source, 'sdk'),
    message: error instanceof Error && error.message.trim() ? error.message.trim() : 'Runtime conversation is unavailable.',
    ...identity,
  });
}

function conversationUnavailable(input: {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly agentHandle?: NimiLocalAppAgentHandle | null;
  readonly ownerUserId?: string | null;
  readonly runtimeSourceRef?: string | null;
  readonly localAgentRef?: string | null;
}): ZhiyuConversationHomeStatus {
  return {
    transport: 'electron-ipc', ready: false,
    reasonCode: input.reasonCode, actionHint: input.actionHint, source: input.source, message: input.message,
    agentHandle: input.agentHandle ?? null,
    ownerUserId: input.ownerUserId ?? null,
    runtimeSourceRef: input.runtimeSourceRef ?? null,
    localAgentRef: input.localAgentRef ?? null,
    conversationAnchorId: null,
    threadId: null,
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
