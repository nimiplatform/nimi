import type {
  NimiLocalAppConversationAction,
  NimiLocalAppConversationClient,
  NimiLocalAppConversationEvent,
  NimiLocalAppConversationLiveAction,
  NimiLocalAppConversationLiveTool,
  NimiLocalAppConversationMessage,
  NimiLocalAppConversationSnapshot,
  NimiLocalAppConversationTurn,
  NimiLocalAppConversationVoice,
} from '@nimiplatform/sdk/app';

import type {
  AgentLocalMessageRecord,
  AgentLocalThreadBundle,
  AgentLocalThreadSummary,
  JsonObject,
} from '../../bridge/runtime-bridge/types';
import { encodeBytesAsDataUrl } from './chat-agent-runtime-shared';

type CanonicalTurnTransient = {
  readonly text: string;
  readonly reasoningState: 'started' | 'active' | 'completed' | null;
};

export type CanonicalConversationProjection = {
  readonly conversationAnchorId: string;
  readonly throughSequence: string;
  readonly truncatedBefore: boolean;
  readonly turns: readonly NimiLocalAppConversationTurn[];
  readonly messages: readonly NimiLocalAppConversationMessage[];
  readonly actions: readonly NimiLocalAppConversationAction[];
  readonly voices: readonly NimiLocalAppConversationVoice[];
  readonly liveActions: readonly NimiLocalAppConversationLiveAction[];
  readonly liveTools: readonly NimiLocalAppConversationLiveTool[];
  readonly transientByTurn: Readonly<Record<string, CanonicalTurnTransient>>;
};

export type CanonicalConversationEventReduction = {
  readonly status: 'applied' | 'stale' | 'gap';
  readonly projection: CanonicalConversationProjection;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseSequence(value: string): bigint | null {
  const normalized = normalizeText(value);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(normalized)) return null;
  try {
    return BigInt(normalized);
  } catch {
    return null;
  }
}

function replaceByIdentity<T>(
  values: readonly T[],
  value: T,
  identity: (item: T) => string,
): readonly T[] {
  const nextIdentity = identity(value);
  const index = values.findIndex((item) => identity(item) === nextIdentity);
  if (index < 0) return Object.freeze([...values, value]);
  return Object.freeze(values.map((item, itemIndex) => itemIndex === index ? value : item));
}

export function seedCanonicalConversationProjection(
  snapshot: NimiLocalAppConversationSnapshot,
): CanonicalConversationProjection {
  if (parseSequence(snapshot.throughSequence) === null) {
    throw new Error('Canonical Conversation snapshot returned an invalid throughSequence.');
  }
  return Object.freeze({
    conversationAnchorId: snapshot.conversationAnchorId,
    throughSequence: snapshot.throughSequence,
    truncatedBefore: snapshot.truncatedBefore,
    turns: Object.freeze([...snapshot.turns]),
    messages: Object.freeze([...snapshot.messages]),
    actions: Object.freeze([...snapshot.actions]),
    voices: Object.freeze([...snapshot.voices]),
    liveActions: Object.freeze([]),
    liveTools: Object.freeze([]),
    transientByTurn: Object.freeze({}),
  });
}

function nextTurn(
  projection: CanonicalConversationProjection,
  event: NimiLocalAppConversationEvent,
): NimiLocalAppConversationTurn {
  const current = projection.turns.find((turn) => turn.turnId === event.turnId);
  const base: NimiLocalAppConversationTurn = current || {
    turnId: event.turnId,
    status: 'active',
    phase: null,
    terminalReason: null,
    reasonCode: null,
    message: null,
  };
  switch (event.type) {
    case 'turn-accepted': return { ...base, status: 'active', phase: 'accepted' };
    case 'turn-started': return { ...base, status: 'active', phase: 'started' };
    case 'turn-completed': return {
      ...base,
      status: 'completed',
      terminalReason: event.terminalReason || null,
      reasonCode: null,
      message: null,
    };
    case 'turn-failed': return {
      ...base,
      status: 'failed',
      reasonCode: event.reasonCode,
      message: event.message,
    };
    case 'turn-interrupted': return {
      ...base,
      status: 'interrupted',
      terminalReason: event.reason,
      reasonCode: null,
      message: null,
    };
    default: return base;
  }
}

