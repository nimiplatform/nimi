import { i18n } from '@renderer/i18n';
import {
  createNimiRealmSourceMaterializationPacket,
  type NimiRealmSourceMaterializationPacket,
} from '@nimiplatform/sdk/realm';
import { callRealmApi, emitRealmDataError } from '@renderer/infra/realm/realm-api';
import {
  realmSourceRefKey,
  resolveRealmCoreSourceRef,
} from '@renderer/features/realm-source/realm-source-identity.js';

export {
  realmSourceRefKey,
  resolveRealmCoreSourceRef,
};

export const DESKTOP_SOURCE_MATERIALIZATION_AUDIENCE = 'nimi.desktop.local-agent.materialization';

export type RealmPersonaSourceState =
  | 'source_materializable'
  | 'source_materialization_unavailable';

export type RealmPersonaPrimaryAction =
  | 'materialize_source'
  | 'source_materialization_unavailable';

export type RealmPersonaPrimaryActionLabel = {
  state: RealmPersonaSourceState;
  action: RealmPersonaPrimaryAction;
  label: string;
  disabled: boolean;
};

export function realmPersonaSourceMaterializationMessage(): string {
  return i18n.t('Explore.realmPersonaSourceMaterializationUnavailable', {
    defaultValue: 'This source requires a current hash-bearing sourceRef before it can become a local agent.',
  });
}

export async function createRealmSourceMaterializationPacket(input: unknown): Promise<NimiRealmSourceMaterializationPacket> {
  const sourceRef = resolveRealmCoreSourceRef(input);
  if (!sourceRef) {
    throw new Error(realmPersonaSourceMaterializationMessage());
  }
  return callRealmApi(
    (realm) => createNimiRealmSourceMaterializationPacket(
      realm,
      emitRealmDataError,
      sourceRef,
      DESKTOP_SOURCE_MATERIALIZATION_AUDIENCE,
    ),
    'Failed to create Realm source materialization packet',
  );
}

export function resolveRealmPersonaSourceState(sourceInput: unknown): RealmPersonaSourceState {
  return resolveRealmCoreSourceRef(sourceInput)
    ? 'source_materializable'
    : 'source_materialization_unavailable';
}

export function describeRealmPersonaPrimaryAction(
  state: RealmPersonaSourceState,
): RealmPersonaPrimaryActionLabel {
  if (state === 'source_materialization_unavailable') {
    return {
      state,
      action: 'source_materialization_unavailable',
      label: i18n.t('Explore.realmPersonaSourceUnavailable', { defaultValue: 'Unavailable' }),
      disabled: true,
    };
  }
  return {
    state,
    action: 'materialize_source',
    label: i18n.t('Explore.realmPersonaSourceMaterialize', { defaultValue: 'Create local agent' }),
    disabled: false,
  };
}
