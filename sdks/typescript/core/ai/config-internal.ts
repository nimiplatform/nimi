import { createNimiError } from '../../types';
import type { NimiAIConfigFieldDiff, NimiAIHostStorage } from './config-types';

const FORBIDDEN_AI_CONFIG_FIELD_NAMES = new Set([
  'RuntimeRouteBinding',
  'selectedBindings',
  'selected_source_records',
  'selectedSourceRecords',
  'install_evidence',
  'installEvidence',
  'materialization_evidence',
  'materializationEvidence',
  'workflow_binding_id',
  'workflowBindingId',
  'prepared_asset_id',
  'preparedAssetId',
  'backend_environment_evidence',
  'backendEnvironmentEvidence',
  'provider_health',
  'providerHealth',
  'scheduler_state',
  'schedulerState',
  'credential_payload',
  'credentialPayload',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'oauth',
  'endpoint',
  'localModelId',
  'goRuntimeLocalModelId',
  'goRuntimeStatus',
  'providerHints',
  'binding',
  'localProfileRef',
  'localProfileRefs',
]);

export function createHostStorageAccess(
  label: string,
  storageProvider: (() => NimiAIHostStorage | null) | undefined,
  enableEphemeralStore: boolean | undefined,
  ephemeral: Map<string, string>,
): NimiAIHostStorage {
  const resolve = () => storageProvider?.() ?? null;
  const fail = (operation: string): never => {
    throw aiConfigError(
      'SDK_AI_HOST_STORAGE_REQUIRED',
      `${label} ${operation} requires host storage or explicit enableEphemeralStore=true`,
      'provide_ai_host_storage',
    );
  };
  return {
    getItem(key) {
      const storage = resolve();
      if (storage) return storage.getItem(key);
      if (enableEphemeralStore) return ephemeral.get(key) ?? null;
      return fail('getItem');
    },
    setItem(key, value) {
      const storage = resolve();
      if (storage) {
        storage.setItem(key, value);
        return;
      }
      if (enableEphemeralStore) {
        ephemeral.set(key, value);
        return;
      }
      return fail('setItem');
    },
    removeItem(key) {
      const storage = resolve();
      if (storage?.removeItem) {
        storage.removeItem(key);
        return;
      }
      if (storage) {
        storage.setItem(key, '');
        return;
      }
      if (enableEphemeralStore) {
        ephemeral.delete(key);
        return;
      }
      return fail('removeItem');
    },
  };
}

export function collectForbiddenPayloadErrors(value: unknown, path: string): string[] {
  const errors: string[] = [];
  if (containsPathLikeValue(value)) {
    errors.push(`${path} must be a portable non-path logical ref`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      errors.push(...collectForbiddenPayloadErrors(item, `${path}[${index}]`));
    });
    return errors;
  }
  if (!isRecord(value)) {
    return errors;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_AI_CONFIG_FIELD_NAMES.has(key)) {
      errors.push(`${path}.${key} is forbidden in AIProfile/AIConfig compact refs`);
    }
    errors.push(...collectForbiddenPayloadErrors(child, `${path}.${key}`));
  }
  return errors;
}

export function containsPathLikeValue(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.startsWith('/')
    || trimmed.startsWith('~')
    || /^[A-Za-z]:[\\/]/.test(trimmed)
    || trimmed.startsWith('file://')
    || trimmed.includes('\\')
    || trimmed.includes('/Users/')
    || trimmed.includes('/tmp/')
    || trimmed.includes('/var/');
}

export function diffJson(path: string, before: unknown, after: unknown, fields: NimiAIConfigFieldDiff[]): void {
  if (stableJson(before) === stableJson(after)) {
    return;
  }
  if (isPlainDiffObject(before) && isPlainDiffObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) {
      diffJson(path ? `${path}.${key}` : key, before[key], after[key], fields);
    }
    return;
  }
  fields.push({
    path: path || '$',
    changeKind: before === undefined ? 'added' : after === undefined ? 'removed' : 'changed',
    before,
    after,
  });
}

export function isPlainDiffObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

export function readJsonArray(raw: string | null): readonly unknown[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function asAIRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw aiConfigError(
      'SDK_AI_PAYLOAD_INVALID',
      `${label} must be a non-null object`,
      'provide_object_payload',
    );
  }
  return value;
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw aiConfigError(
      'SDK_AI_PAYLOAD_INVALID',
      `${label} must be a string`,
      'provide_string_field',
    );
  }
  return value;
}

export function requireArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw aiConfigError(
      'SDK_AI_PAYLOAD_INVALID',
      `${label} must be an array`,
      'provide_array_field',
    );
  }
  return value;
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function requireNonEmptyText(value: unknown, message: string, actionHint: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw aiConfigError('SDK_AI_INPUT_INVALID', message, actionHint);
  }
  return normalized;
}

export function aiConfigError(code: string, message: string, actionHint: string): never {
  throw createNimiError({
    message,
    code,
    reasonCode: code,
    actionHint,
    source: 'sdk',
  });
}
