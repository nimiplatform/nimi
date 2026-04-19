export type AppAttentionState = {
  active: boolean;
  presence: number;
  normalizedX: number;
  normalizedY: number;
};

export type AppAttentionViewport = {
  width: number;
  height: number;
};

const APP_ATTENTION_NORMALIZED_DEADZONE = 0.035;
const APP_ATTENTION_UPDATE_EPSILON = 0.018;
const APP_ATTENTION_PRESENCE_EPSILON = 0.018;

const IDLE_APP_ATTENTION_STATE: AppAttentionState = {
  active: false,
  presence: 0,
  normalizedX: 0,
  normalizedY: 0,
};

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function clampSignedUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-1, Math.min(1, value));
}

function applyDeadzone(value: number): number {
  return Math.abs(value) < APP_ATTENTION_NORMALIZED_DEADZONE ? 0 : value;
}

export function createIdleAppAttentionState(): AppAttentionState {
  return { ...IDLE_APP_ATTENTION_STATE };
}

export function hasValidAppAttentionViewport(
  viewport: AppAttentionViewport | null | undefined,
): viewport is AppAttentionViewport {
  return Boolean(
    viewport
    && Number.isFinite(viewport.width)
    && Number.isFinite(viewport.height)
    && viewport.width > 0
    && viewport.height > 0,
  );
}

export function resolveAppAttentionStateFromViewport(input: {
  clientX: number;
  clientY: number;
  viewport: AppAttentionViewport | null | undefined;
  presence?: number;
}): AppAttentionState {
  if (!hasValidAppAttentionViewport(input.viewport)) {
    return createIdleAppAttentionState();
  }

  const normalizedX = applyDeadzone(
    clampSignedUnit(((input.clientX / input.viewport.width) * 2) - 1),
  );
  const normalizedY = applyDeadzone(
    clampSignedUnit(((input.clientY / input.viewport.height) * 2) - 1),
  );
  const presence = clampUnit(input.presence ?? 1);

  return {
    active: presence > 0,
    presence,
    normalizedX,
    normalizedY,
  };
}

export function shouldUpdateAppAttentionState(
  current: AppAttentionState,
  next: AppAttentionState,
): boolean {
  if (current.active !== next.active) {
    return true;
  }
  return Math.abs(current.presence - next.presence) >= APP_ATTENTION_PRESENCE_EPSILON
    || Math.abs(current.normalizedX - next.normalizedX) >= APP_ATTENTION_UPDATE_EPSILON
    || Math.abs(current.normalizedY - next.normalizedY) >= APP_ATTENTION_UPDATE_EPSILON;
}