// @nimi-authority: rule.nimi.runtime.agent-participation.r176
export function reduceCanonicalConversationEvent(
  projection: CanonicalConversationProjection,
  event: NimiLocalAppConversationEvent,
): CanonicalConversationEventReduction {
  if (event.conversationAnchorId !== projection.conversationAnchorId) {
    throw new Error('Canonical Conversation event anchor does not match the active projection.');
  }
  const currentSequence = parseSequence(projection.throughSequence);
  const eventSequence = parseSequence(event.sequence);
  if (currentSequence === null || eventSequence === null) {
    throw new Error('Canonical Conversation event returned an invalid sequence.');
  }
  if (eventSequence <= currentSequence) return { status: 'stale', projection };
  if (eventSequence !== currentSequence + 1n) return { status: 'gap', projection };

  let turns = projection.turns;
  let messages = projection.messages;
  let actions = projection.actions;
  let voices = projection.voices;
  let liveActions = projection.liveActions;
  let liveTools = projection.liveTools;
  let transientByTurn = projection.transientByTurn;

  turns = replaceByIdentity(turns, nextTurn(projection, event), (turn) => turn.turnId);
  switch (event.type) {
    case 'text-delta': {
      const current = transientByTurn[event.turnId] || { text: '', reasoningState: null };
      transientByTurn = Object.freeze({
        ...transientByTurn,
        [event.turnId]: Object.freeze({ ...current, text: current.text + event.delta }),
      });
      break;
    }
    case 'reasoning-status': {
      const current = transientByTurn[event.turnId] || { text: '', reasoningState: null };
      transientByTurn = Object.freeze({
        ...transientByTurn,
        [event.turnId]: Object.freeze({ ...current, reasoningState: event.state }),
      });
      break;
    }
    case 'live-action':
      liveActions = replaceByIdentity(liveActions, event.action, (action) => action.actionId);
      break;
    case 'live-tool':
      liveTools = replaceByIdentity(liveTools, event.tool, (tool) => tool.toolId);
      break;
    case 'message-committed':
      messages = replaceByIdentity(messages, event.message, (message) => message.messageId);
      break;
    case 'action-planned':
    case 'action-started':
    case 'action-completed':
    case 'action-failed':
      actions = replaceByIdentity(actions, event.action, (action) => action.actionId);
      break;
    case 'artifact-ready': {
      const action = actions.find((candidate) => candidate.actionId === event.actionId);
      if (action) {
        actions = replaceByIdentity(actions, {
          ...action,
          status: 'completed',
          projectionMessageId: event.projectionMessageId,
          artifactId: event.artifactId,
          reasonCode: null,
          message: null,
        }, (candidate) => candidate.actionId);
      }
      break;
    }
    case 'voice-ready':
    case 'voice-failed':
      voices = replaceByIdentity(voices, event.voice, (voice) => voice.voiceId);
      break;
    case 'turn-completed':
    case 'turn-failed':
    case 'turn-interrupted': {
      const { [event.turnId]: _terminal, ...remaining } = transientByTurn;
      transientByTurn = Object.freeze(remaining);
      break;
    }
    case 'turn-accepted':
    case 'turn-started':
      break;
  }

  return {
    status: 'applied',
    projection: Object.freeze({
      ...projection,
      throughSequence: event.sequence,
      turns,
      messages,
      actions,
      voices,
      liveActions,
      liveTools,
      transientByTurn,
    }),
  };
}

async function resolveArtifact(
  conversation: NimiLocalAppConversationClient,
  thread: AgentLocalThreadSummary,
  conversationAnchorId: string,
  artifactId: string,
): Promise<{ mediaUrl: string | null; mimeType: string | null }> {
  try {
    const resolved = await conversation.readArtifact({
      agentHandle: thread.targetSnapshot.agentHandle as import('@nimiplatform/sdk/app').NimiLocalAppAgentHandle,
      conversationAnchorId,
      artifactId,
    });
    return {
      mediaUrl: encodeBytesAsDataUrl(resolved.mimeType, resolved.bytes),
      mimeType: resolved.mimeType,
    };
  } catch {
    return { mediaUrl: null, mimeType: null };
  }
}

function baseMessage(input: {
  id: string;
  threadId: string;
  turnId: string;
  role: 'user' | 'assistant';
  kind: 'text' | 'image' | 'voice';
  contentText: string;
  status: 'pending' | 'complete' | 'error';
  nowMs: number;
  metadata: JsonObject;
}): AgentLocalMessageRecord {
  return {
    id: input.id,
    threadId: input.threadId,
    role: input.role,
    status: input.status,
    kind: input.kind,
    contentText: input.contentText,
    reasoningText: null,
    error: null,
    traceId: null,
    parentMessageId: null,
    mediaUrl: null,
    mediaMimeType: null,
    artifactId: null,
    metadataJson: input.metadata,
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
  };
}

