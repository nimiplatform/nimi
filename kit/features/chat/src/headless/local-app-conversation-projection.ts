import type {
  NimiLocalAppConversationAction,
  NimiLocalAppConversationState,
  NimiLocalAppConversationEvent,
  NimiLocalAppConversationLiveAction,
  NimiLocalAppConversationLiveTool,
  NimiLocalAppConversationMessage,
  NimiLocalAppConversationSnapshot,
  NimiLocalAppConversationTurn,
  NimiLocalAppConversationVoice,
} from '@nimiplatform/kit/core/sdk-contract';

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
  readonly status: 'applied' | 'stale';
  readonly projection: CanonicalConversationProjection;
};

/** Presentation facts from owner state, shared by every LocalAgent consumer. */
export function localAppConversationMessageState(projection: CanonicalConversationProjection, message: NimiLocalAppConversationMessage) {
  const turn = projection.turns.find(value => value.turnId === message.turnId);
  return {
    partial: message.partial,
    textPending: message.partial && turn?.status === 'active' && projection.state.textTurnId === message.turnId,
    stopped: message.partial && turn?.status === 'interrupted' && turn.terminalReason === 'user_cancel',
    mediaRunning: message.role === 'assistant' && message.parts.some(part => part.kind === 'text')
      && turn?.status === 'active' && !message.partial && projection.state.textTurnId !== message.turnId,
    canRegenerate: turn?.canRegenerate === true,
    turn,
  };
}

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
  // Runtime allocates sequence before private filtering; public gaps are legal.
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
      const turnOrder = new Map(turns.map((turn, index) => [turn.turnId, index]));
      messages = Object.freeze([...replaceByIdentity(messages, event.message, (message) => message.messageId)]
        .sort((left, right) => (turnOrder.get(left.turnId) ?? turns.length) - (turnOrder.get(right.turnId) ?? turns.length)));
      // A late image stays with its owner turn even after a newer text turn.

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
