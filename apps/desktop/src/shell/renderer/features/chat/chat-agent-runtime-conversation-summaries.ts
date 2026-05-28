import { getPlatformClient } from '@nimiplatform/sdk';
import {
  ConversationAnchorStatus,
  type AgentConversationSummary,
} from '@nimiplatform/sdk/runtime/generated/runtime/v1/agent_service';
import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';

export const RUNTIME_AGENT_CONVERSATION_SUMMARIES_QUERY_KEY = ['chat-agent-runtime-conversation-summaries'] as const;

export type AgentRuntimeConversationSummary = {
  conversationAnchorId: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  title: string;
  lastMessageRole: string;
  lastMessageText: string;
  lastMessageId: string;
  transcriptMessageCount: number;
  updatedAtMs: number;
  targetSnapshot: AgentLocalTargetSnapshot;
};

type RuntimeTimestampLike = {
  seconds?: string | number | bigint;
  nanos?: number;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function timestampToMs(value: RuntimeTimestampLike | null | undefined): number {
  if (!value) {
    return 0;
  }
  const seconds = typeof value.seconds === 'bigint'
    ? Number(value.seconds)
    : Number(String(value.seconds ?? '0'));
  const nanos = Number(value.nanos ?? 0);
  if (!Number.isFinite(seconds) || !Number.isFinite(nanos)) {
    return 0;
  }
  return Math.max(0, (seconds * 1000) + Math.floor(nanos / 1_000_000));
}

export function toAgentRuntimeConversationSummary(
  target: AgentLocalTargetSnapshot,
  summary: AgentConversationSummary,
): AgentRuntimeConversationSummary | null {
  const anchor = summary.anchor;
  const conversationAnchorId = normalizeText(anchor?.conversationAnchorId);
  if (!conversationAnchorId) {
    return null;
  }
  const localAgentRef = normalizeText(anchor?.localAgentRef) || target.localAgentRef;
  if (localAgentRef !== target.localAgentRef) {
    return null;
  }
  const updatedAtMs = timestampToMs(summary.updatedAt || anchor?.updatedAt);
  return {
    conversationAnchorId,
    ownerUserId: normalizeText(anchor?.ownerUserId) || target.ownerUserId,
    realmAgentId: normalizeText(anchor?.realmAgentId) || target.realmAgentId,
    localAgentRef,
    title: normalizeText(summary.title) || target.displayName,
    lastMessageRole: normalizeText(summary.lastMessageRole),
    lastMessageText: normalizeText(summary.lastMessageText),
    lastMessageId: normalizeText(summary.lastMessageId || anchor?.lastMessageId),
    transcriptMessageCount: Math.max(0, Number(summary.transcriptMessageCount || 0)),
    updatedAtMs,
    targetSnapshot: target,
  };
}

function sortRuntimeConversationSummaries(
  summaries: readonly AgentRuntimeConversationSummary[],
): AgentRuntimeConversationSummary[] {
  return [...summaries].sort((left, right) => {
    const timeDelta = right.updatedAtMs - left.updatedAtMs;
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return left.conversationAnchorId.localeCompare(right.conversationAnchorId);
  });
}

export async function listRuntimeAgentConversationSummaries(
  targets: readonly AgentLocalTargetSnapshot[],
): Promise<AgentRuntimeConversationSummary[]> {
  if (targets.length === 0) {
    return [];
  }
  const runtime = getPlatformClient().runtime;
  const responses = await Promise.all(targets.map(async (target) => {
    const response = await runtime.agent.anchors.listSummaries({
      ownerUserId: target.ownerUserId,
      realmAgentId: target.realmAgentId,
      localAgentRef: target.localAgentRef,
      subjectUserId: target.ownerUserId,
      statusFilter: [ConversationAnchorStatus.ACTIVE],
      pageSize: 1,
    });
    return response.summaries
      .map((summary) => toAgentRuntimeConversationSummary(target, summary))
      .filter((summary): summary is AgentRuntimeConversationSummary => Boolean(summary));
  }));
  const deduped = new Map<string, AgentRuntimeConversationSummary>();
  for (const summary of responses.flat()) {
    const previous = deduped.get(summary.localAgentRef);
    if (!previous || summary.updatedAtMs >= previous.updatedAtMs) {
      deduped.set(summary.localAgentRef, summary);
    }
  }
  return sortRuntimeConversationSummaries([...deduped.values()]);
}