// @nimi-authority: rule.nimi.desktop.agent-projection.r029
export async function materializeCanonicalConversationBundle(input: {
  conversation: NimiLocalAppConversationClient;
  thread: AgentLocalThreadSummary;
  projection: CanonicalConversationProjection;
  nowMs: number;
}): Promise<AgentLocalThreadBundle> {
  const messages: AgentLocalMessageRecord[] = [];
  for (const message of input.projection.messages) {
    const text = message.parts.find((part) => part.kind === 'text');
    const artifact = message.parts.find((part) => part.kind === 'artifact-ref');
    const resolved = artifact
      ? await resolveArtifact(input.conversation, input.thread, input.projection.conversationAnchorId, artifact.artifactId)
      : { mediaUrl: null, mimeType: null };
    messages.push({
      ...baseMessage({
        id: message.messageId,
        threadId: input.thread.id,
        turnId: message.turnId,
        role: message.role,
        kind: artifact ? 'image' : 'text',
        contentText: text?.text || '',
        status: 'complete',
        nowMs: input.nowMs,
        metadata: {
          canonicalConversationAnchorId: input.projection.conversationAnchorId,
          canonicalTurnId: message.turnId,
          canonicalThroughSequence: input.projection.throughSequence,
          canonicalTruncatedBefore: input.projection.truncatedBefore,
        },
      }),
      mediaUrl: resolved.mediaUrl,
      mediaMimeType: artifact?.mimeType || resolved.mimeType,
      artifactId: artifact?.artifactId || null,
    });
  }

  const messageIds = new Set(messages.map((message) => message.id));
  for (const action of input.projection.actions) {
    const messageId = action.projectionMessageId || `canonical-action:${action.actionId}`;
    if (messageIds.has(messageId) || (action.status === 'completed' && !action.artifactId)) continue;
    const resolved = action.artifactId
      ? await resolveArtifact(input.conversation, input.thread, input.projection.conversationAnchorId, action.artifactId)
      : { mediaUrl: null, mimeType: null };
    messages.push({
      ...baseMessage({
        id: messageId,
        threadId: input.thread.id,
        turnId: action.turnId,
        role: 'assistant',
        kind: 'image',
        contentText: action.status === 'failed' ? action.message || 'Image generation failed.' : '',
        status: action.status === 'failed' ? 'error' : action.status === 'completed' ? 'complete' : 'pending',
        nowMs: input.nowMs,
        metadata: {
          canonicalTurnId: action.turnId,
          canonicalActionId: action.actionId,
          canonicalActionStatus: action.status,
          canonicalThroughSequence: input.projection.throughSequence,
        },
      }),
      artifactId: action.artifactId,
      mediaUrl: resolved.mediaUrl,
      mediaMimeType: resolved.mimeType,
      error: action.status === 'failed'
        ? { code: action.reasonCode || 'RUNTIME_CALL_FAILED', message: action.message || 'Image generation failed.' }
        : null,
    });
    messageIds.add(messageId);
  }

  for (const voice of input.projection.voices) {
    const voiceProjectionMessageId = `canonical-voice:${voice.voiceId}`;
    if (messageIds.has(voiceProjectionMessageId)) continue;
    const resolved = voice.artifactId
      ? await resolveArtifact(input.conversation, input.thread, input.projection.conversationAnchorId, voice.artifactId)
      : { mediaUrl: null, mimeType: null };
    messages.push({
      ...baseMessage({
        id: voiceProjectionMessageId,
        threadId: input.thread.id,
        turnId: voice.turnId,
        role: 'assistant',
        kind: 'voice',
        contentText: '',
        status: voice.state === 'ready' ? 'complete' : 'error',
        nowMs: input.nowMs,
        metadata: {
          canonicalTurnId: voice.turnId,
          canonicalVoiceId: voice.voiceId,
          canonicalVoiceState: voice.state,
          canonicalThroughSequence: input.projection.throughSequence,
        },
      }),
      artifactId: voice.artifactId,
      parentMessageId: voice.messageId,
      mediaUrl: resolved.mediaUrl,
      mediaMimeType: resolved.mimeType,
      error: voice.state === 'failed'
        ? { code: voice.reasonCode || 'RUNTIME_CALL_FAILED', message: voice.message || 'Voice generation failed.' }
        : null,
    });
    messageIds.add(voiceProjectionMessageId);
  }

  for (const turn of input.projection.turns) {
    const transient = input.projection.transientByTurn[turn.turnId];
    if (turn.status !== 'active' || !transient || messages.some((message) => message.metadataJson?.canonicalTurnId === turn.turnId)) continue;
    messages.push({
      ...baseMessage({
        id: `canonical-turn:${turn.turnId}`,
        threadId: input.thread.id,
        turnId: turn.turnId,
        role: 'assistant',
        kind: 'text',
        contentText: transient.text,
        status: 'pending',
        nowMs: input.nowMs,
        metadata: {
          canonicalTurnId: turn.turnId,
          canonicalTurnPhase: turn.phase,
          canonicalReasoningState: transient.reasoningState,
          canonicalThroughSequence: input.projection.throughSequence,
        },
      }),
    });
  }

  return {
    thread: {
      ...input.thread,
      createdAtMs: typeof (input.thread as unknown as { createdAtMs?: unknown }).createdAtMs === 'number'
        ? (input.thread as unknown as { createdAtMs: number }).createdAtMs
        : input.nowMs,
      updatedAtMs: input.nowMs,
      lastMessageAtMs: messages.length > 0 ? input.nowMs : input.thread.lastMessageAtMs,
    },
    messages,
    canonicalConversation: {
      conversationAnchorId: input.projection.conversationAnchorId,
      throughSequence: input.projection.throughSequence,
      truncatedBefore: input.projection.truncatedBefore,
      turns: input.projection.turns,
      actions: input.projection.actions,
      voices: input.projection.voices,
    },
  };
}
