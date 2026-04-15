/**
 * Group Agent Dispatcher — Mention/Reply Detection
 *
 * Detects @mention and reply-to-agent triggers in GROUP messages.
 * Only triggers agents owned by the current user (MVP constraint).
 * Does NOT perform any execution — returns trigger descriptors for the
 * execution path to consume.
 *
 * D-LLM-026b: This module is detection-only. No memory, continuity,
 * sidecar, or AI scope logic exists here.
 */
import type { RealmModel } from '@nimiplatform/sdk/realm';

type GroupParticipantDto = RealmModel<'GroupParticipantDto'>;
type GroupMessageViewDto = RealmModel<'GroupMessageViewDto'>;

/**
 * Only trigger execution for messages created within this window.
 * Prevents historical messages from triggering agents when a group is first loaded
 * or when messages are refetched.
 */
const TRIGGER_RECENCY_WINDOW_MS = 60_000;

export type GroupAgentTrigger = {
  type: 'mention' | 'reply';
  agentAccountId: string;
  agentDisplayName: string;
  triggerMessageId: string;
  triggerText: string;
};

type AgentParticipantInfo = {
  accountId: string;
  displayName: string;
  handle: string;
  agentOwnerId: string | null;
};

function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase();
}

function extractAgentParticipants(
  participants: readonly GroupParticipantDto[],
): AgentParticipantInfo[] {
  return participants
    .filter((p): p is GroupParticipantDto & { type: 'agent' } => p.type === 'agent')
    .map((p) => ({
      accountId: String(p.accountId || ''),
      displayName: String(p.displayName || '').trim(),
      handle: String(p.handle || '').trim(),
      agentOwnerId: p.agentOwnerId ?? null,
    }))
    .filter((a) => a.accountId && (a.displayName || a.handle));
}

function resolveReplyToMessageId(message: GroupMessageViewDto): string {
  const legacyReplyToId = String((message as Record<string, unknown>).replyToMessageId || '').trim();
  if (legacyReplyToId) {
    return legacyReplyToId;
  }
  const replyTo = (message as Record<string, unknown>).replyTo;
  if (!replyTo || typeof replyTo !== 'object') {
    return '';
  }
  return String((replyTo as Record<string, unknown>).messageId || (replyTo as Record<string, unknown>).id || '').trim();
}

/**
 * Scans message text for @mentions of agent participants.
 * Returns accountIds of matched agent participants.
 *
 * Matching strategy: for each agent, check if `@displayName` or `@handle`
 * appears in the text (case-insensitive, word-boundary-aware).
 * Does NOT construct regex from user input — uses indexOf on normalized strings.
 */
export function parseMentions(
  text: string,
  agentParticipants: readonly GroupParticipantDto[],
): string[] {
  if (!text || !text.includes('@')) return [];

  const agents = extractAgentParticipants(agentParticipants);
  if (agents.length === 0) return [];

  const normalizedText = normalizeForMatch(text);
  const matched = new Set<string>();

  for (const agent of agents) {
    const names: string[] = [];
    if (agent.displayName) names.push(normalizeForMatch(agent.displayName));
    if (agent.handle) names.push(normalizeForMatch(agent.handle));

    for (const name of names) {
      const mentionPattern = `@${name}`;
      // Scan all occurrences — earlier matches may fail boundary check
      let searchFrom = 0;
      while (searchFrom < normalizedText.length) {
        const idx = normalizedText.indexOf(mentionPattern, searchFrom);
        if (idx === -1) break;
        const afterIdx = idx + mentionPattern.length;
        if (afterIdx >= normalizedText.length || /[\s,.:;!?)]/.test(normalizedText[afterIdx]!)) {
          matched.add(agent.accountId);
          break;
        }
        searchFrom = idx + 1;
      }
      if (matched.has(agent.accountId)) break;
    }
  }

  return [...matched];
}

/**
 * Returns true if the message was created within the trigger recency window.
 * Exported for testing.
 */
export function isMessageWithinTriggerWindow(
  message: { createdAt: string },
  now: number = Date.now(),
): boolean {
  const created = new Date(message.createdAt).getTime();
  if (Number.isNaN(created)) return false;
  return now - created < TRIGGER_RECENCY_WINDOW_MS;
}

/**
 * Detects GROUP agent triggers from a message.
 *
 * Trigger rules (MVP + Wave 5 hardening):
 * - Mention: message text @mentions an agent participant owned by currentUserId
 * - Reply: message replyTo targets a message authored by an agent owned by currentUserId
 * - Each trigger is deduplicated by agentAccountId
 * - Never triggers for agents not owned by currentUserId
 * - Only triggers for messages within the recency window (Wave 5: prevents stale triggers)
 */
export function detectGroupAgentTriggers(input: {
  message: GroupMessageViewDto;
  participants: readonly GroupParticipantDto[];
  currentUserId: string;
  allMessages: readonly GroupMessageViewDto[];
}): GroupAgentTrigger[] {
  const { message, participants, currentUserId, allMessages } = input;

  // Wave 5: Recency gate — skip old messages to prevent triggers on history load.
  // Diagnostics for this skip are emitted by the adapter (caller), not here,
  // because this module must remain free of @renderer path-alias imports for testability.
  if (!isMessageWithinTriggerWindow(message)) {
    return [];
  }

  const agents = extractAgentParticipants(participants);
  const ownedAgents = agents.filter((a) => a.agentOwnerId === currentUserId);
  if (ownedAgents.length === 0) return [];

  const ownedAgentMap = new Map(ownedAgents.map((a) => [a.accountId, a]));
  const triggers = new Map<string, GroupAgentTrigger>();
  const messageText = String(message.text || '').trim();
  const messageId = String(message.id || '');

  // 1. Mention detection
  if (messageText) {
    const mentionedIds = parseMentions(messageText, participants);
    for (const agentId of mentionedIds) {
      const agent = ownedAgentMap.get(agentId);
      if (agent && !triggers.has(agentId)) {
        triggers.set(agentId, {
          type: 'mention',
          agentAccountId: agentId,
          agentDisplayName: agent.displayName || agent.handle,
          triggerMessageId: messageId,
          triggerText: messageText,
        });
      }
    }
  }

  // 2. Reply-to-agent detection
  const replyToId = resolveReplyToMessageId(message);
  if (replyToId) {
    const repliedMessage = allMessages.find((m) => String(m.id || '') === replyToId);
    if (repliedMessage?.author?.type === 'agent') {
      const repliedAgentId = String(repliedMessage.author.accountId || '');
      const agent = ownedAgentMap.get(repliedAgentId);
      if (agent && !triggers.has(repliedAgentId)) {
        triggers.set(repliedAgentId, {
          type: 'reply',
          agentAccountId: repliedAgentId,
          agentDisplayName: agent.displayName || agent.handle,
          triggerMessageId: messageId,
          triggerText: messageText,
        });
      }
    }
  }

  return [...triggers.values()];
}
