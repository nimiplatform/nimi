/**
 * Group-Safe Agent Execution Path
 *
 * A deliberately simple, isolated execution path for agent participation
 * in GROUP conversations. This does NOT reuse the DYADIC orchestration
 * or continuity machinery.
 *
 * D-LLM-026b enforcement (hard-coded, NOT configurable):
 * - NO DYADIC memory read/write
 * - NO continuity adapter / digest injection
 * - NO side-car dispatch
 * - NO follow-up turns
 * - NO message-action envelope resolution
 * - NO AIScopeRef creation (thread/group/per-message)
 * - Failure = agent silence (log only, no retry/substitution)
 * - Single-message semantics preserved (D-LLM-025)
 */
import type { RealmModel } from '@nimiplatform/sdk/realm';
import type { AISnapshot } from '@nimiplatform/sdk/mod';
import type { ConversationRuntimeTextMessage } from '@nimiplatform/nimi-kit/features/chat/headless';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { ChatThinkingPreference } from './chat-shared-thinking';
import type { AgentEffectiveCapabilityResolution } from './conversation-capability';
import type { GroupAgentTrigger } from './chat-group-agent-dispatcher';
import { createAgentLocalChatConversationRuntimeAdapter } from './chat-agent-orchestration-runtime';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { dataSync } from '@runtime/data-sync';

type GroupMessageViewDto = RealmModel<'GroupMessageViewDto'>;

const MAX_GROUP_TRANSCRIPT_MESSAGES = 30;

/**
 * Wave 5: Per-agent in-flight execution guard.
 * Tracks active executions by composite key `${groupChatId}:${agentAccountId}`.
 * Prevents concurrent execution of the same agent in the same group.
 */
const inflightExecutions = new Set<string>();

function inflightKey(groupChatId: string, agentAccountId: string): string {
  return `${groupChatId}:${agentAccountId}`;
}

/** Exported for testing / diagnostics. */
export function getInflightExecutionCount(): number {
  return inflightExecutions.size;
}

/** Exported for testing — clears all inflight state. */
export function clearInflightExecutions(): void {
  inflightExecutions.clear();
}

export type GroupAgentExecutionInput = {
  agentAccountId: string;
  agentDisplayName: string;
  agentBio: string | null;
  groupChatId: string;
  trigger: GroupAgentTrigger;
  recentTranscript: readonly GroupMessageViewDto[];
  agentResolution: AgentEffectiveCapabilityResolution;
  textExecutionSnapshot: AISnapshot;
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  reasoningPreference: ChatThinkingPreference;
  signal?: AbortSignal;
};

function buildGroupSystemPrompt(
  agentDisplayName: string,
  agentBio: string | null,
): string {
  const lines: string[] = [];
  lines.push(`You are ${agentDisplayName}, participating in a group conversation.`);
  if (agentBio) {
    lines.push(`About you: ${agentBio}`);
  }
  lines.push('');
  lines.push('Group conversation rules:');
  lines.push('- Respond to the message that mentioned or replied to you.');
  lines.push('- Keep your response concise and relevant to the group discussion.');
  lines.push('- Do not reference private memories, personal conversations, or information not visible in this chat.');
  lines.push('- Do not attempt to take actions or access external resources.');
  lines.push('- You can see the recent conversation history for context.');
  return lines.join('\n');
}

function serializeTranscript(
  messages: readonly GroupMessageViewDto[],
  agentAccountId: string,
): ConversationRuntimeTextMessage[] {
  const sorted = [...messages]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-MAX_GROUP_TRANSCRIPT_MESSAGES);

  return sorted.map((msg): ConversationRuntimeTextMessage => {
    const author = msg.author;
    const isAgent = author?.accountId === agentAccountId;
    const senderName = author ? String(author.displayName || '').trim() || 'Unknown' : 'Unknown';
    const text = String(msg.text || '').trim();

    return {
      role: isAgent ? 'assistant' : 'user',
      text,
      content: text,
      name: isAgent ? undefined : senderName,
    };
  });
}

/**
 * Execute a group-safe agent turn.
 *
 * On success: posts the agent response to Realm via sendGroupAgentMessage.
 * On ANY failure: logs the error and returns silently (D-LLM-026b).
 */
export async function executeGroupAgentTurn(
  input: GroupAgentExecutionInput,
): Promise<void> {
  const {
    agentAccountId,
    agentDisplayName,
    agentBio,
    groupChatId,
    trigger,
    recentTranscript,
    agentResolution,
    textExecutionSnapshot,
    runtimeConfigState,
    runtimeFields,
    reasoningPreference,
    signal,
  } = input;

  const iKey = inflightKey(groupChatId, agentAccountId);

  // Wave 5: Per-agent in-flight guard — skip if this agent is already executing in this group
  if (inflightExecutions.has(iKey)) {
    logRendererEvent({
      area: 'group-agent-execution',
      message: 'skip: inflight_guard',
      details: { agentAccountId, groupChatId, triggerType: trigger.type, triggerMessageId: trigger.triggerMessageId },
    });
    return;
  }

  inflightExecutions.add(iKey);
  const startTime = Date.now();

  try {
    // Guard: agent resolution must be ready
    if (!agentResolution.ready) {
      logRendererEvent({
        area: 'group-agent-execution',
        message: 'skip: agent_resolution_not_ready',
        details: { agentAccountId, groupChatId, resolutionReason: agentResolution.reason },
      });
      return;
    }

    const systemPrompt = buildGroupSystemPrompt(agentDisplayName, agentBio);
    const messages = serializeTranscript(recentTranscript, agentAccountId);

    logRendererEvent({
      area: 'group-agent-execution',
      message: 'invoking',
      details: { agentAccountId, groupChatId, triggerType: trigger.type, transcriptLength: messages.length },
    });

    // Use the existing runtime adapter (text invoke only — no streaming for group MVP)
    const runtimeAdapter = createAgentLocalChatConversationRuntimeAdapter();
    const result = await runtimeAdapter.invokeText({
      agentId: agentAccountId,
      conversationAnchorId: groupChatId,
      messages,
      systemPrompt,
      maxOutputTokensRequested: null,
      threadId: groupChatId,
      agentResolution,
      textExecutionSnapshot,
      runtimeConfigState,
      runtimeFields,
      reasoningPreference,
      signal,
    });

    const responseText = (result.text || '').trim();
    if (!responseText) {
      logRendererEvent({
        area: 'group-agent-execution',
        message: 'skip: empty_response',
        details: { agentAccountId, groupChatId, durationMs: Date.now() - startTime },
      });
      return;
    }

    // Post to Realm via canonical sendGroupAgentMessage
    await dataSync.sendGroupAgentMessage(
      groupChatId,
      agentAccountId,
      responseText,
      trigger.triggerMessageId,
    );

    logRendererEvent({
      area: 'group-agent-execution',
      message: 'success',
      details: {
        agentAccountId, groupChatId, triggerType: trigger.type,
        responseLength: responseText.length, durationMs: Date.now() - startTime,
      },
    });
  } catch (error) {
    // D-LLM-026b: failure = agent silence. Log only, never surface or retry.
    logRendererEvent({
      level: 'warn',
      area: 'group-agent-execution',
      message: `error: ${error instanceof Error ? error.message : String(error)}`,
      details: { agentAccountId, groupChatId, triggerType: trigger.type, durationMs: Date.now() - startTime },
    });
  } finally {
    inflightExecutions.delete(iKey);
  }
}
