import type {
  RealmTypedCallOptions,
  WorldPublicDetailDto,
} from '../core-generated/realm-typed-client';
import { createNimiError, type JsonObject } from '../types';

export type NimiRealmWorldIdentity = {
  readonly id: string;
  readonly name: string;
};

export type NimiRealmWorldPublicDataErrorEmitter = (
  action: string,
  error: unknown,
  details?: JsonObject,
) => void;

export type NimiRealmWorldPublicApi = {
  readonly worldPublic: {
    readonly worldPublicControllerGetWorld: (
      request: { readonly path: { readonly worldId: string } },
      options?: RealmTypedCallOptions,
    ) => Promise<WorldPublicDetailDto>;
  };
};

export async function loadNimiRealmWorldIdentityById(
  realm: NimiRealmWorldPublicApi,
  emitRealmDataError: NimiRealmWorldPublicDataErrorEmitter,
  worldIdInput: unknown,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmWorldIdentity> {
  const worldId = requireText(worldIdInput, {
    reasonCode: 'SDK_REALM_WORLD_ID_REQUIRED',
    message: 'Realm world id is required.',
    actionHint: 'provide_realm_world_id',
  });
  try {
    const world = await realm.worldPublic.worldPublicControllerGetWorld({
      path: { worldId },
    }, options);
    const id = requireText(world.id, {
      reasonCode: 'SDK_REALM_WORLD_ID_REQUIRED',
      message: 'Realm world identity is missing id.',
      actionHint: 'check_realm_world_public_payload',
    });
    const name = requireText(world.name, {
      reasonCode: 'SDK_REALM_WORLD_NAME_REQUIRED',
      message: 'Realm world identity is missing name.',
      actionHint: 'check_realm_world_public_payload',
    });
    return { id, name };
  } catch (error) {
    emitRealmDataError('load-world-identity', error, { worldId });
    throw error;
  }
}

function requireText(value: unknown, input: {
  readonly reasonCode: string;
  readonly message: string;
  readonly actionHint: string;
}): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message: input.message,
      reasonCode: input.reasonCode,
      actionHint: input.actionHint,
      source: 'realm',
    });
  }
  return normalized;
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}
