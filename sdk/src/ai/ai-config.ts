/**
 * AI Profile / Config / Snapshot canonical types.
 *
 * Spec authority:
 *   P-AISC-001~005  AIScopeRef identity
 *   D-AIPC-001~012  Three-tier AI configuration
 *   K-AIEXEC-001~005 Runtime execution contract
 *   S-AICONF-001~006 SDK surface contract
 */

import { createNimiError } from '../core/errors.js';
import { createNimiUlid } from '../core/ids.js';
import { ReasonCode } from '../types/index.js';
import type { JsonObject } from '../internal/utils.js';
import {
  assertBuiltInChatAIScopeRef,
  builtInChatAIScopeRefs,
  type AIScopeRef,
} from '../scope/ai-scope.js';
import type {
  AISchedulingEvaluationTarget,
  AISchedulingJudgement,
  AIRuntimeEvidence,
  RuntimeRouteBinding,
} from '../runtime/index.js';
export type { AIRuntimeEvidence } from '../runtime/index.js';
export type {
  AIScopeKind,
  AIScopeRef,
  BuiltInChatSurfaceId,
} from '../scope/ai-scope.js';
export {
  assertBuiltInChatAIScopeRef,
  builtInChatAIScopeRefs,
  createBuiltInChatAIScopeRef,
  isBuiltInChatAIScopeRef,
} from '../scope/ai-scope.js';

// ---------------------------------------------------------------------------
// RuntimeLocalProfileRef  (shared identity for local profile references)
// ---------------------------------------------------------------------------

export type AIRuntimeLocalProfileRef = {
  targetId: string;
  profileId: string;
};

// ---------------------------------------------------------------------------
// AIProfile  (D-AIPC-002) — portable template
// ---------------------------------------------------------------------------

export type AIProfileCapabilityIntent = {
  binding?: RuntimeRouteBinding | null;
  localProfileRef?: AIRuntimeLocalProfileRef | null;
  params?: JsonObject;
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
  title: string;
  appliedAt: string;
};

// ---------------------------------------------------------------------------
// AIConfig  (D-AIPC-003) — scope-bound live config
// ---------------------------------------------------------------------------

export type AIConfigCapabilities = {
  selectedBindings: Partial<Record<string, RuntimeRouteBinding | null>>;
  localProfileRefs: Partial<Record<string, AIRuntimeLocalProfileRef | null>>;
  selectedParams: Partial<Record<string, JsonObject>>;
};

/** Scope-bound live AI configuration. Keyed by AIScopeRef. */
export type AIConfig = {
  scopeRef: AIScopeRef;
  capabilities: AIConfigCapabilities;
  profileOrigin: AIProfileRef | null;
};

export {
  computeAIConfigDiff,
  computeAIConfigVersion,
  createAIConfigEvidence,
  snapshotAIConfig,
} from './ai-config-diff.js';
import { createAIConfigEvidence } from './ai-config-diff.js';

// ---------------------------------------------------------------------------
// AISnapshot  (D-AIPC-004) — execution evidence
// ---------------------------------------------------------------------------

