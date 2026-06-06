import type { AgentRequestContext } from '../core-generated/runtime-protobuf/runtime/v1/agent_common';
import { createNimiError, ReasonCode } from '../types';

export interface RuntimeLocalAgentIdentityInput {
  readonly ownerUserId: unknown;
  readonly realmAgentId: unknown;
  readonly localAgentRef?: unknown;
}

export interface RuntimeLocalAgentIdentityProjection {
  readonly ownerUserId: string;
  readonly realmAgentId: string;
  readonly localAgentRef: string;
}

export interface RuntimeAgentRequestContextInput {
  readonly runtimeAppId: unknown;
  readonly subjectUserId: unknown;
  readonly localAgentRef: unknown;
  readonly scopedBinding?: AgentRequestContext['scopedBinding'];
}

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
  readonly ownerUserId: unknown;
  readonly realmAgentId: unknown;
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

export function parseRuntimeLocalAgentIdentity(localAgentRef: unknown): RuntimeLocalAgentIdentityProjection {
  const normalized = normalizeIdentityPart(localAgentRef);
  const parts = normalized.split(':');
  if (parts.length !== 3 || parts[0] !== 'local-agent') {
    localAgentIdentityError('runtime local agent identity localAgentRef is malformed');
  }
  return projectRuntimeLocalAgentIdentity({
    ownerUserId: parts[1],
    realmAgentId: parts[2],
    localAgentRef: normalized,
  });
}

export function buildRuntimeAgentRequestContext(input: RuntimeAgentRequestContextInput): AgentRequestContext {
  const appId = normalizeIdentityPart(input.runtimeAppId);
  if (!appId) {
    localAgentIdentityError('runtime agent request context requires runtimeAppId');
  }
  const subjectUserId = normalizeIdentityPart(input.subjectUserId);
  if (!subjectUserId) {
    localAgentIdentityError('runtime agent request context requires subjectUserId');
  }
  return {
    appId,
    subjectUserId,
    ...(input.scopedBinding ? { scopedBinding: input.scopedBinding } : {}),
    ...parseRuntimeLocalAgentIdentity(input.localAgentRef),
  };
}
