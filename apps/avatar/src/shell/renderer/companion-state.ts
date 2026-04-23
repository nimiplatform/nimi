import type { AgentDataBundle } from './driver/types.js';

export type CompanionAnchorBinding = {
  agentId: string;
  conversationAnchorId: string;
};

export type CompanionMessageCue = {
  text: string;
  at: string;
  messageId: string | null;
  turnId: string | null;
};

export type CompanionActiveTurnCue = {
  turnId: string;
  streamId: string | null;
  phase: 'accepted' | 'started' | 'streaming' | 'committed';
  text: string;
  at: string;
};

export type CompanionTurnTerminalCue = {
  turnId: string;
  phase: 'completed' | 'failed' | 'interrupted' | 'interrupt_ack';
  at: string;
  reason: string | null;
  interruptedTurnId: string | null;
};

export type CompanionState = {
  anchorKey: string | null;
  latestAssistantMessage: CompanionMessageCue | null;
  latestUserCue: CompanionMessageCue | null;
  bubbleVisible: boolean;
  inputVisible: boolean;
  draft: string;
  unread: boolean;
  sendState: 'idle' | 'sending' | 'error';
  sendError: string | null;
};

export const initialCompanionState: CompanionState = {
  anchorKey: null,
  latestAssistantMessage: null,
  latestUserCue: null,
  bubbleVisible: false,
  inputVisible: false,
  draft: '',
  unread: false,
  sendState: 'idle',
  sendError: null,
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function matchesCueBinding(
  bundle: AgentDataBundle | null,
  binding: CompanionAnchorBinding | null,
): boolean {
  if (!binding) {
    return false;
  }
  const custom = bundle?.custom;
  if (!custom || typeof custom !== 'object') {
    return false;
  }
  const bundleAgentId = normalizeText(custom['agent_id']);
  const bundleConversationAnchorId = normalizeText(custom['conversation_anchor_id']);
  return Boolean(
    bundleAgentId
    && bundleConversationAnchorId
    && bundleAgentId === normalizeText(binding.agentId)
    && bundleConversationAnchorId === normalizeText(binding.conversationAnchorId),
  );
}

export function createCompanionAnchorKey(binding: CompanionAnchorBinding | null): string | null {
  if (!binding) {
    return null;
  }
  const agentId = normalizeText(binding.agentId);
  const conversationAnchorId = normalizeText(binding.conversationAnchorId);
  if (!agentId || !conversationAnchorId) {
    return null;
  }
  return `${agentId}::${conversationAnchorId}`;
}

export function bindCompanionState(
  state: CompanionState,
  binding: CompanionAnchorBinding | null,
): CompanionState {
  const anchorKey = createCompanionAnchorKey(binding);
  if (anchorKey === state.anchorKey) {
    return state;
  }
  return {
    ...initialCompanionState,
    anchorKey,
  };
}

export function readLatestAssistantMessage(
  bundle: AgentDataBundle | null,
  binding: CompanionAnchorBinding | null,
): CompanionMessageCue | null {
  if (!matchesCueBinding(bundle, binding)) {
    return null;
  }
  const custom = bundle?.custom;
  if (!custom || typeof custom !== 'object') {
    return null;
  }
  const text = normalizeText(custom['latest_committed_message_text']);
  if (!text) {
    return null;
  }
  const at = normalizeText(custom['latest_committed_message_at']) || new Date(0).toISOString();
  const messageId = normalizeText(custom['latest_committed_message_id']) || null;
  const turnId = normalizeText(custom['latest_committed_turn_id']) || null;
  return {
    text,
    at,
    messageId,
    turnId,
  };
}

export function readActiveTurnCue(
  bundle: AgentDataBundle | null,
  binding: CompanionAnchorBinding | null,
): CompanionActiveTurnCue | null {
  if (!matchesCueBinding(bundle, binding)) {
    return null;
  }
  const custom = bundle?.custom;
  if (!custom || typeof custom !== 'object') {
    return null;
  }
  const turnId = normalizeText(custom['active_turn_id']);
  const phase = normalizeText(custom['active_turn_phase']);
  if (
    !turnId
    || (phase !== 'accepted' && phase !== 'started' && phase !== 'streaming' && phase !== 'committed')
  ) {
    return null;
  }
  return {
    turnId,
    streamId: normalizeText(custom['active_turn_stream_id']) || null,
    phase,
    text: normalizeText(custom['active_turn_text']),
    at: normalizeText(custom['active_turn_updated_at']) || new Date(0).toISOString(),
  };
}

export function readTurnTerminalCue(
  bundle: AgentDataBundle | null,
  binding: CompanionAnchorBinding | null,
): CompanionTurnTerminalCue | null {
  if (!matchesCueBinding(bundle, binding)) {
    return null;
  }
  const custom = bundle?.custom;
  if (!custom || typeof custom !== 'object') {
    return null;
  }
  const turnId = normalizeText(custom['last_turn_terminal_id']);
  const phase = normalizeText(custom['last_turn_terminal_phase']);
  if (
    !turnId
    || (phase !== 'completed' && phase !== 'failed' && phase !== 'interrupted' && phase !== 'interrupt_ack')
  ) {
    return null;
  }
  return {
    turnId,
    phase,
    at: normalizeText(custom['last_turn_terminal_at']) || new Date(0).toISOString(),
    reason: normalizeText(custom['last_turn_terminal_reason']) || null,
    interruptedTurnId: normalizeText(custom['last_interrupted_turn_id']) || null,
  };
}

export function openCompanionInput(state: CompanionState): CompanionState {
  return {
    ...state,
    bubbleVisible: true,
    inputVisible: true,
    unread: false,
    sendError: null,
  };
}

export function dismissCompanionInput(state: CompanionState): CompanionState {
  return {
    ...state,
    inputVisible: false,
    bubbleVisible: state.latestAssistantMessage !== null || state.latestUserCue !== null,
    sendError: null,
  };
}

export function collapseCompanionBubble(state: CompanionState): CompanionState {
  if (state.inputVisible || state.sendState === 'sending') {
    return state;
  }
  return {
    ...state,
    bubbleVisible: false,
    unread: false,
  };
}

export function setCompanionDraft(state: CompanionState, draft: string): CompanionState {
  return {
    ...state,
    draft,
    sendError: null,
  };
}

export function beginCompanionSubmit(
  state: CompanionState,
  input: { text: string; at: string },
): CompanionState {
  return {
    ...state,
    bubbleVisible: true,
    inputVisible: false,
    unread: false,
    draft: '',
    sendState: 'sending',
    sendError: null,
    latestUserCue: {
      text: normalizeText(input.text),
      at: input.at,
      messageId: null,
      turnId: null,
    },
  };
}

export function completeCompanionSubmit(state: CompanionState): CompanionState {
  return {
    ...state,
    sendState: 'idle',
    sendError: null,
  };
}

export function failCompanionSubmit(
  state: CompanionState,
  input: { message: string; draft: string },
): CompanionState {
  return {
    ...state,
    bubbleVisible: true,
    inputVisible: true,
    sendState: 'error',
    draft: input.draft,
    sendError: normalizeText(input.message) || 'Unable to send this anchor-bound note right now.',
  };
}

export function ingestAssistantMessage(
  state: CompanionState,
  input: {
    message: CompanionMessageCue;
    revealImmediately: boolean;
  },
): CompanionState {
  return {
    ...state,
    latestAssistantMessage: input.message,
    bubbleVisible: input.revealImmediately,
    unread: input.revealImmediately ? false : true,
    sendState: 'idle',
    sendError: null,
  };
}
