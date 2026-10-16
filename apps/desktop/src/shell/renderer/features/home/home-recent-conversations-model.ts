import { createNimiRuntimeAgentConsumeClient } from '@nimiplatform/sdk/runtime';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import type { LocalAgentListItem } from '../agents/local-agent-list-model.js';

// The strip renders one measured tile per partner, so the fan-out is bounded:
// agents beyond the bound simply wait for the full chat surface instead of
// turning the Home card into an unbounded RPC storm.
export const HOME_RECENT_CHAT_AGENT_LIMIT = 24;

export type HomeRecentChatPartner = Readonly<{
  localAgentRef: string;
  displayName: string;
  avatarUrl: string | null;
  lastMessageText: string | null;
  /** Summary title backing the preview when the last turn carried no text. */
  conversationTitle: string | null;
  updatedAtMs: number | null;
  hasUnread: boolean;
}>;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function summaryTimestampMs(value: { seconds: string; nanos: number } | undefined): number | null {
  if (!value) return null;
  const ms = Number(value.seconds) * 1_000 + value.nanos / 1_000_000;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

async function listUnreadRuntimeAgentRefs(sdk: DesktopRendererSdkPort): Promise<ReadonlySet<string>> {
  const page = await sdk.appProduct().activity.list({ pageSize: 200 }).catch(() => null);
  const refs = new Set<string>();
  for (const record of page?.records ?? []) {
    if (record.source.kind !== 'runtime-agent' || !record.userView.unread) continue;
    const agentRef = normalizeText(record.agent?.agentRef);
    if (agentRef) refs.add(agentRef);
  }
  return refs;
}

// Projects Runtime conversation authority for the Home recent-chats card: each
// owned LocalAgent's latest active conversation summary supplies the preview,
// and unread App activity published by runtime agents supplies the unread dot
// (the same signal the Home messages column uses). Every read fails soft — a
// partner whose read broke still renders from its LocalAgent identity so the
// card never disappears, and agents without any conversation stay available
// after the chatted partners so a first chat can start from Home.
export async function fetchHomeRecentChatPartners(input: {
  ownerUserId: string;
  sdk: DesktopRendererSdkPort;
  agents: readonly LocalAgentListItem[];
}): Promise<HomeRecentChatPartner[]> {
  const ownerUserId = normalizeText(input.ownerUserId);
  const agents = input.agents.slice(0, HOME_RECENT_CHAT_AGENT_LIMIT);
  if (!ownerUserId || agents.length === 0) {
    return [];
  }
  const consume = createNimiRuntimeAgentConsumeClient({
    runtimeAppId: input.sdk.appId(),
    runtime: { agents: input.sdk.accountProduct().agents },
  });
  const unreadAgentRefs = await listUnreadRuntimeAgentRefs(input.sdk);
  const partners = await Promise.all(agents.map(async (agent, order) => {
    const [summaries, resolved] = await Promise.all([
      input.sdk.withRuntimeProtectedScopes(
        ['runtime.agent.read'],
        (callOptions) => consume.anchors.listSummaries({
          ownerUserId,
          runtimeSourceRef: agent.runtimeSourceRef,
          localAgentRef: agent.localAgentRef,
          statusFilter: ['active'],
          pageSize: 1,
        }, callOptions),
      ).catch(() => null),
      input.sdk.resolveDesktopAgentReference({ localAgentRef: agent.localAgentRef }).catch(() => null),
    ]);
    const latest = summaries?.summaries[0] ?? null;
    const reference = resolved?.reference ?? null;
    const activityAgentRef = normalizeText(reference?.activityAgentRef);
    return {
      localAgentRef: agent.localAgentRef,
      displayName: normalizeText(reference?.displayName) || agent.displayName,
      avatarUrl: normalizeText(reference?.avatarUrl) || null,
      lastMessageText: normalizeText(latest?.lastMessageText) || null,
      conversationTitle: normalizeText(latest?.title) || null,
      updatedAtMs: summaryTimestampMs(latest?.updatedAt),
      hasUnread: Boolean(activityAgentRef) && unreadAgentRefs.has(activityAgentRef),
      order,
    };
  }));
  return partners
    .sort((left, right) => (right.updatedAtMs ?? -1) - (left.updatedAtMs ?? -1) || left.order - right.order)
    .map(({ order: _order, ...partner }) => partner);
}