/** Evidence of config state at execution start time. */
export type AIConfigEvidence = {
  profileOrigin: AIProfileRef | null;
  capabilityBindingKeys: string[];
  configSnapshot: AIConfig;
  configHash: string;
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

function assertExplicitAIScopeRef(scopeRef: AIScopeRef | null | undefined): AIScopeRef {
  if (!scopeRef || !String(scopeRef.kind || '').trim() || !String(scopeRef.ownerId || '').trim()) {
    throw createNimiError({
      message: 'AIConfig factory requires an explicit AIScopeRef',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_explicit_ai_scope_ref',
      source: 'sdk',
    });
  }
  const surfaceId = scopeRef.surfaceId === undefined ? undefined : String(scopeRef.surfaceId).trim();
  if (scopeRef.surfaceId !== undefined && !surfaceId) {
    throw createNimiError({
      message: 'AIScopeRef surfaceId must be omitted or non-empty',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_valid_ai_scope_ref_surface_id',
      source: 'sdk',
    });
  }
  return surfaceId === undefined
    ? { kind: scopeRef.kind, ownerId: scopeRef.ownerId }
    : { kind: scopeRef.kind, ownerId: scopeRef.ownerId, surfaceId };
}

// ---------------------------------------------------------------------------
// First-run built-in AIConfig evidence helper  (S-AICONF-007)
// ---------------------------------------------------------------------------

/**
 * One backend-issued durable built-in AIConfig evidence ref.
 *
 * The SDK keeps `ref` opaque: it does not mint, parse, or string-validate it.
 * Verification belongs to the Desktop host AIConfig service (D-AIPC-013).
 */
export type BuiltInAiConfigEvidenceRef = {
  scopeRef: AIScopeRef;
  ref: string;
};

/** Result of a first-run built-in AIConfig finalization apply (S-AICONF-007). */
export type FirstRunBuiltInAiConfigResult = {
  builtInAiConfigRefs: BuiltInAiConfigEvidenceRef[];
};

/**
 * Apply the selected first-run baseline AIProfile to a single explicit
 * canonical built-in chat scope, delegating durable evidence minting to the
 * host AIConfig service (S-AICONF-007).
 *
 * The `applyHostAiConfig` callback is the Desktop host AIConfig authority seam:
 * it owns atomic apply (D-AIPC-005) and returns the host/backend-issued durable
 * evidence ref. The SDK never mints the ref, never accepts a caller-provided
 * string as evidence, and never infers the scope from an omitted argument.
 */
export async function applyFirstRunBuiltInChatAIConfig(input: {
  scopeRef: AIScopeRef;
  profile: AIProfile;
  applyHostAiConfig: (boundScopeRef: AIScopeRef, profile: AIProfile) => Promise<string>;
}): Promise<BuiltInAiConfigEvidenceRef> {
  const boundScopeRef = assertBuiltInChatAIScopeRef(input.scopeRef);
  const validation = validateAIProfile(input.profile);
  if (!validation.valid) {
    throw createNimiError({
      message: `first-run built-in chat AIProfile is invalid: ${validation.errors.join('; ')}`,
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_valid_first_run_built_in_chat_ai_profile',
      source: 'sdk',
    });
  }
  if (typeof input.applyHostAiConfig !== 'function') {
    throw createNimiError({
      message: 'first-run built-in chat AIConfig requires a host AIConfig apply authority',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_host_ai_config_apply_authority',
      source: 'sdk',
    });
  }
  const ref = String(await input.applyHostAiConfig(boundScopeRef, input.profile) || '').trim();
  if (!ref) {
    throw createNimiError({
      message: 'host AIConfig service did not return a durable built-in AIConfig ref',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'host_ai_config_service_must_return_durable_ref',
      source: 'sdk',
    });
  }
  return { scopeRef: boundScopeRef, ref };
}

/**
 * Apply the selected first-run baseline AIProfile to BOTH canonical built-in
 * chat scopes (`desktop.chat.nimi` and `desktop.chat.agent`) and collect the
 * host-issued durable evidence refs (S-AICONF-007 / D-AIPC-013).
 *
 * Fails closed if either scope's apply fails — no partial built-in set is
 * returned. The SDK never infers a generic default scope from this path.
 */
export async function applyFirstRunBuiltInChatAIConfigs(input: {
  profile: AIProfile;
  applyHostAiConfig: (boundScopeRef: AIScopeRef, profile: AIProfile) => Promise<string>;
}): Promise<FirstRunBuiltInAiConfigResult> {
  const builtInAiConfigRefs: BuiltInAiConfigEvidenceRef[] = [];
  for (const scopeRef of builtInChatAIScopeRefs()) {
    builtInAiConfigRefs.push(
      await applyFirstRunBuiltInChatAIConfig({
        scopeRef,
        profile: input.profile,
        applyHostAiConfig: input.applyHostAiConfig,
      }),
    );
  }
  return { builtInAiConfigRefs };
}

/** Create an empty AIConfig for a given scope. */
export function createEmptyAIConfig(scopeRef: AIScopeRef): AIConfig {
  return {
    scopeRef: assertExplicitAIScopeRef(scopeRef),
    capabilities: { selectedBindings: {}, localProfileRefs: {}, selectedParams: {} },
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
// Profile apply preview  (D-AIPC-014 / S-AICONF-008)
// ---------------------------------------------------------------------------

/** One field-level before→after change inside an AIConfig diff. */
export type AIConfigFieldDiff = {
  /** Dot-path of the changed materialized field, e.g. `capabilities.selectedBindings.text.generate`. */
  path: string;
  changeKind: 'added' | 'removed' | 'changed';
  before: unknown;
  after: unknown;
};

/**
 * Typed before→after diff of a `D-AIPC-005` apply (D-AIPC-014).
 *
 * Covers the full materialized `AIConfig` shape (`capabilities`,
 * `profileOrigin`, and any other materialized fields) — never a free-form
 * summary or a partial field subset.
 */
export type AIConfigDiff = {
  /** True when `before` and `after` are byte-equivalent (no-op apply). */
  identical: boolean;
  fields: AIConfigFieldDiff[];
};

/**
 * Result of a non-committing profile apply preview (D-AIPC-014 / S-AICONF-008).
 *
 * `previewApply` returns this without mutating live config, notifying
 * subscribers, or recording a snapshot. The caller still commits via
 * `aiProfile.apply`.
 */
export type AIProfilePreviewResult = {
  /** Current AIConfig for the scope, or `null` on first apply (full creation). */
  before: AIConfig | null;
  /** Full-materialization overwrite result that `D-AIPC-005` apply would write. */
  after: AIConfig;
  /** Typed before→after diff covering all materialized AIConfig fields. */
  diff: AIConfigDiff;
  /**
   * Content hash / version of `before` (or of an empty config when `before`
   * is null) so the caller can detect a stale preview before commit.
   */
  baseVersion: string;
  /** Typed availability / feasibility warnings; advisory, never block the diff. */
  probeWarnings: string[];
};

// ---------------------------------------------------------------------------
// SDK typed surface  (S-AICONF-001)

// ---------------------------------------------------------------------------
// SDK typed surface  (S-AICONF-001)
// ---------------------------------------------------------------------------

/** Profile catalog and apply operations. */
export type AIProfileSurface = {
  list(): Promise<AIProfile[]>;
  get(profileId: string): Promise<AIProfile | null>;
  validate(profile: AIProfile): AIProfileValidationResult;
  /**
   * Compute (without committing) the typed before→after `AIConfig` diff that a
   * `D-AIPC-005` apply would produce for `scopeRef` + `profileId`
   * (D-AIPC-014 / S-AICONF-008). Does not mutate live config, notify
   * subscribers, or record a snapshot. Fails closed on schema-invalid input.
   */
  previewApply(scopeRef: AIScopeRef, profileId: string): Promise<AIProfilePreviewResult>;
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
  const selectedParams: AIConfigCapabilities['selectedParams'] = {};

  for (const [capability, intent] of Object.entries(profile.capabilities)) {
    if (!intent) continue;
    if (intent.binding !== undefined) {
      selectedBindings[capability] = intent.binding;
    }
    if (intent.localProfileRef !== undefined) {
      localProfileRefs[capability] = intent.localProfileRef;
    }
    if (intent.params !== undefined && intent.params !== null) {
      selectedParams[capability] = intent.params;
    }
  }

  return {
    scopeRef: config.scopeRef,
    capabilities: { selectedBindings, localProfileRefs, selectedParams },
    profileOrigin: {
      profileId: profile.profileId,
      title: profile.title,
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
  const p = profile as JsonObject;
  if (typeof p.profileId !== 'string' || !p.profileId) errors.push('profileId is required');
  if (typeof p.title !== 'string' || !p.title) errors.push('title is required');
  if (typeof p.description !== 'string') errors.push('description must be a string');
  if (!Array.isArray(p.tags)) errors.push('tags must be an array');
  if (!p.capabilities || typeof p.capabilities !== 'object' || Array.isArray(p.capabilities)) {
    errors.push('capabilities must be a non-null object');
  }
  return { valid: errors.length === 0, errors };
}

/** Create a canonical execution ID for AISnapshot records. */
export function createAISnapshotExecutionId(nowMs: number = Date.now()): string {
  return createNimiUlid(nowMs);
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
    configEvidence: createAIConfigEvidence(input.config),
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
