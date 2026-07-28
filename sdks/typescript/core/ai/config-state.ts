import type {
  NimiAIConfig,
  NimiAIConfigEvidence,
  NimiAIConfigDiff,
  NimiAIConfigFieldDiff,
  NimiAIConfigTargetRef,
  NimiAIConversationExecutionSlice,
  NimiAIRuntimeEvidence,
  NimiAISnapshot,
  NimiAIScopeRef,
} from './config-types';
import { areNimiAIScopeRefsEqual, assertNimiAIScopeRef, validateNimiAIConfig } from './config-scope';
import {
  aiConfigError,
  diffJson,
  formatNimiAIValidationIssues,
  requireNonEmptyText,
  stableHash,
  stableJson,
} from './config-internal';

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // pragma: allowlist secret

export function createNimiAISnapshotRecord(input: {
  readonly executionId?: string;
  readonly scopeRef?: NimiAIScopeRef;
  readonly config: NimiAIConfig;
  readonly capability: string;
  readonly selectedTargetRef: NimiAIConfigTargetRef | null;
  readonly resolvedTarget?: unknown;
  readonly health?: unknown;
  readonly metadata?: unknown;
  readonly agentResolution?: unknown;
  readonly runtimeEvidence?: NimiAIRuntimeEvidence | null;
  readonly createdAt?: string;
}): NimiAISnapshot {
  const executionId = normalizeText(input.executionId) || createNimiAISnapshotExecutionId();
  const createdAt = normalizeText(input.createdAt) || new Date().toISOString();
  const scopeRef = input.scopeRef ?? input.config.scopeRef;
  if (!areNimiAIScopeRefsEqual(scopeRef, input.config.scopeRef)) {
    throw aiConfigError('SDK_AI_SNAPSHOT_SCOPE_MISMATCH', 'AISnapshot scopeRef must match AIConfig scopeRef', 'use_matching_ai_snapshot_scope');
  }
  return normalizeNimiAISnapshot({
    executionId,
    scopeRef,
    configEvidence: createNimiAIConfigEvidence(input.config),
    conversationCapabilitySlice: {
      executionId,
      createdAt,
      capability: requireNonEmptyText(input.capability, 'capability is required', 'provide_ai_snapshot_capability'),
      selectedTargetRef: input.selectedTargetRef,
      resolvedTarget: input.resolvedTarget ?? null,
      health: input.health ?? null,
      metadata: input.metadata ?? null,
      agentResolution: input.agentResolution ?? null,
    },
    runtimeEvidence: input.runtimeEvidence ?? null,
    createdAt,
  });
}

export function createNimiAIConfigEvidence(config: NimiAIConfig): NimiAIConfigEvidence {
  const snapshot = normalizeNimiAIConfig(config);
  return {
    profileOrigin: snapshot.profileOrigin,
    capabilityBindingKeys: Object.keys(snapshot.capabilities.targetRefs).sort(),
    configSnapshot: snapshot,
    configHash: versionNimiAIConfig(snapshot),
  };
}

export function createNimiAISnapshotExecutionId(nowMs: number = Date.now()): string {
  let timeValue = BigInt(normalizeUlidTimestamp(nowMs));
  let timePart = '';
  for (let index = 0; index < 10; index += 1) {
    timePart = ULID_ALPHABET[Number(timeValue & 31n)] + timePart;
    timeValue >>= 5n;
  }
  const random = randomBytes(16);
  let randomPart = '';
  for (const value of random) {
    randomPart += ULID_ALPHABET[value & 31];
  }
  return `${timePart}${randomPart}`;
}

export function versionNimiAIConfig(config: NimiAIConfig): string {
  return `v1-${stableHash(stableJson(normalizeNimiAIConfig(config)))}`;
}

export function diffNimiAIConfigs(before: NimiAIConfig | null, after: NimiAIConfig | null): NimiAIConfigDiff {
  const fields: NimiAIConfigFieldDiff[] = [];
  diffJson('', before, after, fields);
  return {
    identical: fields.length === 0,
    fields,
  };
}

export function normalizeNimiAIConfig(config: NimiAIConfig): NimiAIConfig {
  return {
    scopeRef: assertNimiAIScopeRef(config.scopeRef),
    capabilities: {
      targetRefs: { ...(config.capabilities?.targetRefs ?? {}) },
      selectedParams: { ...(config.capabilities?.selectedParams ?? {}) },
    },
    profileOrigin: config.profileOrigin ? { ...config.profileOrigin } : null,
  };
}

