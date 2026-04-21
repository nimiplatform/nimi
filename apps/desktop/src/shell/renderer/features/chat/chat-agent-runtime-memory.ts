import {
  MemoryCanonicalClass,
  type CanonicalMemoryView,
} from '@nimiplatform/sdk/runtime';
import type { ConversationTurnHistoryMessage } from '@nimiplatform/nimi-kit/features/chat/headless';
import type {
  AgentLocalRecallEntryRecord,
  AgentLocalRelationMemorySlotRecord,
  AgentLocalTurnContext,
} from '@renderer/bridge/runtime-bridge/types';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { logRendererEvent } from '@renderer/bridge/runtime-bridge/logging';
import {
  createRuntimeAgentMemoryAdapter,
  type RuntimeChatTrackMessage,
  summarizeCanonicalMemoryView,
} from '@renderer/infra/runtime-agent-memory';

const DYADIC_POLICY_REASON = 'desktop_agent_chat_dyadic_turn';
const DYADIC_ASSISTANT_POLICY_REASON = 'desktop_agent_chat_dyadic_assistant_turn';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function timestampToMs(timestamp?: { seconds: string; nanos: number }): number {
  if (!timestamp) {
    return Date.now();
  }
  const seconds = Number(timestamp.seconds);
  const nanos = Number(timestamp.nanos);
  if (!Number.isFinite(seconds)) {
    return Date.now();
  }
  const millis = seconds * 1000 + (Number.isFinite(nanos) ? Math.floor(nanos / 1_000_000) : 0);
  return Number.isFinite(millis) ? millis : Date.now();
}

function requireSubjectUserId(): string {
  const subjectUserId = normalizeText((useAppStore.getState().auth.user as Record<string, unknown> | null)?.id);
  if (!subjectUserId) {
    throw new Error('desktop agent chat requires authenticated subject user id for runtime.agent');
  }
  return subjectUserId;
}

const runtimeAgentMemory = createRuntimeAgentMemoryAdapter({
  getSubjectUserId: requireSubjectUserId,
});

function deriveMemoryQuery(context: AgentLocalTurnContext): string {
  const draftText = normalizeText(context.draft?.text);
  if (draftText) {
    return draftText;
  }

  const beatText = context.recentBeats
    .map((beat) => normalizeText(beat.textShadow))
    .filter(Boolean)
    .slice(-3)
    .join(' ');
  if (beatText) {
    return beatText;
  }

  const threadTitle = normalizeText(context.thread.title);
  if (threadTitle) {
    return `${threadTitle} relationship memory`;
  }
  return 'relationship memory';
}

function summarizeMemory(view: CanonicalMemoryView): string {
  return summarizeCanonicalMemoryView(view);
}

function toRelationMemorySlot(
  threadId: string,
  view: CanonicalMemoryView,
): AgentLocalRelationMemorySlotRecord | null {
  const summary = summarizeMemory(view);
  const memoryId = normalizeText(view.record?.memoryId);
  if (!summary || !memoryId) {
    return null;
  }

  return {
    id: `runtime:${memoryId}:slot`,
    threadId,
    slotType: 'runtime.dyadic',
    summary,
    sourceTurnId: normalizeText(view.record?.provenance?.sourceEventId) || null,
    score: Number.isFinite(view.recallScore) ? view.recallScore : 0,
    updatedAtMs: timestampToMs(view.record?.updatedAt || view.record?.createdAt),
  };
}

function toRecallEntry(
  threadId: string,
  view: CanonicalMemoryView,
): AgentLocalRecallEntryRecord | null {
  const summary = summarizeMemory(view);
  const memoryId = normalizeText(view.record?.memoryId);
  if (!summary || !memoryId) {
    return null;
  }

  return {
    id: `runtime:${memoryId}:recall`,
    threadId,
    sourceTurnId: normalizeText(view.record?.provenance?.sourceEventId) || null,
    summary,
    searchText: summary,
    updatedAtMs: timestampToMs(view.record?.updatedAt || view.record?.createdAt),
  };
}

export async function writeDesktopAgentUserTurnMemory(input: {
  agentId: string;
  displayName: string;
  worldId: string | null;
  submittedText: string;
  turnId: string;
  threadId: string;
}): Promise<void> {
  await runtimeAgentMemory.writeDyadicObservation({
    agentId: input.agentId,
    displayName: input.displayName,
    worldId: input.worldId,
    observation: input.submittedText,
    sourceEventId: input.turnId,
    traceId: input.threadId,
    policyReason: DYADIC_POLICY_REASON,
    createIfMissing: true,
    syncDyadicContext: true,
    syncWorldContext: true,
  });
}

