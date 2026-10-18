import type {
  NimiLocalAppConversationAction,
  NimiLocalAppConversationState,
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
  readonly state: NimiLocalAppConversationState;
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

function actionIdentity(action: { readonly turnId: string; readonly actionId: string }): string {
  return JSON.stringify([action.turnId, action.actionId]);
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
    state: snapshot.state,
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
  event: Exclude<NimiLocalAppConversationEvent, {type:'state-changed'}>,
): NimiLocalAppConversationTurn {
  const current = projection.turns.find((turn) => turn.turnId === event.turnId);
  const base: NimiLocalAppConversationTurn = current || {
    turnId: event.turnId,
    origin: event.type === 'turn-accepted' ? event.origin : 'user',
    requestId: null, retryOfTurnId: null, inputTurnId: null, canRegenerate: false,
    status: 'active',
    phase: null,
    terminalReason: null,
    reasonCode: null,
    message: null,
  };
  switch (event.type) {
    case 'turn-accepted': return { ...base, origin: event.origin, requestId: event.requestId, status: 'active', phase: 'accepted' };
    case 'turn-started': return { ...base, status: 'active', phase: 'started' };
    case 'turn-completed': return {
      ...base,
      status: 'completed',
      terminalReason: event.terminalReason || null,
      reasonCode: event.reasonCode,
      message: event.message,
      canRegenerate: false,
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
  if(event.type === 'state-changed') return {status:'applied',projection:Object.freeze({...projection,throughSequence:event.sequence,state:event.state})};

  let turns = projection.turns;
  let messages = projection.messages;
  let actions = projection.actions;
  let voices = projection.voices;
  let liveActions = projection.liveActions;
  let liveTools = projection.liveTools;
  let transientByTurn = projection.transientByTurn;

  if (event.type === 'turn-accepted') turns = turns.map(turn => ({ ...turn, canRegenerate: false }));
  turns = replaceByIdentity(turns, nextTurn(projection, event), (turn) => turn.turnId);
  switch (event.type) {
    case 'text-delta': {
      const existing = messages.find(message => message.turnId === event.turnId && message.role === 'assistant' && message.parts.length === 1 && message.parts[0]?.kind === 'text');
      if (existing) {
        if (existing.partial) {
          const text = existing.parts[0];
          if (text?.kind === 'text') messages = replaceByIdentity(messages, { ...existing, parts: [{ kind: 'text', text: text.text + event.delta }] }, message => message.messageId);
        }
        break;
      }
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
      liveActions = replaceByIdentity(liveActions, event.action, actionIdentity);
      break;
    case 'live-tool':
      liveTools = replaceByIdentity(liveTools, event.tool, (tool) => tool.toolId);
      break;
    case 'message-committed': {
      messages = replaceByIdentity(messages, event.message, (message) => message.messageId);
      if (event.message.role === 'assistant' && event.message.parts.some(part => part.kind === 'text')) {
        const { [event.turnId]: _text, ...remaining } = transientByTurn;
        transientByTurn = Object.freeze(remaining);
      }
      break;
    }
    case 'action-planned':
    case 'action-started':
    case 'action-completed':
    case 'action-failed':
      actions = replaceByIdentity(actions, event.action, actionIdentity);
      break;
    case 'artifact-ready': {
      const action = actions.find((candidate) => candidate.turnId === event.turnId && candidate.actionId === event.actionId);
      if (action) {
        actions = replaceByIdentity(actions, {
          ...action,
          status: 'completed',
          projectionMessageId: event.projectionMessageId,
          artifactId: event.artifactId,
          reasonCode: null,
          message: null,
        }, actionIdentity);
      }
      break;
    }
    case 'voice-ready':
    case 'voice-failed':
      voices = replaceByIdentity(voices, event.voice, (voice) => voice.voiceId);
      break;
    case 'turn-completed': {
      const { [event.turnId]: _terminal, ...remaining } = transientByTurn;
      transientByTurn = Object.freeze(remaining);
      break;
    }
    case 'turn-failed':
    case 'turn-interrupted':
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

/** Transient preview bytes are scoped to one authenticated hydration lifetime. */
export function createCanonicalConversationMediaReader(input: {
  conversation: NimiLocalAppConversationClient;
  thread: AgentLocalThreadSummary;
  conversationAnchorId: string;
  onChange: () => void;
}) {
  const resolved = new Map<string, { mediaUrl: string | null; mimeType: string | null }>();
  const pending = new Set<string>();
  const queued: string[] = [];
  let active = 0;
  let closed = false;
  const pump = () => {
    while (!closed && active < 4 && queued.length) {
      const artifactId = queued.shift()!;
      active++;
      void resolveArtifact(input.conversation, input.thread, input.conversationAnchorId, artifactId).then(value => {
        if (!closed) { pending.delete(artifactId); resolved.set(artifactId, value); input.onChange(); }
      }).finally(() => { active--; pump(); });
    }
  };
  return {
    get(artifactId: string): { mediaUrl: string | null; mimeType: string | null } {
      if (closed) return { mediaUrl: null, mimeType: null };
      const value = resolved.get(artifactId);
      if (value) return value;
      if (!pending.has(artifactId)) {pending.add(artifactId);queued.push(artifactId);pump();}
      return { mediaUrl: null, mimeType: null };
    },
    close() {closed=true;queued.length=0;resolved.clear();pending.clear();},
  };
}

function baseMessage(input: {
  id: string;
  threadId: string;
  turnId: string;
  role: AgentLocalMessageRecord['role'];
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

function insertConversationChild(messages: AgentLocalMessageRecord[], child: AgentLocalMessageRecord): void {
  const turnId = child.metadataJson?.canonicalTurnId;
  let index = messages.length;
  for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
    if (messages[cursor]?.metadataJson?.canonicalTurnId === turnId) { index = cursor + 1; break; }
  }
  messages.splice(index, 0, child);
}

// @nimi-authority: rule.nimi.desktop.agent-projection.r029
export function materializeCanonicalConversationBundle(input: {
  media?: Pick<ReturnType<typeof createCanonicalConversationMediaReader>, 'get'>;
  thread: AgentLocalThreadSummary;
  projection: CanonicalConversationProjection;
  nowMs: number;
}): AgentLocalThreadBundle {
  const messages: AgentLocalMessageRecord[] = [];
  for (const message of input.projection.messages) {
    const turn = input.projection.turns.find(turn => turn.turnId === message.turnId);
    const text = message.parts.find((part) => part.kind === 'text');
    const artifact = message.parts.find((part) => part.kind === 'artifact-ref');
    const resolved = artifact
      ? input.media?.get(artifact.artifactId) ?? { mediaUrl: null, mimeType: null }
      : { mediaUrl: null, mimeType: null };
    const projected: AgentLocalMessageRecord = {
      ...baseMessage({
        id: message.messageId,
        threadId: input.thread.id,
        turnId: message.turnId,
        role: message.role === 'app' ? 'system' : message.role,
        kind: artifact ? 'image' : 'text',
        contentText: text?.text || '',
        status: message.partial ? turn?.status === 'active' ? 'pending' : 'error' : 'complete',
        nowMs: input.nowMs,
        metadata: {
          canonicalPartial: message.partial,
          canonicalTurnStatus: turn?.status ?? null,
          canonicalTerminalReason: turn?.terminalReason ?? null,
          canonicalCanRegenerate: turn?.canRegenerate || false,
          canonicalInputTurnId: turn?.inputTurnId || null,
          canonicalOrigin: turn?.origin || 'user',
          canonicalMediaRunning: turn?.status === 'active' && !message.partial && input.projection.state.textTurnId !== message.turnId,
          canonicalControlRejected: !message.partial && turn?.status === 'completed' && turn.reasonCode === 'AI_OUTPUT_INVALID'
            && !input.projection.actions.some(action => action.turnId === message.turnId),
          canonicalConversationAnchorId: input.projection.conversationAnchorId,
          canonicalTurnId: message.turnId,
          canonicalThroughSequence: input.projection.throughSequence,
          canonicalTruncatedBefore: input.projection.truncatedBefore,
        },
      }),
      mediaUrl: resolved.mediaUrl,
      mediaMimeType: artifact?.mimeType || resolved.mimeType,
      artifactId: artifact?.artifactId || null,
      error: message.partial && turn?.status !== 'active' && turn?.terminalReason !== 'user_cancel'
        ? { code: turn?.reasonCode || 'AI_STREAM_BROKEN', message: turn?.message || 'The reply is incomplete.' }
        : null,
    };
    if (artifact && message.role === 'assistant') insertConversationChild(messages, projected);
    else messages.push(projected);
  }

  const messageIds = new Set(messages.map((message) => message.id));
  for (const action of input.projection.actions) {
    const messageId = action.projectionMessageId || `canonical-action:${actionIdentity(action)}`;
    if (messageIds.has(messageId) || (action.status === 'completed' && !action.artifactId)) continue;
    const original = input.projection.messages.find(message => message.turnId === action.turnId && message.role === 'user');
    const textOnlyInput = original?.parts.length === 1 && original.parts[0]?.kind === 'text' ? original.parts[0].text : '';
    const resolved = action.artifactId
      ? input.media?.get(action.artifactId) ?? { mediaUrl: null, mimeType: null }
      : { mediaUrl: null, mimeType: null };
    insertConversationChild(messages, {
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
          ...(action.status === 'failed' ? {
            imageFailureReasonCode: action.reasonCode,
            imageOperationId: action.actionId,
            ...(textOnlyInput ? { retryPrompt: textOnlyInput } : {}),
          } : {}),
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
    const parent = messages.find(message => message.id === voice.messageId && message.kind === 'text' && message.role === 'assistant');
    if (!parent) continue; // The canonical sidecar remains in the bounded snapshot even when its text is outside it.
    parent.metadataJson = {
      ...parent.metadataJson,
      canonicalVoiceId: voice.voiceId,
      canonicalVoiceState: voice.state,
      canonicalVoiceArtifactId: voice.artifactId,
      canonicalVoiceReasonCode: voice.reasonCode,
    };
  }

  const turnOrder = new Map(input.projection.turns.map((turn, index) => [turn.turnId, index]));
  for (const turn of input.projection.turns) {
    const transient = input.projection.transientByTurn[turn.turnId];
    if (messages.some(message => message.role === 'assistant' && message.kind === 'text' && message.metadataJson?.canonicalTurnId === turn.turnId)) continue;
    if (!transient && !turn.inputTurnId && input.projection.state.textTurnId !== turn.turnId) continue;
    if (turn.status === 'completed') continue;
    const placeholder = {
      ...baseMessage({
        id: `canonical-turn:${turn.turnId}`,
        threadId: input.thread.id,
        turnId: turn.turnId,
        role: 'assistant',
        kind: 'text',
        contentText: transient?.text || '',
        status: turn.status === 'active' ? 'pending' : 'error',
        nowMs: input.nowMs,
        metadata: {
          canonicalTurnId: turn.turnId,
          canonicalTurnPhase: turn.phase,
          canonicalTerminalReason: turn.terminalReason,
          canonicalCanRegenerate: turn.canRegenerate,
          canonicalInputTurnId: turn.inputTurnId,
          canonicalPartial: true,
          canonicalReasoningState: transient?.reasoningState || null,
          canonicalThroughSequence: input.projection.throughSequence,
        },
      }),
      error: turn.status !== 'active' && turn.terminalReason !== 'user_cancel' ? { code: turn.reasonCode || 'AI_STREAM_BROKEN', message: turn.message || 'The reply is incomplete.' } : null,
    };
    // Empty failed attempts have no canonical text message. Keep their status
    // at the Runtime's turn position, before any later successful retry.
    const nextMessage = messages.findIndex(message => {
      const order = turnOrder.get(String(message.metadataJson?.canonicalTurnId));
      return order !== undefined && order > turnOrder.get(turn.turnId)!;
    });
    messages.splice(nextMessage < 0 ? messages.length : nextMessage, 0, placeholder);
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
      state: input.projection.state,
      conversationAnchorId: input.projection.conversationAnchorId,
      throughSequence: input.projection.throughSequence,
      truncatedBefore: input.projection.truncatedBefore,
      turns: input.projection.turns,
      actions: input.projection.actions,
      voices: input.projection.voices,
    },
  };
}
