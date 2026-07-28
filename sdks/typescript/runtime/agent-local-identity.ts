import type { AgentRequestContext } from '../core-generated/runtime-protobuf/runtime/v1/agent_common';
import { createNimiError, ReasonCode } from '../types';

export interface RuntimeLocalAgentIdentityInput {
  readonly ownerUserId: unknown;
  readonly runtimeSourceRef: unknown;
  readonly localAgentRef: unknown;
}

export interface RuntimeLocalAgentIdentityProjection {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
}

export interface RuntimeAgentRequestContextInput {
  readonly runtimeAppId: unknown;
  readonly subjectUserId: unknown;
  readonly ownerUserId: unknown;
  readonly runtimeSourceRef: unknown;
  readonly localAgentRef: unknown;
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
  const runtimeSourceRef = normalizeIdentityPart(input.runtimeSourceRef);
  if (!runtimeSourceRef) {
    localAgentIdentityError('runtime local agent identity requires runtimeSourceRef');
  }
  const localAgentRef = normalizeIdentityPart(input.localAgentRef);
  if (!isRuntimeLocalAgentRef(localAgentRef)) {
    localAgentIdentityError('runtime local agent identity localAgentRef is malformed');
  }
  if (localAgentRef === runtimeSourceRef) {
    localAgentIdentityError('runtime local agent identity localAgentRef must be Runtime-owned and opaque');
  }
  return { ownerUserId, runtimeSourceRef, localAgentRef };
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
    ...projectRuntimeLocalAgentIdentity(input),
  };
}
