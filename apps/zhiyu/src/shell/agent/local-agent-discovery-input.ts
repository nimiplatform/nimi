import type { NimiRuntimeAgentSourceRef } from '@nimiplatform/sdk/runtime';

export type ZhiyuLocalAgentDiscoveryInput = {
  readonly ownerUserId?: unknown;
  readonly runtimeSourceRef?: unknown;
  readonly sourceRef?: {
    readonly kind?: unknown;
    readonly id?: unknown;
    readonly worldId?: unknown;
    readonly sourceHash?: unknown;
    readonly ownerAccountId?: unknown;
    readonly worldEntityRef?: {
      readonly kind?: unknown;
      readonly worldId?: unknown;
      readonly entityId?: unknown;
    } | null;
  } | null;
};

export type ZhiyuLocalAgentDiscoveryProjection = {
  readonly ownerUserId: string;
  readonly runtimeSourceRef?: string;
  readonly sourceRef: NimiRuntimeAgentSourceRef;
};

export function normalizeZhiyuLocalAgentDiscoveryInput(
  input: ZhiyuLocalAgentDiscoveryInput,
): ZhiyuLocalAgentDiscoveryProjection | null {
  const ownerUserId = stringOr(input.ownerUserId, '');
  const runtimeSourceRef = stringOr(input.runtimeSourceRef, undefined);
  const sourceRef = input.sourceRef;
  if (!sourceRef) return null;
  const kind = stringOr(sourceRef?.kind, '');
  const id = stringOr(sourceRef?.id, '');
  const worldId = stringOr(sourceRef?.worldId, '');
  const sourceHash = stringOr(sourceRef?.sourceHash, '').toLowerCase();
  if (!ownerUserId || !id || !worldId || !/^[a-f0-9]{64}$/u.test(sourceHash)) {
    return null;
  }
  const normalizedSourceRef = normalizeSourceRef({ kind, id, worldId, sourceHash, sourceRef });
  if (!normalizedSourceRef) return null;
  const projection = {
    ownerUserId,
    sourceRef: normalizedSourceRef,
  };
  return runtimeSourceRef ? { ...projection, runtimeSourceRef } : projection;
}

function normalizeSourceRef(input: {
  readonly kind: string;
  readonly id: string;
  readonly worldId: string;
  readonly sourceHash: string;
  readonly sourceRef: NonNullable<ZhiyuLocalAgentDiscoveryInput['sourceRef']>;
}): NimiRuntimeAgentSourceRef | null {
  if (input.kind === 'worldCharacter') {
    const entityKind = stringOr(input.sourceRef.worldEntityRef?.kind, '');
    const entityWorldId = stringOr(input.sourceRef.worldEntityRef?.worldId, '');
    const entityId = stringOr(input.sourceRef.worldEntityRef?.entityId, '');
    if (entityKind !== 'worldEntity' || entityWorldId !== input.worldId || !entityId) return null;
    return {
      kind: 'worldCharacter',
      id: input.id,
      worldId: input.worldId,
      worldEntityRef: { kind: 'worldEntity', worldId: entityWorldId, entityId },
      sourceHash: input.sourceHash,
    };
  }
  if (input.kind === 'personaCharacter') {
    const ownerAccountId = stringOr(input.sourceRef.ownerAccountId, '');
    if (!ownerAccountId) return null;
    return {
      kind: 'personaCharacter',
      id: input.id,
      worldId: input.worldId,
      ownerAccountId,
      sourceHash: input.sourceHash,
    };
  }
  return null;
}

function stringOr(value: unknown, fallback: string): string;
function stringOr(value: unknown, fallback: undefined): string | undefined;
function stringOr(value: unknown, fallback: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
