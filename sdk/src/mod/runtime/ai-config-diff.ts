import type {
  AIConfig,
  AIConfigDiff,
  AIConfigEvidence,
  AIConfigFieldDiff,
} from './ai-config.js';

function canonicalizeAIConfigJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeAIConfigJsonValue(item));
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const canonical: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const nextValue = record[key];
      if (nextValue !== undefined) {
        canonical[key] = canonicalizeAIConfigJsonValue(nextValue);
      }
    }
    return canonical;
  }
  return value;
}

function hashCanonicalAIConfigJson(value: string): string {
  let hashA = 0xdeadbeef ^ value.length;
  let hashB = 0x41c6ce57 ^ value.length;
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index);
    hashA = Math.imul(hashA ^ charCode, 2654435761);
    hashB = Math.imul(hashB ^ charCode, 1597334677);
  }
  hashA = Math.imul(hashA ^ (hashA >>> 16), 2246822507)
    ^ Math.imul(hashB ^ (hashB >>> 13), 3266489909);
  hashB = Math.imul(hashB ^ (hashB >>> 16), 2246822507)
    ^ Math.imul(hashA ^ (hashA >>> 13), 3266489909);
  const combined = 4294967296 * (2097151 & hashB) + (hashA >>> 0);
  return `ai-config-v1:${combined.toString(16).padStart(14, '0')}`;
}

export function snapshotAIConfig(config: AIConfig): AIConfig {
  return canonicalizeAIConfigJsonValue(config) as AIConfig;
}

export function createAIConfigEvidence(config: AIConfig): AIConfigEvidence {
  const configSnapshot = snapshotAIConfig(config);
  const canonicalJson = JSON.stringify(configSnapshot);
  return {
    profileOrigin: configSnapshot.profileOrigin,
    capabilityBindingKeys: Object.keys(configSnapshot.capabilities.selectedBindings).sort(),
    configSnapshot,
    configHash: hashCanonicalAIConfigJson(canonicalJson),
  };
}

/**
 * Compute the canonical content hash / version token of an AIConfig.
 * Used as the `baseVersion` for `AIProfilePreviewResult` CAS freshness checks.
 */
export function computeAIConfigVersion(config: AIConfig): string {
  const canonical = canonicalizeAIConfigJsonValue(config);
  return hashCanonicalAIConfigJson(JSON.stringify(canonical));
}

function diffAIConfigJsonValue(
  path: string,
  before: unknown,
  after: unknown,
  out: AIConfigFieldDiff[],
): void {
  const beforeDefined = before !== undefined;
  const afterDefined = after !== undefined;
  if (!beforeDefined && !afterDefined) {
    return;
  }
  const bothObjects = before !== null && after !== null
    && typeof before === 'object' && typeof after === 'object'
    && !Array.isArray(before) && !Array.isArray(after);
  if (bothObjects) {
    const beforeRecord = before as Record<string, unknown>;
    const afterRecord = after as Record<string, unknown>;
    const keys = Array.from(
      new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]),
    ).sort();
    for (const key of keys) {
      diffAIConfigJsonValue(
        path ? `${path}.${key}` : key,
        beforeRecord[key],
        afterRecord[key],
        out,
      );
    }
    return;
  }
  const beforeJson = beforeDefined
    ? JSON.stringify(canonicalizeAIConfigJsonValue(before))
    : undefined;
  const afterJson = afterDefined
    ? JSON.stringify(canonicalizeAIConfigJsonValue(after))
    : undefined;
  if (beforeJson === afterJson) {
    return;
  }
  let changeKind: AIConfigFieldDiff['changeKind'];
  if (!beforeDefined) {
    changeKind = 'added';
  } else if (!afterDefined) {
    changeKind = 'removed';
  } else {
    changeKind = 'changed';
  }
  out.push({
    path,
    changeKind,
    before: beforeDefined ? before : null,
    after: afterDefined ? after : null,
  });
}

/**
 * Compute a typed before→after `AIConfigDiff` for two AIConfig values
 * (D-AIPC-014). `before` is `null` for a first apply (full creation).
 */
export function computeAIConfigDiff(
  before: AIConfig | null,
  after: AIConfig,
): AIConfigDiff {
  const fields: AIConfigFieldDiff[] = [];
  diffAIConfigJsonValue('', before ?? {}, after, fields);
  return { identical: fields.length === 0, fields };
}

