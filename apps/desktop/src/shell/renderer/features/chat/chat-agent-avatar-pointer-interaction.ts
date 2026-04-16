export type ChatAgentAvatarPointerInteractionBoost = 'idle' | 'hover' | 'engaged';

export type ChatAgentAvatarPointerInteractionState = {
  hovered: boolean;
  normalizedX: number;
  normalizedY: number;
  interactionBoost: ChatAgentAvatarPointerInteractionBoost;
};

export type ChatAgentAvatarStageRect = Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>;

const IDLE_POINTER_INTERACTION_STATE: ChatAgentAvatarPointerInteractionState = {
  hovered: false,
  normalizedX: 0,
  normalizedY: 0,
  interactionBoost: 'idle',
};
const POINTER_NORMALIZED_DEADZONE = 0.035;
const POINTER_UPDATE_EPSILON = 0.018;

function clampSignedUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-1, Math.min(1, value));
}

function applyDeadzone(value: number): number {
  return Math.abs(value) < POINTER_NORMALIZED_DEADZONE ? 0 : value;
}

export function createIdleChatAgentAvatarPointerInteractionState(): ChatAgentAvatarPointerInteractionState {
  return { ...IDLE_POINTER_INTERACTION_STATE };
}

export function resolveChatAgentAvatarPointerInteractionScopeKey(input: {
  targetId: string;
  canonicalSessionId?: string | null;
}): string {
  const sessionId = (input.canonicalSessionId || 'detached-session').trim() || 'detached-session';
  return `${sessionId}::${input.targetId}`;
}

export function hasValidChatAgentAvatarStageRect(
  rect: ChatAgentAvatarStageRect | null | undefined,
): rect is ChatAgentAvatarStageRect {
  return Boolean(
    rect
    && Number.isFinite(rect.left)
    && Number.isFinite(rect.top)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0,
  );
}

export function resolveChatAgentAvatarPointerInteraction(input: {
  clientX: number;
  clientY: number;
  rect: ChatAgentAvatarStageRect | null | undefined;
}): ChatAgentAvatarPointerInteractionState {
  if (!hasValidChatAgentAvatarStageRect(input.rect)) {
    return createIdleChatAgentAvatarPointerInteractionState();
  }

  const normalizedX = applyDeadzone(
    clampSignedUnit((((input.clientX - input.rect.left) / input.rect.width) * 2) - 1),
  );
  const normalizedY = applyDeadzone(
    clampSignedUnit((((input.clientY - input.rect.top) / input.rect.height) * 2) - 1),
  );
  const magnitude = Math.max(Math.abs(normalizedX), Math.abs(normalizedY));

  return {
    hovered: true,
    normalizedX,
    normalizedY,
    interactionBoost: magnitude >= 0.42 ? 'engaged' : 'hover',
  };
}

export function shouldUpdateChatAgentAvatarPointerInteraction(
  current: ChatAgentAvatarPointerInteractionState,
  next: ChatAgentAvatarPointerInteractionState,
): boolean {
  if (current.hovered !== next.hovered) {
    return true;
  }
  if (current.interactionBoost !== next.interactionBoost) {
    return true;
  }
  return Math.abs(current.normalizedX - next.normalizedX) >= POINTER_UPDATE_EPSILON
    || Math.abs(current.normalizedY - next.normalizedY) >= POINTER_UPDATE_EPSILON;
}
