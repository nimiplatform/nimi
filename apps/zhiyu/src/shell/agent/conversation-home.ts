import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  createNimiRuntimeAgentClient,
  Runtime,
} from '@nimiplatform/sdk/runtime';
import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuLocalAgentStatus } from './local-agent-discovery';
import { withZhiyuElectronRuntimeProtectedScopes } from './runtime-agent-scopes';

export type ZhiyuConversationHomeStatus = ZhiyuEvidence['conversation'];

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
    withScopes: withZhiyuElectronRuntimeProtectedScopes,
  });

  try {
    const snapshot = await client.openConversation({
      ...identity,
      metadata: {
        appId: 'nimi.zhiyu',
        surface: 'zhiyu.home',
      },
    });
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
  } catch (error) {
    return normalizeConversationError(error, identity);
  }
}

function localAgentIdentity(localAgent: ZhiyuLocalAgentStatus): {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
} | null {
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
  identity: {
    readonly ownerUserId: string;
    readonly runtimeSourceRef: string;
    readonly localAgentRef: string;
  },
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
