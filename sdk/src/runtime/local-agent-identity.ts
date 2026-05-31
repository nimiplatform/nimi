import { ReasonCode } from '../types/index.js';
import { createNimiError } from './errors.js';
import type { RuntimeAgentLocalIdentity } from './types-runtime-agent-core.js';

export type RuntimeLocalAgentIdentityInput = {
  ownerUserId: unknown;
  realmAgentId: unknown;
  localAgentRef?: unknown;
};

export type RuntimeLocalAgentIdentityProjection = RuntimeAgentLocalIdentity;

function normalizeIdentityPart(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function localAgentIdentityError(message: string): never {
  throw createNimiError({
    message,
    reasonCode: ReasonCode.AI_INPUT_INVALID,
    actionHint: 'provide_runtime_agent_local_identity',
    source: 'sdk',
  });
}

export function buildRuntimeLocalAgentRef(input: {
  ownerUserId: unknown;
  realmAgentId: unknown;
}): string {
  const ownerUserId = normalizeIdentityPart(input.ownerUserId);
  if (!ownerUserId) {
    localAgentIdentityError('runtime local agent identity requires ownerUserId');
  }
  const realmAgentId = normalizeIdentityPart(input.realmAgentId);
  if (!realmAgentId) {
    localAgentIdentityError('runtime local agent identity requires realmAgentId');
  }
  return `local-agent:${ownerUserId}:${realmAgentId}`;
}

export function isRuntimeLocalAgentRef(value: unknown): value is string {
  return typeof value === 'string' && value.trim().startsWith('local-agent:');
}

export function projectRuntimeLocalAgentIdentity(
  input: RuntimeLocalAgentIdentityInput,
): RuntimeLocalAgentIdentityProjection {
  const ownerUserId = normalizeIdentityPart(input.ownerUserId);
  if (!ownerUserId) {
    localAgentIdentityError('runtime local agent identity requires ownerUserId');
  }
  const realmAgentId = normalizeIdentityPart(input.realmAgentId);
  if (!realmAgentId) {
    localAgentIdentityError('runtime local agent identity requires realmAgentId');
  }
  const expected = buildRuntimeLocalAgentRef({ ownerUserId, realmAgentId });
  const localAgentRef = normalizeIdentityPart(input.localAgentRef) || expected;
  if (!isRuntimeLocalAgentRef(localAgentRef)) {
    localAgentIdentityError('runtime local agent identity localAgentRef is malformed');
  }
  if (localAgentRef !== expected) {
    localAgentIdentityError('runtime local agent identity localAgentRef must match ownerUserId and realmAgentId');
  }
  return { ownerUserId, realmAgentId, localAgentRef };
}
