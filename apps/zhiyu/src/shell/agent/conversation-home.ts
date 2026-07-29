import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import type { NimiLocalAppAgentHandle, NimiLocalAppClient } from '@nimiplatform/sdk/app';
import type { ZhiyuEvidence } from '../app/evidence';
import { getZhiyuLocalAppClient } from '../auth/runtime-platform';
import {
  clearZhiyuAgentConversationAnchorBinding,
  getZhiyuAgentConversationAnchorBinding,
  hydrateZhiyuAgentConversationAnchorBindingsFromStorage,
  persistZhiyuAgentConversationAnchorBinding,
  persistZhiyuAgentConversationAnchorBindingsToStorage,
  type ZhiyuAgentConversationAnchorBinding,
} from './conversation-anchor-binding-storage';
import type { ZhiyuLocalAgentStatus } from './local-agent-status';

export type ZhiyuConversationHomeStatus = ZhiyuEvidence['conversation'];
type LocalAgentIdentity = {
  readonly agentHandle: NimiLocalAppAgentHandle;
};

export async function probeZhiyuRuntimeConversationHome(
  localAgent: ZhiyuLocalAgentStatus,
): Promise<ZhiyuConversationHomeStatus> {
  const identity = localAgentIdentity(localAgent);
  if (!identity) {
    return conversationUnavailable({
      reasonCode: 'zhiyu-local-agent-required',
      actionHint: localAgent.actionHint || 'request_agents_interact_permission',
      source: localAgent.source,
      message: 'Zhiyu requires an owner-granted Agent before opening a conversation.',
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
    await hydrateZhiyuAgentConversationAnchorBindingsFromStorage();
    const existing = getZhiyuAgentConversationAnchorBinding(identity.agentHandle);
    if (bindingMatchesIdentity(existing, identity)) {
      const recovered = await ensureConversationAnchorBindingUpstream({ conversation, identity, binding: existing });
      if (recovered) return conversationReady(identity, recovered.conversationAnchorId, recovered.threadId);
    } else if (existing) {
      clearZhiyuAgentConversationAnchorBinding(identity.agentHandle);
      await persistZhiyuAgentConversationAnchorBindingsToStorage();
    }

    const opened = await conversation.open({
      agentHandle: identity.agentHandle,
      disposition: 'create-or-resume',
    });
    const snapshot = await conversation.snapshot({
      agentHandle: identity.agentHandle,
      conversationAnchorId: opened.conversationAnchorId,
    });
    const binding = persistZhiyuAgentConversationAnchorBinding({
      ...identity,
      conversationAnchorId: opened.conversationAnchorId,
      threadId: requireRuntimeThreadId(snapshot),
      updatedAtMs: Date.now(),
    });
    await persistZhiyuAgentConversationAnchorBindingsToStorage();
    return conversationReady(identity, binding.conversationAnchorId, binding.threadId);
  } catch (error) {
    return normalizeConversationError(error, identity);
  }
}

async function ensureConversationAnchorBindingUpstream(input: {
  readonly conversation: NimiLocalAppClient['conversation'];
  readonly identity: LocalAgentIdentity;
  readonly binding: ZhiyuAgentConversationAnchorBinding;
}): Promise<ZhiyuAgentConversationAnchorBinding | null> {
  try {
    const snapshot = await input.conversation.snapshot({
      agentHandle: input.identity.agentHandle,
      conversationAnchorId: input.binding.conversationAnchorId,
    });
    const threadId = requireRuntimeThreadId(snapshot);
    if (threadId === input.binding.threadId) return input.binding;
    const refreshed = persistZhiyuAgentConversationAnchorBinding({
      ...input.binding,
      threadId,
      updatedAtMs: Date.now(),
    });
    await persistZhiyuAgentConversationAnchorBindingsToStorage();
    return refreshed;
  } catch (error) {
    if (!isRecoverableRuntimeAnchorError(error)) throw error;
    clearZhiyuAgentConversationAnchorBinding(input.identity.agentHandle);
    await persistZhiyuAgentConversationAnchorBindingsToStorage();
    return null;
  }
}

function bindingMatchesIdentity(
  binding: ZhiyuAgentConversationAnchorBinding | null,
  identity: LocalAgentIdentity,
): binding is ZhiyuAgentConversationAnchorBinding {
  return Boolean(binding
    && binding.agentHandle === identity.agentHandle);
}

function conversationReady(
  identity: LocalAgentIdentity,
  conversationAnchorId: string,
  threadId: string,
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
    threadId,
  };
}

function requireRuntimeThreadId(snapshot: Readonly<Record<string, unknown>>): string {
  const threadId = stringOr(snapshot.threadId ?? snapshot.thread_id, '');
  if (!threadId) {
    throw Object.assign(new Error('Runtime conversation snapshot returned no thread id.'), {
      reasonCode: 'zhiyu-conversation-thread-id-missing',
      actionHint: 'check_local_app_conversation_snapshot',
      source: 'runtime',
    });
  }
  return threadId;
}

function localAgentIdentity(localAgent: ZhiyuLocalAgentStatus): LocalAgentIdentity | null {
  if (!localAgent.ready) return null;
  const handle = stringOr(localAgent.agentHandle, '');
  return handle ? { agentHandle: agentHandle(handle) } : null;
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

function isRecoverableRuntimeAnchorError(error: unknown): boolean {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const reasonCode = stringOr(record.reasonCode, '').toLowerCase();
  return reasonCode.includes('not-found') || reasonCode.includes('not_found')
    || reasonCode.includes('failed-precondition') || reasonCode.includes('failed_precondition')
    || reasonCode.includes('anchor');
}

function conversationUnavailable(input: {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly agentHandle?: string | null;
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

function agentHandle(value: string): NimiLocalAppAgentHandle {
  return value as NimiLocalAppAgentHandle;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
