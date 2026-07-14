import { createNimiError, type JsonObject } from '../types';
import type {
  NimiRealmCoreSourceRef,
  NimiRealmSourceMaterializationRequest,
} from './social-types';

export function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

export function toNullableString(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized || null;
}

export function toRecord(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

export function toRecordArray(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.map(toRecord).filter((item): item is JsonObject => item !== null)
    : [];
}

export function socialError(input: {
  readonly reasonCode: string;
  readonly message: string;
  readonly actionHint: string;
  readonly details?: JsonObject;
}): Error {
  return createNimiError({
    message: input.message,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: 'realm',
    details: input.details,
  });
}

export function requireText(value: unknown, input: {
  readonly reasonCode: string;
  readonly message: string;
  readonly actionHint: string;
}): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw socialError(input);
  }
  return normalized;
}

function requireNimiRealmCoreSourceRef(input: unknown): NimiRealmCoreSourceRef {
  const sourceRef = toRecord(input);
  if (!sourceRef) {
    throw socialError({
      reasonCode: 'SDK_REALM_SOURCE_REF_REQUIRED',
      message: 'Realm sourceRef is required.',
      actionHint: 'provide_hash_bearing_realm_source_ref',
    });
  }
  const sourceRefKeys = Object.keys(sourceRef).sort();
  if (sourceRefKeys.join(',') !== 'kind,sourceContentHash,sourceId,worldId') {
    throw socialError({
      reasonCode: 'SDK_REALM_SOURCE_REF_INVALID',
      message: 'Realm sourceRef must contain only kind, worldId, sourceId, and sourceContentHash.',
      actionHint: 'provide_closed_hash_bearing_realm_source_ref',
    });
  }
  const kind = requireExactMaterializationText(sourceRef.kind, {
    field: 'sourceRef.kind',
    reasonCode: 'SDK_REALM_SOURCE_KIND_REQUIRED',
    actionHint: 'provide_world_character_or_realm_persona_source_kind',
  });
  if (kind !== 'worldCharacter' && kind !== 'realmPersona') {
    throw socialError({
      reasonCode: 'SDK_REALM_SOURCE_KIND_UNSUPPORTED',
      message: 'Realm sourceRef.kind is not supported.',
      actionHint: 'use_world_character_or_realm_persona_source_kind',
      details: { kind },
    });
  }
  return {
    kind,
    worldId: requireExactMaterializationText(sourceRef.worldId, {
      field: 'sourceRef.worldId',
      reasonCode: 'SDK_REALM_SOURCE_WORLD_ID_REQUIRED',
      actionHint: 'provide_realm_source_world_id',
    }),
    sourceId: requireExactMaterializationText(sourceRef.sourceId, {
      field: 'sourceRef.sourceId',
      reasonCode: 'SDK_REALM_SOURCE_ID_REQUIRED',
      actionHint: 'provide_realm_source_id',
    }),
    sourceContentHash: requireExactMaterializationText(sourceRef.sourceContentHash, {
      field: 'sourceRef.sourceContentHash',
      reasonCode: 'SDK_REALM_SOURCE_CONTENT_HASH_REQUIRED',
      actionHint: 'provide_current_realm_source_content_hash',
      pattern: /^[a-f0-9]{64}$/u,
    }),
  };
}

function requireExactMaterializationText(
  value: unknown,
  input: {
    readonly field: string;
    readonly reasonCode: string;
    readonly actionHint: string;
    readonly pattern?: RegExp;
    readonly maxLength?: number;
  },
): string {
  if (typeof value !== 'string'
      || value.length === 0
      || value.trim() !== value
      || (input.maxLength !== undefined && value.length > input.maxLength)
      || (input.pattern && !input.pattern.test(value))) {
    throw socialError({
      reasonCode: input.reasonCode,
      message: `Realm source materialization ${input.field} is invalid.`,
      actionHint: input.actionHint,
    });
  }
  return value;
}

function requireMaterializationLimit(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw socialError({
      reasonCode: 'SDK_REALM_SOURCE_MATERIALIZATION_LIMITS_INVALID',
      message: `Realm source materialization challengeLimits.${field} must be a positive safe integer.`,
      actionHint: 'use_runtime_issued_materialization_limits',
    });
  }
  return value;
}

