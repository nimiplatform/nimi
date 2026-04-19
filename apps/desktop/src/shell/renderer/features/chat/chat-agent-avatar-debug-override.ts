import type { ConversationCharacterData } from '@nimiplatform/nimi-kit/features/chat/headless';
import { CHAT_AGENT_AVATAR_SMOKE_OVERRIDE_EVENT } from './chat-agent-live-avatar-rail-model';
export { CHAT_AGENT_AVATAR_SMOKE_OVERRIDE_EVENT } from './chat-agent-live-avatar-rail-model';

export type ChatAgentAvatarDebugOverride = {
  phase?: NonNullable<ConversationCharacterData['interactionState']>['phase'];
  label?: string;
  emotion?: NonNullable<ConversationCharacterData['interactionState']>['emotion'];
  amplitude?: number;
  visemeId?: NonNullable<ConversationCharacterData['interactionState']>['visemeId'];
};

export const CHAT_AGENT_AVATAR_DEBUG_PHASE_OPTIONS = [
  { value: 'idle', label: 'Idle' },
  { value: 'thinking', label: 'Thinking' },
  { value: 'listening', label: 'Listening' },
  { value: 'speaking', label: 'Speaking' },
  { value: 'loading', label: 'Loading' },
] as const;

export const CHAT_AGENT_AVATAR_DEBUG_EMOTION_OPTIONS = [
  { value: 'neutral', label: 'Neutral' },
  { value: 'joy', label: 'Joy' },
  { value: 'focus', label: 'Focus' },
  { value: 'calm', label: 'Calm' },
  { value: 'playful', label: 'Playful' },
  { value: 'concerned', label: 'Concerned' },
  { value: 'surprised', label: 'Surprised' },
] as const;

function clampUnit(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return undefined;
  }
  return Math.max(0, Math.min(value, 1));
}

function normalizeText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function getOverrideHost() {
  if (typeof window === 'undefined') {
    return null;
  }
  return window as Window & typeof globalThis & {
    __NIMI_CHAT_AVATAR_SMOKE_OVERRIDE__?: Record<string, unknown> | null;
    __NIMI_LIVE2D_SMOKE_OVERRIDE__?: Record<string, unknown> | null;
  };
}

export function readChatAgentAvatarDebugOverride(): ChatAgentAvatarDebugOverride | null {
  const host = getOverrideHost();
  const value = host?.__NIMI_CHAT_AVATAR_SMOKE_OVERRIDE__ ?? host?.__NIMI_LIVE2D_SMOKE_OVERRIDE__ ?? null;
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const phase = typeof record.phase === 'string'
    && CHAT_AGENT_AVATAR_DEBUG_PHASE_OPTIONS.some((option) => option.value === record.phase)
      ? record.phase as ChatAgentAvatarDebugOverride['phase']
      : undefined;
  const emotion = typeof record.emotion === 'string'
    && CHAT_AGENT_AVATAR_DEBUG_EMOTION_OPTIONS.some((option) => option.value === record.emotion)
      ? record.emotion as ChatAgentAvatarDebugOverride['emotion']
      : undefined;
  const label = normalizeText(record.label) || undefined;
  const amplitude = clampUnit(typeof record.amplitude === 'number' ? record.amplitude : null);
  const visemeId = normalizeText(record.visemeId) as ChatAgentAvatarDebugOverride['visemeId'] | null;
  if (!phase && !emotion && !label && amplitude == null && !visemeId) {
    return null;
  }
  return {
    ...(phase ? { phase } : {}),
    ...(emotion ? { emotion } : {}),
    ...(label ? { label } : {}),
    ...(amplitude != null ? { amplitude } : {}),
    ...(visemeId ? { visemeId } : {}),
  };
}

export function applyChatAgentAvatarDebugOverride(override: ChatAgentAvatarDebugOverride): void {
  const host = getOverrideHost();
  if (!host) {
    return;
  }
  const normalized = {
    ...(override.phase ? { phase: override.phase } : {}),
    ...(override.emotion ? { emotion: override.emotion } : {}),
    ...(normalizeText(override.label) ? { label: normalizeText(override.label) } : {}),
    ...(clampUnit(override.amplitude) != null ? { amplitude: clampUnit(override.amplitude) } : {}),
    ...(normalizeText(override.visemeId) ? { visemeId: normalizeText(override.visemeId) } : {}),
  };
  host.__NIMI_CHAT_AVATAR_SMOKE_OVERRIDE__ = normalized;
  host.__NIMI_LIVE2D_SMOKE_OVERRIDE__ = normalized;
  window.dispatchEvent(new CustomEvent(CHAT_AGENT_AVATAR_SMOKE_OVERRIDE_EVENT));
}

export function clearChatAgentAvatarDebugOverride(): void {
  const host = getOverrideHost();
  if (!host) {
    return;
  }
  host.__NIMI_CHAT_AVATAR_SMOKE_OVERRIDE__ = null;
  host.__NIMI_LIVE2D_SMOKE_OVERRIDE__ = null;
  window.dispatchEvent(new CustomEvent(CHAT_AGENT_AVATAR_SMOKE_OVERRIDE_EVENT));
}
