/**
 * AI Profile / Config / Snapshot canonical types.
 *
 * Spec authority:
 *   P-AISC-001~005  AIScopeRef identity
 *   D-AIPC-001~012  Three-tier AI configuration
 *   K-AIEXEC-001~005 Runtime execution contract
 *   S-AICONF-001~006 SDK surface contract
 */

import { createNimiError } from '../../runtime/errors.js';
import { ReasonCode } from '../../types/index.js';
import type { RuntimeRouteBinding } from '../runtime-route.js';

// ---------------------------------------------------------------------------
// AIScopeRef  (P-AISC-001)
// ---------------------------------------------------------------------------

export type AIScopeKind = 'app' | 'mod' | 'module' | 'feature';

/** Canonical identity for an AI configuration scope. */
export type AIScopeRef = {
  kind: AIScopeKind;
  ownerId: string;
  surfaceId?: string;
};

// ---------------------------------------------------------------------------
// RuntimeLocalProfileRef  (shared identity for local profile references)
// ---------------------------------------------------------------------------

export type AIRuntimeLocalProfileRef = {
  modId: string;
  profileId: string;
};

// ---------------------------------------------------------------------------
// AIProfile  (D-AIPC-002) — portable template
// ---------------------------------------------------------------------------

export type AIProfileCapabilityIntent = {
  binding?: RuntimeRouteBinding | null;
  localProfileRef?: AIRuntimeLocalProfileRef | null;
  params?: Record<string, unknown>;
};

/** Portable AI configuration template. Not a live config. */
export type AIProfile = {
  profileId: string;
  title: string;
  description: string;
  tags: string[];
  capabilities: Partial<Record<string, AIProfileCapabilityIntent>>;
};

/** Traceability reference to the profile that was last applied to an AIConfig. */
export type AIProfileRef = {
  profileId: string;
  appliedAt: string;
};

// ---------------------------------------------------------------------------
// AIConfig  (D-AIPC-003) — scope-bound live config
// ---------------------------------------------------------------------------

export type AIConfigCapabilities = {
  selectedBindings: Partial<Record<string, RuntimeRouteBinding | null>>;
  localProfileRefs: Partial<Record<string, AIRuntimeLocalProfileRef | null>>;
};

/** Scope-bound live AI configuration. Keyed by AIScopeRef. */
export type AIConfig = {
  scopeRef: AIScopeRef;
  capabilities: AIConfigCapabilities;
  profileOrigin: AIProfileRef | null;
};

// ---------------------------------------------------------------------------
// AISnapshot  (D-AIPC-004) — execution evidence
// ---------------------------------------------------------------------------

/** Evidence of config state at execution start time. */
export type AIConfigEvidence = {
  profileOrigin: AIProfileRef | null;
  capabilityBindingKeys: string[];
};

/** Minimal conversation execution slice for AISnapshot embedding. */
export type AIConversationExecutionSlice = {
  executionId: string;
  createdAt: string;
  capability: string;
  selectedBinding: RuntimeRouteBinding | null;
  resolvedBinding: unknown;
  health: unknown;
  metadata: unknown;
  agentResolution: unknown;
};

/** Execution-time snapshot. Immutable after creation. */
export type AISnapshot = {
  executionId: string;
  scopeRef: AIScopeRef;
  configEvidence: AIConfigEvidence;
  conversationCapabilitySlice: AIConversationExecutionSlice;
  runtimeEvidence: AIRuntimeEvidence | null;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// AIRuntimeEvidence  (D-AIPC-004 runtimeEvidence)
// ---------------------------------------------------------------------------

/** Runtime-side execution evidence container. */
export type AIRuntimeEvidence = {
  schedulingJudgement: AISchedulingJudgement | null;
};

// ---------------------------------------------------------------------------
// Scheduling types  (K-SCHED-001~003)
// ---------------------------------------------------------------------------

/** K-SCHED-001: Six-value scheduling judgement state. */
export type AISchedulingState =
  | 'runnable'
  | 'queue_required'
  | 'preemption_risk'
  | 'slowdown_risk'
  | 'denied'
  | 'unknown';

/** K-SCHED-003: Occupancy snapshot at peek time. */
export type AISchedulingOccupancy = {
  globalUsed: number;
  globalCap: number;
  appUsed: number;
  appCap: number;
};

/** K-SCHED-007: Target-scoped resource hint. */
export type AISchedulingResourceHint = {
  estimatedVramBytes?: number | null;
  estimatedRamBytes?: number | null;
  estimatedDiskBytes?: number | null;
  engine?: string | null;
};

/** K-SCHED-002: Atomic scheduling evaluation target. */
export type AISchedulingEvaluationTarget = {
  capability: string;
  modId?: string | null;
  profileId?: string | null;
  resourceHint?: AISchedulingResourceHint | null;
};

/** K-SCHED-002: Scheduling preflight judgement result. */
export type AISchedulingJudgement = {
  state: AISchedulingState;
  detail: string | null;
  occupancy: AISchedulingOccupancy | null;
  resourceWarnings: string[];
};

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

const DEFAULT_SCOPE: AIScopeRef = { kind: 'app', ownerId: 'desktop', surfaceId: 'chat' };
const CANONICAL_MOD_SCOPE_SURFACE_ID = 'workspace';
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function normalizeRequiredId(value: string, label: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw createNimiError({
      message: `${label} is required`,
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: `provide_${label.replace(/\s+/g, '_')}`,
      source: 'sdk',
    });
  }
  return normalized;
}