export function parseStoredNimiAIConfig(raw: string, scopeRef: NimiAIScopeRef): NimiAIConfig {
  const parsed = normalizeNimiAIConfig(JSON.parse(raw) as NimiAIConfig);
  if (!areNimiAIScopeRefsEqual(parsed.scopeRef, scopeRef)) {
    throw aiConfigError('SDK_AI_CONFIG_SCOPE_MISMATCH', 'Stored AIConfig scopeRef does not match requested scopeRef', 'repair_ai_config_store');
  }
  const validation = validateNimiAIConfig(parsed);
  if (!validation.valid) {
    throw aiConfigError(
      'SDK_AI_CONFIG_INVALID',
      `Stored AIConfig is invalid: ${formatNimiAIValidationIssues(validation.issues)}`,
      'repair_ai_config_store',
    );
  }
  return parsed;
}

export function normalizeNimiAISnapshot(snapshot: NimiAISnapshot): NimiAISnapshot {
  const scopeRef = assertNimiAIScopeRef(snapshot.scopeRef);
  const configEvidence = normalizeNimiAIConfigEvidence(snapshot.configEvidence);
  if (!areNimiAIScopeRefsEqual(scopeRef, configEvidence.configSnapshot.scopeRef)) {
    throw aiConfigError('SDK_AI_SNAPSHOT_SCOPE_MISMATCH', 'AISnapshot scopeRef must match config evidence scopeRef', 'repair_ai_snapshot_store');
  }
  const conversationCapabilitySlice = normalizeNimiAIConversationExecutionSlice(snapshot.conversationCapabilitySlice);
  const executionId = requireNonEmptyText(snapshot.executionId, 'snapshot executionId is required', 'provide_ai_snapshot_execution_id');
  if (conversationCapabilitySlice.executionId !== executionId) {
    throw aiConfigError('SDK_AI_SNAPSHOT_EXECUTION_MISMATCH', 'AISnapshot executionId must match conversation slice executionId', 'repair_ai_snapshot_store');
  }
  return {
    executionId,
    scopeRef,
    configEvidence,
    conversationCapabilitySlice,
    runtimeEvidence: snapshot.runtimeEvidence ? normalizeNimiAIRuntimeEvidence(snapshot.runtimeEvidence) : null,
    createdAt: requireNonEmptyText(snapshot.createdAt, 'snapshot createdAt is required', 'provide_ai_snapshot_created_at'),
  };
}

function normalizeNimiAIConfigEvidence(evidence: NimiAIConfigEvidence): NimiAIConfigEvidence {
  const configSnapshot = normalizeNimiAIConfig(evidence.configSnapshot);
  const configHash = versionNimiAIConfig(configSnapshot);
  return {
    profileOrigin: configSnapshot.profileOrigin,
    capabilityBindingKeys: Object.keys(configSnapshot.capabilities.targetRefs).sort(),
    configSnapshot,
    configHash,
  };
}

function normalizeNimiAIConversationExecutionSlice(
  slice: NimiAIConversationExecutionSlice,
): NimiAIConversationExecutionSlice {
  return {
    executionId: requireNonEmptyText(slice.executionId, 'conversation executionId is required', 'provide_ai_snapshot_execution_id'),
    createdAt: requireNonEmptyText(slice.createdAt, 'conversation createdAt is required', 'provide_ai_snapshot_created_at'),
    capability: requireNonEmptyText(slice.capability, 'conversation capability is required', 'provide_ai_snapshot_capability'),
    selectedTargetRef: slice.selectedTargetRef,
    resolvedTarget: slice.resolvedTarget ?? null,
    health: slice.health ?? null,
    metadata: slice.metadata ?? null,
    agentResolution: slice.agentResolution ?? null,
  };
}

function normalizeNimiAIRuntimeEvidence(evidence: NimiAIRuntimeEvidence): NimiAIRuntimeEvidence {
  return {
    schedulingJudgement: evidence.schedulingJudgement ?? null,
  };
}

function normalizeUlidTimestamp(nowMs: number): number {
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    return Date.now();
  }
  return Math.floor(nowMs);
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const cryptoObject = globalThis.crypto;
  if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
    cryptoObject.getRandomValues(bytes);
    return bytes;
  }
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}
