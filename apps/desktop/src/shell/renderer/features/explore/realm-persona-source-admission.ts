import { i18n } from '@renderer/i18n';
import {
  connectNimiRealmPublicSource,
  connectNimiRealmSource,
  listNimiRealmSourceConnections,
  type NimiRealmCoreSourceRef,
  type NimiRealmPublicSourceLocator,
  type NimiRealmSourceConnectionView,
} from '@nimiplatform/sdk/realm';
import type { RuntimeSourceSnapshotDto } from '@nimiplatform/sdk/realm/generated';
import { callRealmApi, emitRealmDataError } from '@renderer/infra/realm/realm-api';

export type RealmPersonaSourceState =
  | 'source_connectable'
  | 'source_connected'
  | 'source_connection_unavailable';

export type RealmPersonaPrimaryAction =
  | 'connect_source'
  | 'source_connected'
  | 'source_connection_unavailable';

export type RealmPersonaPrimaryActionLabel = {
  state: RealmPersonaSourceState;
  action: RealmPersonaPrimaryAction;
  label: string;
  disabled: boolean;
};

export type RealmPersonaSourceAdmissionProjection = {
  activeSourceRefKeys: readonly string[];
  activeSourceConnections: readonly RealmSourceConnectionProjection[];
};

export type RealmSourceConnectionProjection = {
  connectionId: string;
  ownerUserId: string;
  sourceRef: NimiRealmCoreSourceRef;
  runtimeSourceRef: string;
};

