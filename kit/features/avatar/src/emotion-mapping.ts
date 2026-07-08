import type { AvatarEmotionCue } from './types.js';

export const RUNTIME_AGENT_EMOTION_IDS = [
  'happy',
  'sad',
  'shy',
  'angry',
  'surprised',
  'confused',
  'excited',
  'worried',
  'embarrassed',
  'neutral',
  'ext:apologetic',
  'ext:proud',
  'ext:lonely',
  'ext:grateful',
] as const;

export type RuntimeAgentEmotionId = (typeof RUNTIME_AGENT_EMOTION_IDS)[number];
export type RuntimeAgentEmotionIntensity = 'weak' | 'moderate' | 'strong';

const RUNTIME_AGENT_EMOTION_ID_SET = new Set<string>(RUNTIME_AGENT_EMOTION_IDS);
const RUNTIME_AGENT_EMOTION_INTENSITY_SET = new Set<string>(['weak', 'moderate', 'strong']);

export function parseRuntimeAgentEmotionId(value: string): RuntimeAgentEmotionId {
  const normalized = String(value ?? '').trim();
  if (RUNTIME_AGENT_EMOTION_ID_SET.has(normalized)) {
    return normalized as RuntimeAgentEmotionId;
  }
  throw Object.assign(new Error(`Runtime Agent emotion id is not admitted: ${normalized || 'empty'}`), {
    reasonCode: 'runtime-agent-emotion-id-not-admitted',
    actionHint: 'emit_admitted_runtime_agent_emotion_id',
    source: 'kit',
    rawValue: normalized,
  });
}

export function parseRuntimeAgentEmotionIntensity(value: unknown): RuntimeAgentEmotionIntensity | null {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  if (RUNTIME_AGENT_EMOTION_INTENSITY_SET.has(normalized)) {
    return normalized as RuntimeAgentEmotionIntensity;
  }
  throw Object.assign(new Error(`Runtime Agent emotion intensity is not admitted: ${normalized}`), {
    reasonCode: 'runtime-agent-emotion-intensity-not-admitted',
    actionHint: 'emit_admitted_runtime_agent_emotion_intensity',
    source: 'kit',
    rawValue: normalized,
  });
}

export function mapRuntimeAgentEmotionToAvatarCue(
  id: RuntimeAgentEmotionId,
  _intensity?: RuntimeAgentEmotionIntensity,
): AvatarEmotionCue {
  switch (id) {
    case 'happy':
    case 'ext:proud':
    case 'ext:grateful':
      return 'joy';
    case 'excited':
      return 'playful';
    case 'sad':
    case 'worried':
    case 'angry':
    case 'ext:apologetic':
    case 'ext:lonely':
      return 'concerned';
    case 'surprised':
      return 'surprised';
    case 'confused':
      return 'focus';
    case 'shy':
    case 'embarrassed':
      return 'calm';
    case 'neutral':
      return 'neutral';
  }
  return assertNeverEmotionId(id);
}

function assertNeverEmotionId(id: never): never {
  throw Object.assign(new Error(`Unhandled Runtime Agent emotion id: ${String(id)}`), {
    reasonCode: 'runtime-agent-emotion-id-unhandled',
    actionHint: 'update_avatar_emotion_mapping',
    source: 'kit',
  });
}
