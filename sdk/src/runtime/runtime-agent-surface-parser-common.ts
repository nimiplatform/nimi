import { ReasonCode } from '../types/index.js';
import { createNimiError } from './errors.js';
import { normalizeText, parseCount } from './helpers.js';

export function expectString(value: unknown, fieldName: string, messageType: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message: `${messageType} requires ${fieldName}`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_agent_projection_shape',
      source: 'sdk',
    });
  }
  return normalized;
}
export function expectCurrentEmotion(value: unknown, fieldName: string, messageType: string): string {
  const normalized = expectString(value, fieldName, messageType);
  if (
    normalized === 'neutral'
    || normalized === 'joy'
    || normalized === 'focus'
    || normalized === 'calm'
    || normalized === 'playful'
    || normalized === 'concerned'
    || normalized === 'surprised'
  ) {
    return normalized;
  }
  throw createNimiError({
    message: `${messageType} ${fieldName} is not an admitted current emotion`,
    reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    actionHint: 'check_runtime_agent_emotion_projection_shape',
    source: 'sdk',
  });
}
export function optionalString(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}
export function optionalContentString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
export function optionalNumber(value: unknown): number | undefined {
  return parseCount(value);
}
