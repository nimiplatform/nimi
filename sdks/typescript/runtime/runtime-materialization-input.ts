import {
  CharacterSourceKindV3,
  WorldEntityRefKindV3,
  type CharacterSourceRefV3,
} from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';

function materializationInputError(message: string): never {
  throw createNimiError({
    message: `Runtime Realm source materialization ${message}.`,
    reasonCode: 'SDK_RUNTIME_REALM_SOURCE_INPUT_INVALID',
    actionHint: 'provide_character_source_ref_v3_and_request_id',
    source: 'sdk',
  });
}

export function strictMaterializationRecord(
  value: unknown,
  label: string,
  allowedFields: ReadonlySet<string>,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    materializationInputError(`${label} must be an object`);
  }
  const record = value as Readonly<Record<string, unknown>>;
  const unknownField = Object.keys(record).find((field) => !allowedFields.has(field));
  if (unknownField) {
    materializationInputError(`${label}.${unknownField} is not admitted`);
  }
  return record;
}

function strictMaterializationText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    materializationInputError(`${label} must be a non-empty canonical string`);
  }
  return value;
}

function strictMaterializationHash(value: unknown, label: string): string {
  const hash = strictMaterializationText(value, label);
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    materializationInputError(`${label} must be a lowercase SHA-256 digest`);
  }
  return hash;
}

export function strictMaterializationRequestId(value: unknown): string {
  const requestId = strictMaterializationText(value, 'requestId');
  if (new TextEncoder().encode(requestId).byteLength > 256 || /[\u0000-\u001f\u007f]/u.test(requestId)) {
    materializationInputError('requestId is outside the admitted UTF-8/control-character bounds');
  }
  return requestId;
}

export function toRuntimeCharacterSourceRefV3(value: unknown): CharacterSourceRefV3 {
  const source = strictMaterializationRecord(
    value,
    'sourceRef',
    new Set(['kind', 'id', 'worldId', 'worldEntityRef', 'ownerAccountId', 'sourceHash']),
  );
  const kind = strictMaterializationText(source.kind, 'sourceRef.kind');
  const id = strictMaterializationText(source.id, 'sourceRef.id');
  const worldId = strictMaterializationText(source.worldId, 'sourceRef.worldId');
  const sourceHash = strictMaterializationHash(source.sourceHash, 'sourceRef.sourceHash');
  if (kind === 'worldCharacter') {
    if (source.ownerAccountId !== undefined) {
      materializationInputError('worldCharacter sourceRef.ownerAccountId is not admitted');
    }
    const worldEntityRef = strictMaterializationRecord(
      source.worldEntityRef,
      'sourceRef.worldEntityRef',
      new Set(['kind', 'worldId', 'entityId']),
    );
    if (strictMaterializationText(worldEntityRef.kind, 'sourceRef.worldEntityRef.kind') !== 'worldEntity') {
      materializationInputError('sourceRef.worldEntityRef.kind must be worldEntity');
    }
    const entityWorldId = strictMaterializationText(
      worldEntityRef.worldId,
      'sourceRef.worldEntityRef.worldId',
    );
    if (entityWorldId !== worldId) {
      materializationInputError('worldCharacter sourceRef world binding is inconsistent');
    }
    return {
      source: {
        oneofKind: 'worldCharacter',
        worldCharacter: {
          kind: CharacterSourceKindV3.WORLD_CHARACTER,
          id,
          worldId,
          worldEntityRef: {
            kind: WorldEntityRefKindV3.WORLD_ENTITY,
            worldId: entityWorldId,
            entityId: strictMaterializationText(
              worldEntityRef.entityId,
              'sourceRef.worldEntityRef.entityId',
            ),
          },
          sourceHash,
        },
      },
    };
  }
  if (kind === 'personaCharacter') {
    if (source.worldEntityRef !== undefined) {
      materializationInputError('personaCharacter sourceRef.worldEntityRef is not admitted');
    }
    return {
      source: {
        oneofKind: 'personaCharacter',
        personaCharacter: {
          kind: CharacterSourceKindV3.PERSONA_CHARACTER,
          id,
          worldId,
          ownerAccountId: strictMaterializationText(
            source.ownerAccountId,
            'sourceRef.ownerAccountId',
          ),
          sourceHash,
        },
      },
    };
  }
  materializationInputError('sourceRef.kind must be worldCharacter or personaCharacter');
}
