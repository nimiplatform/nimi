import type { JsonValue } from '../../types';
import {
  asRecord,
  assertExactProjectionKeys,
  localAppError,
  localAppProjectionError,
  nonNegativeInteger,
} from './local-app-runtime-platform-validation';

const MAX_LOCAL_APP_STORAGE_PATH_BYTES = 240;
const MAX_LOCAL_APP_STORAGE_DOCUMENT_BYTES = 256 * 1024;

export type NimiAppRuntimeStorageDocument = {
  readonly value: JsonValue;
  readonly sizeBytes: number;
};

export type NimiAppRuntimeStorageRemoveResult = {
  readonly removed: boolean;
};

type StorageShell = {
  readonly readJson: (relativePath: string) => Promise<unknown>;
  readonly writeJson: (relativePath: string, value: JsonValue) => Promise<unknown>;
  readonly removeJson: (relativePath: string) => Promise<unknown>;
};

export type NimiAppRuntimeStorageClient = {
  readonly readJson: (relativePath: string) => Promise<NimiAppRuntimeStorageDocument>;
  readonly writeJson: (relativePath: string, value: JsonValue) => Promise<NimiAppRuntimeStorageDocument>;
  readonly removeJson: (relativePath: string) => Promise<NimiAppRuntimeStorageRemoveResult>;
};

export function createNimiAppRuntimeStorageClient(
  _standardShell: StorageShell,
): NimiAppRuntimeStorageClient {
  const unavailable = async (): Promise<never> => protectedAppAccessUnavailable();
  return Object.freeze({
    readJson: unavailable,
    writeJson: unavailable,
    removeJson: unavailable,
  });
}

function protectedAppAccessUnavailable(): never {
  return localAppError(
    'Protected App operations are unavailable until Runtime establishes a fresh App Access session.',
    'SDK_LOCAL_APP_ACCESS_UNAVAILABLE',
    'retry_after_protected_session_establishment',
  );
}

function projectStorageDocument(value: unknown): NimiAppRuntimeStorageDocument {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['value', 'sizeBytes'], 'storage document');
  const sizeBytes = nonNegativeInteger(record.sizeBytes, 'storage document sizeBytes');
  if (sizeBytes > MAX_LOCAL_APP_STORAGE_DOCUMENT_BYTES) {
    localAppProjectionError('storage document sizeBytes');
  }
  assertStorageJsonValue(record.value, true);
  return { value: record.value, sizeBytes };
}

function projectStorageRemoveResult(value: unknown): NimiAppRuntimeStorageRemoveResult {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['removed'], 'storage remove result');
  if (typeof record.removed !== 'boolean') localAppProjectionError('storage remove result');
  return { removed: record.removed };
}

function requireStorageRelativePath(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.length > MAX_LOCAL_APP_STORAGE_PATH_BYTES
    || !/^[\x00-\x7f]+$/u.test(value)
    || !value.endsWith('.json')
    || value.startsWith('/')
    || /[\\:\0]/u.test(value)
    || value.split('/').some((segment) => !validStoragePathSegment(segment))
  ) {
    return localAppError(
      'Local-app storage requires a canonical relative JSON path.',
      'SDK_LOCAL_APP_STORAGE_PATH_INVALID',
      'provide_canonical_relative_json_path',
    );
  }
  return value;
}

function validStoragePathSegment(segment: string): boolean {
  if (
    segment.length === 0
    || segment.length > 128
    || segment === '.'
    || segment === '..'
    || segment.endsWith('.')
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(segment)
  ) {
    return false;
  }
  const base = segment.split('.')[0]?.toUpperCase() || '';
  return !['CON', 'PRN', 'AUX', 'NUL'].includes(base)
    && !/^(?:COM|LPT)[1-9]$/u.test(base);
}

function assertStorageJsonValue(
  value: unknown,
  projection = false,
  depth = 0,
  state = { nodes: 0, ancestors: new Set<object>() },
): asserts value is JsonValue {
  state.nodes += 1;
  if (depth > 32 || state.nodes > 100_000) return storageJsonError(projection);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || state.ancestors.has(value)) {
    return storageJsonError(projection);
  }
  state.ancestors.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) assertStorageJsonValue(entry, projection, depth + 1, state);
  } else {
    const record = asRecord(value);
    if (!record || Reflect.ownKeys(value).some((key) => typeof key !== 'string')) {
      return storageJsonError(projection);
    }
    for (const entry of Object.values(record)) {
      assertStorageJsonValue(entry, projection, depth + 1, state);
    }
  }
  state.ancestors.delete(value);
}

function storageJsonError(projection: boolean): never {
  if (projection) return localAppProjectionError('storage JSON value');
  return localAppError(
    'Local-app storage value must be bounded JSON.',
    'SDK_LOCAL_APP_STORAGE_VALUE_INVALID',
    'provide_bounded_json_value',
  );
}
