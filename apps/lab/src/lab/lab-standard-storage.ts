import type { JsonValue } from '@nimiplatform/kit/shell/renderer/bridge';

import { getLabLocalAppClient } from '../shell/local-app-runtime-platform.js';

export const LAB_STANDARD_STORAGE_UNAVAILABLE_REASON_CODE = 'LAB_LOCAL_APP_STORAGE_UNAVAILABLE';

type JsonNormalizationState = {
  nodes: number;
  ancestors: Set<object>;
};

function invalidStorageValue(path: string, detail: string): never {
  throw new Error(`Lab standard storage value ${detail} at ${path}.`);
}

function normalizeStorageJsonValue(
  value: unknown,
  path: string,
  depth: number,
  state: JsonNormalizationState,
): JsonValue {
  state.nodes += 1;
  if (depth > 32 || state.nodes > 100_000) {
    return invalidStorageValue(path, 'exceeds structural bounds');
  }
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return invalidStorageValue(path, 'contains a non-finite number');
    return value;
  }
  if (!value || typeof value !== 'object') {
    return invalidStorageValue(path, 'is not JSON-compatible');
  }
  if (state.ancestors.has(value)) return invalidStorageValue(path, 'contains a cycle');

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) => {
        const normalized = normalizeStorageJsonValue(entry, `${path}[${index}]`, depth + 1, state);
        if (normalized === undefined) {
          return invalidStorageValue(`${path}[${index}]`, 'contains undefined in an array');
        }
        return normalized;
      });
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      return invalidStorageValue(path, 'contains a non-plain object');
    }
    if (Reflect.ownKeys(value).some((key) => typeof key !== 'string')) {
      return invalidStorageValue(path, 'contains a symbol key');
    }
    const normalized: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      const next = normalizeStorageJsonValue(entry, `${path}.${key}`, depth + 1, state);
      if (next !== undefined) {
        Object.defineProperty(normalized, key, {
          value: next,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
    return normalized;
  } finally {
    state.ancestors.delete(value);
  }
}

export function normalizeLabStandardStorageJsonValue(value: unknown): JsonValue {
  const normalized = normalizeStorageJsonValue(value, '$', 0, {
    nodes: 0,
    ancestors: new Set<object>(),
  });
  if (normalized === undefined) return invalidStorageValue('$', 'cannot be undefined');
  return normalized;
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { reasonCode?: unknown; code?: unknown };
  const tokens = [record.reasonCode, record.code]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.toLowerCase());
  return tokens.some((value) => value === 'not-found' || value === 'app_storage_entry_not_found');
}

export async function readLabStandardStorageJson(relativePath: string): Promise<JsonValue | undefined> {
  try {
    const result = await getLabLocalAppClient().storage.readJson(relativePath);
    return result.value;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

export async function writeLabStandardStorageJson(relativePath: string, value: unknown): Promise<void> {
  await getLabLocalAppClient().storage.writeJson(
    relativePath,
    normalizeLabStandardStorageJsonValue(value),
  );
}
