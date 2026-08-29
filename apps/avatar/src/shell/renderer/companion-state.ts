import type { AgentDataBundle } from './driver/types.js';

export type CompanionAnchorBinding = {
  agentHandle: string;
  conversationAnchorId: string;
};

export type CompanionMessageCue = {
  text: string;
  at: string;
  messageId: string | null;
  turnId: string | null;
};

export type CompanionTurnTerminalCue = {
  turnId: string;
  phase: 'completed' | 'failed' | 'interrupted' | 'interrupt_ack';
  at: string;
  reason: string | null;
  interruptedTurnId: string | null;
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
  const bundleAgentHandle = normalizeText(custom['agent_handle']);
  const bundleConversationAnchorId = normalizeText(custom['conversation_anchor_id']);
  return Boolean(
    bundleAgentHandle
    && bundleConversationAnchorId
    && bundleAgentHandle === normalizeText(binding.agentHandle)
    && bundleConversationAnchorId === normalizeText(binding.conversationAnchorId),
  );
}

export function createCompanionAnchorKey(binding: CompanionAnchorBinding | null): string | null {
  if (!binding) {
    return null;
  }
  const agentHandle = normalizeText(binding.agentHandle);
  const conversationAnchorId = normalizeText(binding.conversationAnchorId);
  if (!agentHandle || !conversationAnchorId) {
    return null;
  }
  return `${agentHandle}::${conversationAnchorId}`;
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