/** Create the default app-level scope ref for Phase 1. */
export function createDefaultAIScopeRef(): AIScopeRef {
  return { ...DEFAULT_SCOPE };
}

/** Create the canonical Phase 1 mod workspace scope ref. */
export function createCanonicalModAIScopeRef(modId: string): AIScopeRef {
  return {
    kind: 'mod',
    ownerId: normalizeRequiredId(modId, 'mod id'),
    surfaceId: CANONICAL_MOD_SCOPE_SURFACE_ID,
  };
}

/** True when the scope matches the canonical Phase 1 mod workspace scope. */
export function isCanonicalModAIScopeRef(
  scopeRef: AIScopeRef | null | undefined,
  modId: string,
): boolean {
  if (!scopeRef) {
    return false;
  }
  const normalizedModId = String(modId || '').trim();
  if (!normalizedModId) {
    return false;
  }
  return scopeRef.kind === 'mod'
    && String(scopeRef.ownerId || '').trim() === normalizedModId
    && String(scopeRef.surfaceId || '').trim() === CANONICAL_MOD_SCOPE_SURFACE_ID;
}

/** Assert that the caller provided the canonical Phase 1 mod workspace scope. */
export function assertCanonicalModAIScopeRef(
  scopeRef: AIScopeRef | null | undefined,
  modId: string,
): AIScopeRef {
  const canonicalScopeRef = createCanonicalModAIScopeRef(modId);
  if (!scopeRef) {
    throw createNimiError({
      message: 'mod AIConfig scopeRef is required',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_explicit_mod_scope_ref',
      source: 'sdk',
    });
  }
  if (!isCanonicalModAIScopeRef(scopeRef, canonicalScopeRef.ownerId)) {
    throw createNimiError({
      message: `mod AIConfig scopeRef must equal ${canonicalScopeRef.kind}:${canonicalScopeRef.ownerId}:${canonicalScopeRef.surfaceId}`,
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'use_canonical_mod_workspace_scope_ref',
      source: 'sdk',
    });
  }
  return canonicalScopeRef;
}

/** Create an empty AIConfig for a given scope. */
export function createEmptyAIConfig(scopeRef?: AIScopeRef): AIConfig {
  return {
    scopeRef: scopeRef || createDefaultAIScopeRef(),
    capabilities: { selectedBindings: {}, localProfileRefs: {} },
    profileOrigin: null,
  };
}

// ---------------------------------------------------------------------------
// Probe result types  (S-AICONF-002)
// ---------------------------------------------------------------------------

export type AIProbeStatus = 'available' | 'unavailable' | 'degraded' | 'unknown';

export type AIConfigProbeResult = {
  status: AIProbeStatus;
  capabilityStatuses: Partial<Record<string, AIProbeStatus>>;
  schedulingJudgement?: AISchedulingJudgement | null;
};

export type AIProfileApplyResult = {
  success: boolean;
  config: AIConfig | null;
  failureReason: string | null;
  probeWarnings: string[];
};

export type AIProfileValidationResult = {
  valid: boolean;
  errors: string[];
};

// ---------------------------------------------------------------------------
// SDK typed surface  (S-AICONF-001)
// ---------------------------------------------------------------------------

/** Profile catalog and apply operations. */
export type AIProfileSurface = {
  list(): Promise<AIProfile[]>;
  get(profileId: string): Promise<AIProfile | null>;
  validate(profile: AIProfile): AIProfileValidationResult;
  apply(scopeRef: AIScopeRef, profileId: string): Promise<AIProfileApplyResult>;
  resolveLocalDependencies(profileId: string): Promise<unknown[]>;
};

/** Scope-bound config read/write operations. */
export type AIConfigSurface = {
  get(scopeRef: AIScopeRef): AIConfig;
  update(scopeRef: AIScopeRef, config: AIConfig): void;
  listScopes(): AIScopeRef[];
  probe(scopeRef: AIScopeRef): Promise<AIConfigProbeResult>;
  probeFeasibility(scopeRef: AIScopeRef): Promise<AIConfigProbeResult>;
  probeSchedulingTarget(
    scopeRef: AIScopeRef,
    target: AISchedulingEvaluationTarget,
  ): Promise<AISchedulingJudgement | null>;
  subscribe(scopeRef: AIScopeRef, callback: (config: AIConfig) => void): () => void;
};

