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
export function expectLocalAgentRef(value: unknown, fieldName: string, messageType: string): string {
  const localAgentRef = expectString(value, fieldName, messageType);
  if (!localAgentRef.startsWith('local-agent:')) {
    throw createNimiError({
      message: `${messageType} ${fieldName} is not a local_agent_ref`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_agent_projection_shape',
      source: 'sdk',
    });
  }
  return localAgentRef;
}
export function expectLocalAgentIdentity(
  localAgentRefValue: unknown,
  ownerUserIdValue: unknown,
  realmAgentIdValue: unknown,
  messageType: string,
): { localAgentRef: string; ownerUserId: string; realmAgentId: string } {
  const localAgentRef = expectLocalAgentRef(localAgentRefValue, 'local_agent_ref', messageType);
  const ownerUserId = expectString(ownerUserIdValue, 'owner_user_id', messageType);
  const realmAgentId = expectString(realmAgentIdValue, 'realm_agent_id', messageType);
  if (localAgentRef !== `local-agent:${ownerUserId}:${realmAgentId}`) {
    throw createNimiError({
      message: `${messageType} local_agent_ref does not match owner_user_id and realm_agent_id`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_agent_projection_shape',
      source: 'sdk',
    });
  }
  return { localAgentRef, ownerUserId, realmAgentId };
}
