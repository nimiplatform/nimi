import type {
  NimiRealmCoreSourceRef,
  NimiRealmPublicSourceLocator,
} from '@nimiplatform/sdk/realm';

type SourceIdentityField = keyof NimiRealmCoreSourceRef;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readText(value: unknown): string {
  return String(value || '').trim();
}

function readRecordText(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeRealmSourceKind(value: unknown): NimiRealmCoreSourceRef['kind'] | null {
  const normalized = readText(value);
  if (normalized === 'worldCharacter' || normalized === 'WORLD_CHARACTER') {
    return 'worldCharacter';
  }
  if (normalized === 'realmPersona' || normalized === 'REALM_PERSONA') {
    return 'realmPersona';
  }
  return null;
}

export function realmSourceRefKey(sourceRef: NimiRealmCoreSourceRef): string {
  return `${sourceRef.kind}:${sourceRef.worldId}:${sourceRef.sourceId}:${sourceRef.sourceContentHash}`;
}

export function readRealmCoreSourceRef(value: unknown): NimiRealmCoreSourceRef | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const kind = normalizeRealmSourceKind(record.kind);
  const worldId = readRecordText(record, 'worldId');
  const sourceId = readRecordText(record, 'sourceId');
  const sourceContentHash = readRecordText(record, 'sourceContentHash');
  if (!kind || !worldId || !sourceId || !sourceContentHash) {
    return null;
  }
  return { kind, worldId, sourceId, sourceContentHash };
}

function readOuterSourceIdentity(record: Record<string, unknown>): Partial<NimiRealmCoreSourceRef> {
  const kind = normalizeRealmSourceKind(record.sourceKind ?? record.kind ?? record.originKind);
  const worldId = readRecordText(record, 'sourceWorldId')
    || readRecordText(record, 'worldId')
    || readRecordText(record, 'homeWorldId');
  const sourceId = readRecordText(record, 'sourceId') || readRecordText(record, 'id');
  const sourceContentHash = readRecordText(record, 'sourceContentHash')
    || readRecordText(record, 'contentHash');
  return {
    ...(kind ? { kind } : {}),
    ...(worldId ? { worldId } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(sourceContentHash ? { sourceContentHash } : {}),
  };
}

function findSourceRefMismatch(
  outer: Partial<NimiRealmCoreSourceRef>,
  sourceRef: NimiRealmCoreSourceRef,
): SourceIdentityField | null {
  const fields: readonly SourceIdentityField[] = ['kind', 'worldId', 'sourceId', 'sourceContentHash'];
  for (const field of fields) {
    if (outer[field] && outer[field] !== sourceRef[field]) {
      return field;
    }
  }
  return null;
}

export function assertRealmCoreSourceRefMatchesOuterIdentity(
  input: unknown,
  sourceRef: NimiRealmCoreSourceRef | null | undefined,
  label?: string,
): void {
  if (!sourceRef) {
    return;
  }
  const record = asRecord(input);
  if (!record) {
    return;
  }
  const mismatch = findSourceRefMismatch(readOuterSourceIdentity(record), sourceRef);
  if (mismatch) {
    const labelPrefix = label ? `${label} ` : '';
    throw new Error(`${labelPrefix}sourceRef mismatch: ${mismatch}`);
  }
}

export function resolveRealmCoreSourceRef(input: unknown): NimiRealmCoreSourceRef | null {
  const record = asRecord(input);
  if (!record) {
    return null;
  }

  const nestedSourceRefRecord = asRecord(record.sourceRef);
  if (nestedSourceRefRecord) {
    const sourceRef = readRealmCoreSourceRef(nestedSourceRefRecord);
    if (!sourceRef) {
      return null;
    }
    try {
      assertRealmCoreSourceRefMatchesOuterIdentity(record, sourceRef);
    } catch {
      return null;
    }
    return sourceRef;
  }

  const outer = readOuterSourceIdentity(record);
  if (!outer.kind || !outer.worldId || !outer.sourceId || !outer.sourceContentHash) {
    return null;
  }
  return {
    kind: outer.kind,
    worldId: outer.worldId,
    sourceId: outer.sourceId,
    sourceContentHash: outer.sourceContentHash,
  };
}

export function resolveRealmPublicSourceLocator(input: unknown): NimiRealmPublicSourceLocator | null {
  const record = asRecord(input);
  if (!record) {
    return null;
  }

  const nestedSourceRefRecord = asRecord(record.sourceRef);
  if (nestedSourceRefRecord) {
    const sourceRef = readRealmCoreSourceRef(nestedSourceRefRecord);
    if (sourceRef) {
      try {
        assertRealmCoreSourceRefMatchesOuterIdentity(record, sourceRef);
      } catch {
        return null;
      }
      return {
        kind: sourceRef.kind,
        worldId: sourceRef.worldId,
        sourceId: sourceRef.sourceId,
      };
    }
  }

  const outer = readOuterSourceIdentity(record);
  if (!outer.kind || !outer.worldId || !outer.sourceId) {
    return null;
  }
  return {
    kind: outer.kind,
    worldId: outer.worldId,
    sourceId: outer.sourceId,
  };
}