/** Execution snapshot record/read operations. */
export type AISnapshotSurface = {
  record(scopeRef: AIScopeRef, snapshot: AISnapshot): void;
  get(executionId: string): AISnapshot | null;
  getLatest(scopeRef: AIScopeRef): AISnapshot | null;
};

/** Aggregate SDK AI config surface (S-AICONF-001~006). */
export type AIConfigSDKSurface = {
  aiProfile: AIProfileSurface;
  aiConfig: AIConfigSurface;
  aiSnapshot: AISnapshotSurface;
};

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Apply an AIProfile to an AIConfig via atomic overwrite (D-AIPC-005).
 * Returns a new AIConfig with the profile's capability intents materialized.
 * The original config's scopeRef is preserved.
 */
export function applyAIProfileToConfig(config: AIConfig, profile: AIProfile): AIConfig {
  const selectedBindings: AIConfigCapabilities['selectedBindings'] = {};
  const localProfileRefs: AIConfigCapabilities['localProfileRefs'] = {};

  for (const [capability, intent] of Object.entries(profile.capabilities)) {
    if (!intent) continue;
    if (intent.binding !== undefined) {
      selectedBindings[capability] = intent.binding;
    }
    if (intent.localProfileRef !== undefined) {
      localProfileRefs[capability] = intent.localProfileRef;
    }
  }

  return {
    scopeRef: config.scopeRef,
    capabilities: { selectedBindings, localProfileRefs },
    profileOrigin: {
      profileId: profile.profileId,
      appliedAt: new Date().toISOString(),
    },
  };
}

/** Static schema validation for AIProfile (D-AIPC-012 layer 1). */
export function validateAIProfile(profile: unknown): AIProfileValidationResult {
  const errors: string[] = [];
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return { valid: false, errors: ['profile must be a non-null object'] };
  }
  const p = profile as Record<string, unknown>;
  if (typeof p.profileId !== 'string' || !p.profileId) errors.push('profileId is required');
  if (typeof p.title !== 'string' || !p.title) errors.push('title is required');
  if (typeof p.description !== 'string') errors.push('description must be a string');
  if (!Array.isArray(p.tags)) errors.push('tags must be an array');
  if (!p.capabilities || typeof p.capabilities !== 'object' || Array.isArray(p.capabilities)) {
    errors.push('capabilities must be a non-null object');
  }
  return { valid: errors.length === 0, errors };
}

function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/** Create a canonical execution ID for AISnapshot records. */
export function createAISnapshotExecutionId(nowMs: number = Date.now()): string {
  let timeValue = BigInt(Math.max(0, Math.trunc(nowMs)));
  let timePart = '';
  for (let index = 0; index < 10; index += 1) {
    timePart = ULID_ALPHABET[Number(timeValue & 31n)] + timePart;
    timeValue >>= 5n;
  }

  let randomValue = 0n;
  for (const byte of getRandomBytes(10)) {
    randomValue = (randomValue << 8n) | BigInt(byte);
  }
  let randomPart = '';
  for (let index = 0; index < 16; index += 1) {
    randomPart = ULID_ALPHABET[Number(randomValue & 31n)] + randomPart;
    randomValue >>= 5n;
  }

  return `${timePart}${randomPart}`;
}

/** Create a canonical AISnapshot record using the published SDK schema. */
export function createAISnapshotRecord(input: {
  scopeRef?: AIScopeRef;
  config: AIConfig;
  capability: string;
  selectedBinding: RuntimeRouteBinding | null;
  resolvedBinding?: unknown;
  health?: unknown;
  metadata?: unknown;
  agentResolution?: unknown;
  runtimeEvidence?: AIRuntimeEvidence | null;
  executionId?: string;
  createdAt?: string;
}): AISnapshot {
  const executionId = String(input.executionId || '').trim() || createAISnapshotExecutionId();
  const createdAt = String(input.createdAt || '').trim() || new Date().toISOString();

  return {
    executionId,
    scopeRef: input.scopeRef || input.config.scopeRef,
    configEvidence: {
      profileOrigin: input.config.profileOrigin,
      capabilityBindingKeys: Object.keys(input.config.capabilities.selectedBindings),
    },
    conversationCapabilitySlice: {
      executionId,
      createdAt,
      capability: String(input.capability || '').trim(),
      selectedBinding: input.selectedBinding || null,
      resolvedBinding: input.resolvedBinding ?? null,
      health: input.health ?? null,
      metadata: input.metadata ?? null,
      agentResolution: input.agentResolution ?? null,
    },
    runtimeEvidence: input.runtimeEvidence ?? null,
    createdAt,
  };
}
