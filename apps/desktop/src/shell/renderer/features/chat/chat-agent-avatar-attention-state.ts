import type { AppAttentionState } from '@renderer/app-shell/providers/app-attention-state';

export type ChatAgentAvatarAttentionBoost = 'idle' | 'attentive' | 'engaged';

export type ChatAgentAvatarAttentionState = {
  active: boolean;
  presence: number;
  normalizedX: number;
  normalizedY: number;
  attentionBoost: ChatAgentAvatarAttentionBoost;
};

const IDLE_CHAT_AGENT_AVATAR_ATTENTION_STATE: ChatAgentAvatarAttentionState = {
  active: false,
  presence: 0,
  normalizedX: 0,
  normalizedY: 0,
  attentionBoost: 'idle',
};
const ATTENTION_UPDATE_EPSILON = 0.018;
const ATTENTION_PRESENCE_EPSILON = 0.018;

export function createIdleChatAgentAvatarAttentionState(): ChatAgentAvatarAttentionState {
  return { ...IDLE_CHAT_AGENT_AVATAR_ATTENTION_STATE };
}

export function resolveChatAgentAvatarAttentionStateFromAppAttention(input: {
  attention: AppAttentionState | null | undefined;
}): ChatAgentAvatarAttentionState {
  const attention = input.attention;
  if (!attention || attention.presence <= 0) {
    return createIdleChatAgentAvatarAttentionState();
  }
  const normalizedX = attention.normalizedX;
  const normalizedY = attention.normalizedY;
  const magnitude = Math.max(Math.abs(normalizedX), Math.abs(normalizedY));

  return {
    active: attention.active,
    presence: attention.presence,
    normalizedX,
    normalizedY,
    attentionBoost: magnitude >= 0.42 ? 'engaged' : 'attentive',
  };
}

export function shouldUpdateChatAgentAvatarAttentionState(
  current: ChatAgentAvatarAttentionState,
  next: ChatAgentAvatarAttentionState,
): boolean {
  if (current.active !== next.active) {
    return true;
  }
  if (current.attentionBoost !== next.attentionBoost) {
    return true;
  }
  return Math.abs(current.presence - next.presence) >= ATTENTION_PRESENCE_EPSILON
    || Math.abs(current.normalizedX - next.normalizedX) >= ATTENTION_UPDATE_EPSILON
    || Math.abs(current.normalizedY - next.normalizedY) >= ATTENTION_UPDATE_EPSILON;
}