export async function writeDesktopAgentAssistantTurnMemory(input: {
  agentId: string;
  displayName: string;
  worldId: string | null;
  assistantText: string;
  turnId: string;
  threadId: string;
}): Promise<void> {
  await runtimeAgentMemory.writeDyadicObservation({
    agentId: input.agentId,
    displayName: input.displayName,
    worldId: input.worldId,
    observation: input.assistantText,
    sourceEventId: input.turnId,
    traceId: input.threadId,
    authorId: input.agentId,
    policyReason: DYADIC_ASSISTANT_POLICY_REASON,
    createIfMissing: true,
    syncDyadicContext: true,
    syncWorldContext: true,
  });
}

export async function sendDesktopAgentChatTrackSidecarInput(input: {
  agentId: string;
  turnId: string;
  threadId: string;
  history: readonly ConversationTurnHistoryMessage[];
  assistantText: string;
}): Promise<void> {
  const assistantText = normalizeText(input.assistantText);
  if (!assistantText) {
    return;
  }
  const messages: RuntimeChatTrackMessage[] = input.history
    .map((message) => ({
      role: normalizeText(message.role),
      content: normalizeText(message.text),
    }))
    .filter((message) => message.role && message.content);
  messages.push({
    role: 'assistant',
    content: assistantText,
  });
  await runtimeAgentMemory.sendChatTrackSidecarInput({
    agentId: input.agentId,
    sourceEventId: input.turnId,
    threadId: input.threadId,
    messages,
  });
}

export async function runDesktopAgentAssistantTurnRuntimeFollowUp(input: {
  agentId: string;
  displayName: string;
  worldId: string | null;
  assistantText: string;
  turnId: string;
  threadId: string;
  history: readonly ConversationTurnHistoryMessage[];
}, deps: {
  writeAssistantTurnMemory?: typeof writeDesktopAgentAssistantTurnMemory;
  sendChatTrackSidecarInput?: typeof sendDesktopAgentChatTrackSidecarInput;
  log?: typeof logRendererEvent;
} = {}): Promise<void> {
  const writeAssistantTurnMemory = deps.writeAssistantTurnMemory ?? writeDesktopAgentAssistantTurnMemory;
  const sendChatTrackSidecarInput = deps.sendChatTrackSidecarInput ?? sendDesktopAgentChatTrackSidecarInput;
  const log = deps.log ?? logRendererEvent;

  await writeAssistantTurnMemory({
    agentId: input.agentId,
    displayName: input.displayName,
    worldId: input.worldId,
    assistantText: input.assistantText,
    turnId: input.turnId,
    threadId: input.threadId,
  });

  try {
    await sendChatTrackSidecarInput({
      agentId: input.agentId,
      turnId: input.turnId,
      threadId: input.threadId,
      history: input.history,
      assistantText: input.assistantText,
    });
  } catch (error) {
    await log({
      level: 'warn',
      area: 'agent-chat-sidecar',
      message: 'action:agent-chat-sidecar-forwarding-failed',
      details: {
        agentId: input.agentId,
        turnId: input.turnId,
        threadId: input.threadId,
        error,
      },
    });
  }
}

export async function loadDesktopAgentRuntimeMemoryContext(
  context: AgentLocalTurnContext,
): Promise<Pick<AgentLocalTurnContext, 'relationMemorySlots' | 'recallEntries'>> {
  const target = context.thread.targetSnapshot;
  const agentId = normalizeText(target.agentId);
  if (!agentId) {
    return {
      relationMemorySlots: [],
      recallEntries: [],
    };
  }

  const memories = await runtimeAgentMemory.queryCanonicalViews({
    agentId,
    displayName: normalizeText(target.displayName) || agentId,
    worldId: target.worldId,
    query: deriveMemoryQuery(context),
    limit: 8,
    canonicalClasses: [MemoryCanonicalClass.DYADIC],
    kinds: [],
    includeInvalidated: false,
    createIfMissing: true,
    syncDyadicContext: true,
    syncWorldContext: true,
  });

  const relationMemorySlots = memories
    .map((view) => toRelationMemorySlot(context.thread.id, view))
    .filter((value): value is AgentLocalRelationMemorySlotRecord => Boolean(value))
    .slice(0, 6);

  const recallEntries = memories
    .map((view) => toRecallEntry(context.thread.id, view))
    .filter((value): value is AgentLocalRecallEntryRecord => Boolean(value))
    .slice(0, 8);

  return {
    relationMemorySlots,
    recallEntries,
  };
}
