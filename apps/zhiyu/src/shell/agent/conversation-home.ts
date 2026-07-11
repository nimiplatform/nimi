import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  createNimiRuntimeAgentClient,
  Runtime,
} from '@nimiplatform/sdk/runtime';
import { withZhiyuRuntimeAgentBindingRequired } from '../agent-chat/runtime-agent-binding';
import type { ZhiyuEvidence } from '../app/evidence';
import {
  clearZhiyuAgentConversationAnchorBinding,
  getZhiyuAgentConversationAnchorBinding,
  hydrateZhiyuAgentConversationAnchorBindingsFromStorage,
  persistZhiyuAgentConversationAnchorBinding,
  persistZhiyuAgentConversationAnchorBindingsToStorage,
  type ZhiyuAgentConversationAnchorBinding,
} from './conversation-anchor-binding-storage';
import type { ZhiyuLocalAgentStatus } from './local-agent-discovery';

export type ZhiyuConversationHomeStatus = ZhiyuEvidence['conversation'];
type LocalAgentIdentity = {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
};

export async function probeZhiyuRuntimeConversationHome(
  localAgent: ZhiyuLocalAgentStatus,
): Promise<ZhiyuConversationHomeStatus> {
  const identity = localAgentIdentity(localAgent);
  if (!identity) {
    return conversationUnavailable({
      reasonCode: 'zhiyu-local-agent-required',
      actionHint: 'select_runtime_owned_partner',
      source: localAgent.source,
      message: 'Zhiyu requires a Runtime-owned LocalAgent before opening a conversation anchor.',
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
      message: 'Electron Runtime bridge is not available.',
      ...identity,
    });
  }

  const runtime = new Runtime({
    appId: 'nimi.zhiyu',
    transport: { type: 'electron-ipc' },
  });
  const client = createNimiRuntimeAgentClient({
    runtime,
    appId: 'nimi.zhiyu',
    getSubjectUserId: () => identity.ownerUserId,
    withScopes: withZhiyuRuntimeAgentBindingRequired,
  });

  try {
    await hydrateZhiyuAgentConversationAnchorBindingsFromStorage();
    const existingBinding = getZhiyuAgentConversationAnchorBinding(identity.localAgentRef);
    if (bindingMatchesIdentity(existingBinding, identity)) {
      const upstreamBinding = await ensureConversationAnchorBindingUpstream({
        client,
        identity,
        binding: existingBinding,
      });
      if (upstreamBinding) {
        return conversationReady(identity, upstreamBinding.conversationAnchorId);
      }
    } else if (existingBinding) {
      clearZhiyuAgentConversationAnchorBinding(identity.localAgentRef);
      await persistZhiyuAgentConversationAnchorBindingsToStorage();
    }

    const snapshot = await client.openConversation(openConversationRequest(identity));
    const conversationAnchorId = stringOr(snapshot.anchor?.conversationAnchorId, '');
    if (!conversationAnchorId) {
      return conversationUnavailable({
        reasonCode: 'zhiyu-conversation-anchor-missing',
        actionHint: 'check_runtime_agent_open_conversation',
        source: 'runtime',
        message: 'Runtime Agent openConversation returned no conversation anchor id.',
        ...identity,
      });
    }
    const binding = persistZhiyuAgentConversationAnchorBinding({
      ...identity,
      conversationAnchorId,
      updatedAtMs: Date.now(),
    });
    await persistZhiyuAgentConversationAnchorBindingsToStorage();
    return conversationReady(identity, binding.conversationAnchorId);
  } catch (error) {
    return normalizeConversationError(error, identity);
  }
}

function openConversationRequest(identity: LocalAgentIdentity): {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly metadata: {
    readonly appId: 'nimi.zhiyu';
    readonly surface: 'zhiyu.home';
  };
} {
  return {
    ...identity,
    metadata: {
      appId: 'nimi.zhiyu',
      surface: 'zhiyu.home',
    },
  };
}

async function ensureConversationAnchorBindingUpstream(input: {
  readonly client: {
    readonly getSessionSnapshot: (request: LocalAgentIdentity & {
      readonly conversationAnchorId: string;
    }) => Promise<unknown>;
  };
  readonly identity: LocalAgentIdentity;
  readonly binding: ZhiyuAgentConversationAnchorBinding;
}): Promise<ZhiyuAgentConversationAnchorBinding | null> {
  try {
    await input.client.getSessionSnapshot({
      ...input.identity,
      conversationAnchorId: input.binding.conversationAnchorId,
    });
    return input.binding;
  } catch (error) {
    if (!isRecoverableRuntimeAnchorError(error)) {
      throw error;
    }
    clearZhiyuAgentConversationAnchorBinding(input.identity.localAgentRef);
    await persistZhiyuAgentConversationAnchorBindingsToStorage();
    return null;
  }
}

function bindingMatchesIdentity(
  binding: ZhiyuAgentConversationAnchorBinding | null,
  identity: LocalAgentIdentity,
): binding is ZhiyuAgentConversationAnchorBinding {
  if (!binding) {
    return false;
  }
  return binding.ownerUserId === identity.ownerUserId
    && binding.runtimeSourceRef === identity.runtimeSourceRef
    && binding.localAgentRef === identity.localAgentRef;
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
    message: 'Runtime-owned conversation anchor is open.',
    ...identity,
    conversationAnchorId,
  };
}

function localAgentIdentity(localAgent: ZhiyuLocalAgentStatus): LocalAgentIdentity | null {
  if (!localAgent.ready) {
    return null;
  }
  const ownerUserId = stringOr(localAgent.ownerUserId, '');
  const runtimeSourceRef = stringOr(localAgent.runtimeSourceRef, '');
  const localAgentRef = stringOr(localAgent.localAgentRef, '');
  if (!ownerUserId || !runtimeSourceRef || !localAgentRef) {
    return null;
  }
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
  };
}

function normalizeConversationError(
  error: unknown,
  identity: LocalAgentIdentity,
): ZhiyuConversationHomeStatus {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  return conversationUnavailable({
    reasonCode: stringOr(record.reasonCode, 'zhiyu-conversation-anchor-unavailable'),
    actionHint: stringOr(record.actionHint, 'check_runtime_agent_open_conversation'),
    source: stringOr(record.source, 'sdk'),
    message: error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Runtime conversation anchor is unavailable.',
    ...identity,
  });
}

function isRecoverableRuntimeAnchorError(error: unknown): boolean {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const reasonCode = stringOr(record.reasonCode, '');
  const message = error instanceof Error
    ? error.message.trim().toLowerCase()
    : stringOr(record.message, '').toLowerCase();
  return reasonCode === 'RUNTIME_GRPC_NOT_FOUND'
    || reasonCode === 'RUNTIME_GRPC_FAILED_PRECONDITION'
    || message.includes('conversation anchor not found')
    || message.includes('conversation anchor is closed')
    || message.includes('conversation anchor agent_id mismatch');
}

function conversationUnavailable(input: {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly ownerUserId?: string | null;
  readonly runtimeSourceRef?: string | null;
  readonly localAgentRef?: string | null;
}): ZhiyuConversationHomeStatus {
  return {
    transport: 'electron-ipc',
    ready: false,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    ownerUserId: input.ownerUserId ?? null,
    runtimeSourceRef: input.runtimeSourceRef ?? null,
    localAgentRef: input.localAgentRef ?? null,
    conversationAnchorId: null,
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