export const realmPersonaSourceAdmissionQueryKey = ['realm-source-connections', 'active'] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeSourceKind(value: unknown): NimiRealmCoreSourceRef['kind'] | null {
  const normalized = normalizeText(value);
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

export function resolveRealmCoreSourceRef(input: unknown): NimiRealmCoreSourceRef | null {
  const record = asRecord(input);
  if (!record) {
    return null;
  }

  const nestedSourceRef = asRecord(record.sourceRef);
  if (nestedSourceRef) {
    const kind = normalizeSourceKind(nestedSourceRef.kind);
    const worldId = normalizeText(nestedSourceRef.worldId);
    const sourceId = normalizeText(nestedSourceRef.sourceId);
    const sourceContentHash = normalizeText(nestedSourceRef.sourceContentHash);
    if (kind && worldId && sourceId && sourceContentHash) {
      return { kind, worldId, sourceId, sourceContentHash };
    }
  }

  const kind = normalizeSourceKind(record.sourceKind ?? record.kind);
  const sourceId = normalizeText(record.sourceId) || normalizeText(record.id);
  const worldId = normalizeText(record.sourceWorldId)
    || normalizeText(record.worldId)
    || normalizeText(record.homeWorldId);
  const sourceContentHash = normalizeText(record.sourceContentHash)
    || normalizeText(record.contentHash);

  if (!kind || !sourceId || !worldId || !sourceContentHash) {
    return null;
  }
  return { kind, worldId, sourceId, sourceContentHash };
}

export function resolveRealmPublicSourceLocator(input: unknown): NimiRealmPublicSourceLocator | null {
  const record = asRecord(input);
  if (!record) {
    return null;
  }

  const nestedSourceRef = asRecord(record.sourceRef);
  if (nestedSourceRef) {
    const kind = normalizeSourceKind(nestedSourceRef.kind);
    const worldId = normalizeText(nestedSourceRef.worldId);
    const sourceId = normalizeText(nestedSourceRef.sourceId);
    if (kind && worldId && sourceId) {
      return { kind, worldId, sourceId };
    }
  }

  const kind = normalizeSourceKind(record.sourceKind ?? record.kind);
  const sourceId = normalizeText(record.sourceId) || normalizeText(record.id);
  const worldId = normalizeText(record.sourceWorldId)
    || normalizeText(record.worldId)
    || normalizeText(record.homeWorldId);

  if (!kind || !sourceId || !worldId) {
    return null;
  }
  return { kind, worldId, sourceId };
}

export function realmPersonaSourceConnectionMessage(): string {
  return i18n.t('Explore.realmPersonaSourceConnectionUnavailable', {
    defaultValue: 'This source requires a current hash-bearing sourceRef before it can be connected.',
  });
}

export async function loadRealmPersonaSourceAdmissionProjection(): Promise<RealmPersonaSourceAdmissionProjection> {
  const connections = await callRealmApi(
    (realm) => listNimiRealmSourceConnections(realm, emitRealmDataError),
    'Failed to load Realm source connections',
  );
  const activeSourceConnections = connections.map((connection: NimiRealmSourceConnectionView): RealmSourceConnectionProjection => {
    const sourceRef = resolveRealmCoreSourceRef(connection.sourceRef);
    const runtimeSourceRef = normalizeText(connection.runtimeSourceRef);
    const connectionId = normalizeText(connection.id);
    const ownerUserId = normalizeText(connection.ownerUserId);
    if (!sourceRef || !runtimeSourceRef || !connectionId || !ownerUserId) {
      throw new Error('RealmSourceConnection projection requires id, ownerUserId, sourceRef, and runtimeSourceRef');
    }
    return { connectionId, ownerUserId, sourceRef, runtimeSourceRef };
  });
  return {
    activeSourceRefKeys: activeSourceConnections.map((connection) => realmSourceRefKey(connection.sourceRef)),
    activeSourceConnections,
  };
}

export async function connectRealmPersonaSource(input: unknown): Promise<NimiRealmSourceConnectionView> {
  const sourceRef = resolveRealmCoreSourceRef(input);
  if (!sourceRef) {
    throw new Error(realmPersonaSourceConnectionMessage());
  }
  return callRealmApi(
    (realm) => connectNimiRealmSource(realm, emitRealmDataError, sourceRef),
    'Failed to connect Realm source',
  );
}

export async function connectRealmPublicSource(input: unknown): Promise<NimiRealmSourceConnectionView> {
  const source = resolveRealmPublicSourceLocator(input);
  if (!source) {
    throw new Error(i18n.t('Explore.realmPersonaSourceConnectionUnavailable', {
      defaultValue: 'This source requires a public source locator before it can be connected.',
    }));
  }
  return callRealmApi(
    (realm) => connectNimiRealmPublicSource(realm, emitRealmDataError, source),
    'Failed to connect Realm public source',
  );
}

export async function createRealmRuntimeSourceSnapshot(input: unknown): Promise<RuntimeSourceSnapshotDto> {
  const sourceRef = resolveRealmCoreSourceRef(input);
  if (!sourceRef) {
    throw new Error(realmPersonaSourceConnectionMessage());
  }
  return callRealmApi(
    (realm) => realm.worldCore.worldCoreControllerCreateRuntimeSourceSnapshot({
      path: {},
      body: { sourceRef },
    }),
    'Failed to create Realm RuntimeSourceSnapshot',
  );
}

export function resolveRealmPersonaSourceState(
  sourceInput: unknown,
  projection: RealmPersonaSourceAdmissionProjection | null | undefined,
): RealmPersonaSourceState {
  return resolveRealmSourceConnection(sourceInput, projection)
    ? 'source_connected'
    : resolveRealmCoreSourceRef(sourceInput)
      ? 'source_connectable'
      : 'source_connection_unavailable';
}

export function resolveRealmSourceConnection(
  sourceInput: unknown,
  projection: RealmPersonaSourceAdmissionProjection | null | undefined,
): RealmSourceConnectionProjection | null {
  const sourceRef = resolveRealmCoreSourceRef(sourceInput);
  if (!sourceRef) {
    return null;
  }
  const key = realmSourceRefKey(sourceRef);
  return projection?.activeSourceConnections.find((connection) => realmSourceRefKey(connection.sourceRef) === key) ?? null;
}

export function describeRealmPersonaPrimaryAction(
  state: RealmPersonaSourceState,
): RealmPersonaPrimaryActionLabel {
  if (state === 'source_connected') {
    return {
      state,
      action: 'source_connected',
      label: i18n.t('Explore.realmPersonaSourceConnected', { defaultValue: 'Connected' }),
      disabled: true,
    };
  }
  if (state === 'source_connection_unavailable') {
    return {
      state,
      action: 'source_connection_unavailable',
      label: i18n.t('Explore.realmPersonaSourceUnavailable', { defaultValue: 'Unavailable' }),
      disabled: true,
    };
  }
  return {
    state,
    action: 'connect_source',
    label: i18n.t('Explore.realmPersonaSourceConnect', { defaultValue: 'Connect' }),
    disabled: false,
  };
}