function isStrictUtcRfc3339(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/u);
  if (!match) return false;
  const milliseconds = String(match[7] || '').padEnd(3, '0');
  const canonical = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${milliseconds}Z`;
  const timestamp = Date.parse(canonical);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === canonical;
}

export function requireSourceMaterializationRequest(input: unknown): NimiRealmSourceMaterializationRequest {
  const request = toRecord(input);
  if (!request) {
    throw socialError({
      reasonCode: 'SDK_REALM_SOURCE_MATERIALIZATION_REQUEST_REQUIRED',
      message: 'Realm source materialization request is required.',
      actionHint: 'provide_runtime_challenge_bound_materialization_request',
    });
  }
  const requestKeys = Object.keys(request).sort();
  if (requestKeys.join(',') !== 'challengeDigest,challengeExpiresAt,challengeId,challengeLimits,intendedRuntimeAudience,materializerAccountId,sourceRef') {
    throw socialError({
      reasonCode: 'SDK_REALM_SOURCE_MATERIALIZATION_REQUEST_INVALID',
      message: 'Realm source materialization request contains missing or unknown fields.',
      actionHint: 'provide_closed_runtime_challenge_bound_materialization_request',
    });
  }
  const challengeLimits = toRecord(request.challengeLimits);
  if (!challengeLimits
      || Object.keys(challengeLimits).sort().join(',') !== 'maxBundleBytes,maxChunkBytes,maxChunks,maxComponentCount') {
    throw socialError({
      reasonCode: 'SDK_REALM_SOURCE_MATERIALIZATION_LIMITS_INVALID',
      message: 'Realm source materialization challengeLimits is incomplete or contains unknown fields.',
      actionHint: 'use_runtime_issued_materialization_limits',
    });
  }
  const challengeExpiresAt = requireExactMaterializationText(request.challengeExpiresAt, {
    field: 'challengeExpiresAt',
    reasonCode: 'SDK_REALM_SOURCE_MATERIALIZATION_EXPIRY_INVALID',
    actionHint: 'use_runtime_issued_materialization_expiry',
  });
  if (!isStrictUtcRfc3339(challengeExpiresAt)) {
    throw socialError({
      reasonCode: 'SDK_REALM_SOURCE_MATERIALIZATION_EXPIRY_INVALID',
      message: 'Realm source materialization challengeExpiresAt must be an RFC 3339 timestamp.',
      actionHint: 'use_runtime_issued_materialization_expiry',
    });
  }
  return {
    sourceRef: requireNimiRealmCoreSourceRef(request.sourceRef),
    materializerAccountId: requireExactMaterializationText(request.materializerAccountId, {
      field: 'materializerAccountId',
      reasonCode: 'SDK_REALM_SOURCE_MATERIALIZATION_ACCOUNT_INVALID',
      actionHint: 'use_authenticated_runtime_materializer_account',
      maxLength: 256,
    }),
    challengeId: requireExactMaterializationText(request.challengeId, {
      field: 'challengeId',
      reasonCode: 'SDK_REALM_SOURCE_MATERIALIZATION_CHALLENGE_ID_INVALID',
      actionHint: 'use_runtime_issued_materialization_challenge',
      pattern: /^[A-Za-z0-9_-]{16,256}$/u,
    }),
    challengeDigest: requireExactMaterializationText(request.challengeDigest, {
      field: 'challengeDigest',
      reasonCode: 'SDK_REALM_SOURCE_MATERIALIZATION_CHALLENGE_DIGEST_INVALID',
      actionHint: 'use_runtime_issued_materialization_challenge_digest',
      pattern: /^[a-f0-9]{64}$/u,
    }),
    intendedRuntimeAudience: requireExactMaterializationText(request.intendedRuntimeAudience, {
      field: 'intendedRuntimeAudience',
      reasonCode: 'SDK_REALM_SOURCE_MATERIALIZATION_AUDIENCE_INVALID',
      actionHint: 'use_runtime_issued_materialization_audience',
      pattern: /^[\x21-\x7e]+$/u,
      maxLength: 512,
    }),
    challengeExpiresAt,
    challengeLimits: {
      maxBundleBytes: requireMaterializationLimit(challengeLimits.maxBundleBytes, 'maxBundleBytes'),
      maxComponentCount: requireMaterializationLimit(challengeLimits.maxComponentCount, 'maxComponentCount'),
      maxChunkBytes: requireMaterializationLimit(challengeLimits.maxChunkBytes, 'maxChunkBytes'),
      maxChunks: requireMaterializationLimit(challengeLimits.maxChunks, 'maxChunks'),
    },
  };
}
