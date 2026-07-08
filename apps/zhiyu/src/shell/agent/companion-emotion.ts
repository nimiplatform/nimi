import {
  mapRuntimeAgentEmotionToAvatarCue,
  parseRuntimeAgentEmotionId,
  parseRuntimeAgentEmotionIntensity,
  type AvatarEmotionCue,
  type RuntimeAgentEmotionId,
  type RuntimeAgentEmotionIntensity,
} from '@nimiplatform/kit/features/avatar/headless';

export type ZhiyuCompanionEmotionViolation = {
  readonly rawValue: string;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
};

export type ZhiyuCompanionEmotionProjection = {
  readonly currentEmotion: RuntimeAgentEmotionId | null;
  readonly currentEmotionId: RuntimeAgentEmotionId | null;
  readonly currentEmotionCue: AvatarEmotionCue | null;
  readonly currentEmotionIntensity: RuntimeAgentEmotionIntensity | null;
  readonly emotionViolation: ZhiyuCompanionEmotionViolation | null;
};

export function initialZhiyuCompanionEmotionProjection(): ZhiyuCompanionEmotionProjection {
  return {
    currentEmotion: null,
    currentEmotionId: null,
    currentEmotionCue: null,
    currentEmotionIntensity: null,
    emotionViolation: null,
  };
}

export function projectZhiyuCompanionEmotion(input: {
  readonly current: ZhiyuCompanionEmotionProjection;
  readonly emotion: unknown;
  readonly intensity?: unknown;
}): ZhiyuCompanionEmotionProjection {
  const rawValue = normalizeEmotionText(input.emotion);
  if (!rawValue) {
    return input.current;
  }
  try {
    const id = parseRuntimeAgentEmotionId(rawValue);
    const intensity = parseRuntimeAgentEmotionIntensity(input.intensity);
    if (id === 'neutral' && intensity) {
      throw Object.assign(new Error('Runtime Agent neutral emotion must not carry intensity.'), {
        reasonCode: 'runtime-agent-neutral-emotion-intensity-not-admitted',
        actionHint: 'omit_neutral_runtime_agent_emotion_intensity',
        source: 'zhiyu',
        rawValue,
      });
    }
    return {
      currentEmotion: id,
      currentEmotionId: id,
      currentEmotionCue: mapRuntimeAgentEmotionToAvatarCue(id, intensity ?? undefined),
      currentEmotionIntensity: intensity,
      emotionViolation: null,
    };
  } catch (error) {
    return {
      ...input.current,
      emotionViolation: emotionViolationFromError(error, rawValue),
    };
  }
}

export function formatZhiyuCompanionEmotionLabel(input: ZhiyuCompanionEmotionProjection): string {
  if (input.emotionViolation) {
    return '情绪未识别';
  }
  if (!input.currentEmotionId) {
    return '情绪待同步';
  }
  const label = ZHIYU_COMPANION_EMOTION_LABELS[input.currentEmotionId];
  const intensityLabel = input.currentEmotionIntensity
    ? ZHIYU_COMPANION_EMOTION_INTENSITY_LABELS[input.currentEmotionIntensity]
    : '';
  return intensityLabel ? `${intensityLabel}${label}` : label;
}

const ZHIYU_COMPANION_EMOTION_LABELS: Readonly<Record<RuntimeAgentEmotionId, string>> = {
  happy: '开心',
  sad: '低落',
  shy: '害羞',
  angry: '生气',
  surprised: '惊讶',
  confused: '困惑',
  excited: '兴奋',
  worried: '担心',
  embarrassed: '窘迫',
  neutral: '平静',
  'ext:apologetic': '歉意',
  'ext:proud': '自豪',
  'ext:lonely': '孤单',
  'ext:grateful': '感激',
};

const ZHIYU_COMPANION_EMOTION_INTENSITY_LABELS: Readonly<Record<RuntimeAgentEmotionIntensity, string>> = {
  weak: '轻微',
  moderate: '明显',
  strong: '强烈',
};

function emotionViolationFromError(error: unknown, rawValue: string): ZhiyuCompanionEmotionViolation {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'Runtime Agent emotion projection failed.';
  return {
    rawValue,
    reasonCode: normalizeEmotionText(record.reasonCode) || 'runtime-agent-emotion-projection-invalid',
    actionHint: normalizeEmotionText(record.actionHint) || 'emit_admitted_runtime_agent_emotion',
    source: normalizeEmotionText(record.source) || 'zhiyu',
    message,
  };
}

function normalizeEmotionText(value: unknown): string {
  return String(value ?? '').trim();
}
