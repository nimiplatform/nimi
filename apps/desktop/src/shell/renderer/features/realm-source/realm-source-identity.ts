import type { NimiRuntimeAgentSourceRef } from '@nimiplatform/sdk/runtime';

export type CharacterSourceRefV3 = NimiRuntimeAgentSourceRef;

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function readText(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function hasExactFields(record: Readonly<Record<string, unknown>>, fields: readonly string[]): boolean {
  const admitted = new Set(fields);
  return Object.keys(record).every((field) => admitted.has(field));
}

function isSourceHash(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

export function readCharacterSourceRefV3(value: unknown): CharacterSourceRefV3 | null {
  const record = asRecord(value);
  if (!record) return null;

  const kind = readText(record, 'kind');
  const id = readText(record, 'id');
  const worldId = readText(record, 'worldId');
  const sourceHash = readText(record, 'sourceHash');
  if (!id || !worldId || !isSourceHash(sourceHash)) return null;

  if (kind === 'worldCharacter') {
    if (!hasExactFields(record, ['kind', 'id', 'worldId', 'worldEntityRef', 'sourceHash'])) {
      return null;
    }
    const worldEntityRef = asRecord(record.worldEntityRef);
    if (!worldEntityRef
      || !hasExactFields(worldEntityRef, ['kind', 'worldId', 'entityId'])
      || readText(worldEntityRef, 'kind') !== 'worldEntity') {
      return null;
    }
    const entityWorldId = readText(worldEntityRef, 'worldId');
    const entityId = readText(worldEntityRef, 'entityId');
    if (entityWorldId !== worldId || !entityId) return null;
    return {
      kind: 'worldCharacter',
      id,
      worldId,
      worldEntityRef: { kind: 'worldEntity', worldId: entityWorldId, entityId },
      sourceHash,
    };
  }

  if (kind === 'personaCharacter') {
    if (!hasExactFields(record, ['kind', 'id', 'worldId', 'ownerAccountId', 'sourceHash'])) {
      return null;
    }
    const ownerAccountId = readText(record, 'ownerAccountId');
    if (!ownerAccountId) return null;
    return { kind: 'personaCharacter', id, worldId, ownerAccountId, sourceHash };
  }

  return null;
}

export function resolveCharacterSourceRefV3(input: unknown): CharacterSourceRefV3 | null {
  const record = asRecord(input);
  if (!record) return null;
  const nested = asRecord(record.sourceRef);
  const sourceRef = readCharacterSourceRefV3(nested ?? record);
  if (!sourceRef || !nested) return sourceRef;
  const claimedId = readText(record, 'id') || readText(record, 'sourceId');
  const claimedKind = readText(record, 'sourceKind');
  const claimedWorldId = readText(record, 'sourceWorldId') || readText(record, 'worldId');
  const claimedSourceHash = readText(record, 'sourceHash');
  if ((claimedId && claimedId !== sourceRef.id)
    || (claimedKind && claimedKind !== sourceRef.kind)
    || (claimedWorldId && claimedWorldId !== sourceRef.worldId)
    || (claimedSourceHash && claimedSourceHash !== sourceRef.sourceHash)) {
    return null;
  }
  return sourceRef;
}

export function characterSourceRefKey(sourceRef: CharacterSourceRefV3): string {
  if (sourceRef.kind === 'worldCharacter') {
    return [
      sourceRef.kind,
      sourceRef.worldId,
      sourceRef.id,
      sourceRef.worldEntityRef.entityId,
      sourceRef.sourceHash,
    ].join(':');
  }
  return [
    sourceRef.kind,
    sourceRef.worldId,
    sourceRef.id,
    sourceRef.ownerAccountId,
    sourceRef.sourceHash,
  ].join(':');
}

export function characterSourceRefsEqual(
  left: CharacterSourceRefV3,
  right: CharacterSourceRefV3,
): boolean {
  return characterSourceRefKey(left) === characterSourceRefKey(right);
}
