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
  areAIScopeRefsEqual,
  assertBuiltInChatAIScopeRef,
  builtInChatAIScopeRefs,
  type AIScopeRef,
} from '../scope/ai-scope.js';
import type {
  AISchedulingEvaluationTarget,
  AISchedulingJudgement,
  AIRuntimeEvidence,
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
// AIProfile  (D-AIPC-002) — portable template
// ---------------------------------------------------------------------------

export type AIProfileCapabilityIntent = {
  targetRef?: AIConfigTargetRef | null;
  params?: JsonObject;
  readinessPolicy?: AIConfigReadinessPolicy;
  contractState?: AIConfigSliceContractState;
  runtimeDescriptor?: RuntimeProfileDescriptorSliceInput;
};

export type AIConfigReadinessPolicy = 'required' | 'optional';

export type AIConfigSliceContractState = 'declared' | 'proposed' | 'unsupported';

export type AIConfigApplyOutcome =
  | 'ready_to_apply'
  | 'setup_required_no_live_config'
  | 'unsupported_no_live_config'
  | 'invalid_profile'
  | 'invalid_requirement'
  | 'stale_base'
  | 'failed'
  | 'optional_omitted';

export type AIConfigSetupProjection = {
  outcome: Exclude<AIConfigApplyOutcome, 'ready_to_apply' | 'optional_omitted'>;
  blockingCapabilities: string[];
  reasonCodes: string[];
  actionRefs: string[];
};

export type AIConfigProfileSliceRef = {
  kind: 'profile_slice_ref';
  sourceProfileId: string;
  sliceId: string;
  sourceProfileVersion?: string;
  sourceProfileDigest?: string;
};

export type AIConfigLocalRuntimeTargetRef = {
  kind: 'local_runtime_target_ref';
  targetId?: string;
  profileId?: string;
  readinessRef?: string;
};

export type AIConfigCloudConnectorTargetRef = {
  kind: 'cloud_connector_target_ref';
  connectorId: string;
  providerModelId: string;
  provider?: string;
};

export type AIConfigTargetRef =
  | AIConfigProfileSliceRef
  | AIConfigLocalRuntimeTargetRef
  | AIConfigCloudConnectorTargetRef;

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
  targetRefs: Partial<Record<string, AIConfigTargetRef>>;
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
  selectedTargetRef: AIConfigTargetRef | null;
  resolvedTarget: unknown;
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
    capabilities: { targetRefs: {}, selectedParams: {} },
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
  outcome: AIConfigApplyOutcome;
  setupProjection?: AIConfigSetupProjection | null;
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
  /** Dot-path of the changed materialized field, e.g. `capabilities.targetRefs.text.generate`. */
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
  after: AIConfig | null;
  outcome: AIConfigApplyOutcome;
  setupProjection?: AIConfigSetupProjection | null;
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

export type AIProfileApplyOptions = {
  /**
   * Optional CAS freshness guard from `previewApply.baseVersion`. Hosts remain
   * the write authority and must fail closed when the current config no longer
   * matches this version.
   */
  readonly expectedBaseVersion?: string;
};

export type AICapabilityRequirementSlice = {
  requirementSliceId: string;
  capability: string;
  profileSliceRef: string;
  readinessPolicy: AIConfigReadinessPolicy;
  editableFieldRefs?: string[];
  runtimeDescriptorRef?: string;
  runtimeDescriptor?: RuntimeProfileDescriptorSliceInput;
};

export type AICapabilityRequirementDeclaration = {
  requirementId: string;
  scopeRef: AIScopeRef;
  requiredSlices: AICapabilityRequirementSlice[];
  optionalSlices?: AICapabilityRequirementSlice[];
  setupProjectionPolicy: string;
  editableFields?: string[];
  runtimeActivationConsumers?: string[];
  kitSurfaceHints?: JsonObject;
  readinessProjectionRefs?: string[];
};

export type RuntimeProfileDescriptor = {
  schema_version: 1;
  descriptor_id: string;
  profile_ref: {
    profile_id: string;
    title: string;
  };
  source_profile_digest: string;
  projection_origin: {
    component: 'sdk.aiProfile.formRuntimeDescriptor';
    projected_at: string;
  };
  requirement_refs: string[];
  capability_slices: RuntimeProfileDescriptorCapabilitySlice[];
  asset_bindings?: RuntimeProfileDescriptorAssetBinding[];
};

export type RuntimeProfileDescriptorExecution = {
  backend: string;
  backend_class?: string;
  backend_family?: string;
};

export type RuntimeProfileDescriptorModel = {
  family: string;
};

export type RuntimeProfileDescriptorOrderedCompanionOccurrence = {
  occurrence_id: string;
  order: number;
  role: string;
  engineSlot: string;
  asset_binding_ref: string;
  required: boolean;
  weight?: string;
  options?: JsonObject;
  applies_to?: string[];
};

export type RuntimeProfileDescriptorSliceInput = {
  sliceId?: string;
  executionMode?: 'local' | 'cloud_connector';
  contractState?: AIConfigSliceContractState;
  paramsRef?: string;
  execution?: RuntimeProfileDescriptorExecution;
  model?: RuntimeProfileDescriptorModel;
  provider?: string;
  providerCapability?: string;
  modelId?: string;
  credentialPolicy?: string;
  connectorSelector?: string;
  assetRefs?: string[];
  orderedCompanionOccurrences?: RuntimeProfileDescriptorOrderedCompanionOccurrence[];
  paramsDigest?: string;
  environmentDigest?: string;
};

export type RuntimeProfileDescriptorHFSource = {
  repo_id: string;
  revision: string;
  entries: string[];
  access_policy: 'public' | 'requires_auth' | 'gated' | 'unknown';
  expected_integrity?: string;
};

export type RuntimeProfileDescriptorManualSource = {
  expected_name: string;
  association_instructions: string;
  allowed_file_patterns?: string[];
  expected_integrity?: string;
  risk_label?: string;
};

export type RuntimeProfileDescriptorAssetBinding = {
  binding_id: string;
  asset_role: string;
  component_kind: string;
  source: 'huggingface' | 'manual';
  expected_identity: string;
  readiness_policy: AIConfigReadinessPolicy;
  huggingface?: RuntimeProfileDescriptorHFSource;
  manual?: RuntimeProfileDescriptorManualSource;
  prepared_asset_id?: string;
};

export type RuntimeProfileDescriptorCapabilitySlice = {
  slice_id: string;
  capability: string;
  execution_mode: 'local' | 'cloud_connector';
  contract_state: AIConfigSliceContractState;
  readiness_policy: AIConfigReadinessPolicy;
  params_ref: string;
  execution?: RuntimeProfileDescriptorExecution;
  model?: RuntimeProfileDescriptorModel;
  provider?: string;
  provider_capability?: string;
  model_id?: string;
  credential_policy?: string;
  connector_selector?: string;
  asset_refs?: string[];
  ordered_companion_occurrences?: RuntimeProfileDescriptorOrderedCompanionOccurrence[];
  params_digest?: string;
  environment_digest?: string;
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
  apply(
    scopeRef: AIScopeRef,
    profileId: string,
    options?: AIProfileApplyOptions,
  ): Promise<AIProfileApplyResult>;
  resolveLocalDependencies(profileId: string): Promise<unknown[]>;
  formRuntimeDescriptor(
    profileId: string,
    scopeRef: AIScopeRef,
    requirementRef?: string,
  ): Promise<RuntimeProfileDescriptor>;
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
  record(snapshot: AISnapshot): void;
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
  const projection = projectAIProfileApply(profile);
  if (projection.outcome !== 'ready_to_apply') {
    throw createNimiError({
      message: `AIProfile cannot materialize live AIConfig: ${projection.setupProjection?.reasonCodes.join(', ') || projection.outcome}`,
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'prepare_required_profile_slices_before_apply',
      source: 'sdk',
    });
  }
  const targetRefs: AIConfigCapabilities['targetRefs'] = {};
  const selectedParams: AIConfigCapabilities['selectedParams'] = {};

  for (const [capability, intent] of Object.entries(profile.capabilities)) {
    if (!intent) continue;
    const targetRef = intent.targetRef ?? null;
    if (targetRef) {
      targetRefs[capability] = targetRef;
    }
    if (intent.params !== undefined && intent.params !== null) {
      selectedParams[capability] = intent.params;
    }
  }

  return {
    scopeRef: config.scopeRef,
    capabilities: { targetRefs, selectedParams },
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
  if (p.capabilities && typeof p.capabilities === 'object' && !Array.isArray(p.capabilities)) {
    errors.push(...validateAIProfileCompactRefs(p as unknown as AIProfile));
  }
  return { valid: errors.length === 0, errors };
}

const FORBIDDEN_AI_CONFIG_FIELD_NAMES = new Set([
  'RuntimeRouteBinding',
  'selectedBindings',
  'selected_source_records',
  'selectedSourceRecords',
  'selected_source_record',
  'selectedSourceRecord',
  'install_evidence',
  'installEvidence',
  'materialization_evidence',
  'materializationEvidence',
  'workflow_binding_id',
  'workflowBindingId',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function containsPathLikeValue(value: unknown): boolean {
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

function collectForbiddenPayloadErrors(value: unknown, path: string): string[] {
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

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateAIConfigTargetRef(value: unknown, path: string): string[] {
  const errors = collectForbiddenPayloadErrors(value, path);
  if (!isRecord(value)) {
    return [`${path} must be a compact AIConfig target ref`];
  }
  const kind = value.kind;
  if (kind === 'profile_slice_ref') {
    if (!nonEmptyString(value.sourceProfileId)) {
      errors.push(`${path}.sourceProfileId is required`);
    }
    if (!nonEmptyString(value.sliceId)) {
      errors.push(`${path}.sliceId is required`);
    }
  } else if (kind === 'local_runtime_target_ref') {
    const hasTarget = nonEmptyString(value.targetId);
    const hasProfile = nonEmptyString(value.profileId);
    const hasReadiness = nonEmptyString(value.readinessRef);
    if (!hasReadiness && !hasTarget && !hasProfile) {
      errors.push(`${path} requires readinessRef or targetId/profileId`);
    }
  } else if (kind === 'cloud_connector_target_ref') {
    if (!nonEmptyString(value.connectorId)) {
      errors.push(`${path}.connectorId is required`);
    }
    if (!nonEmptyString(value.providerModelId)) {
      errors.push(`${path}.providerModelId is required`);
    }
  } else {
    errors.push(`${path}.kind is not an admitted AIConfig compact ref family`);
  }
  return errors;
}

export function validateAIProfileCompactRefs(profile: AIProfile): string[] {
  const errors: string[] = collectForbiddenPayloadErrors(profile, 'profile');
  for (const [capability, intent] of Object.entries(profile.capabilities || {})) {
    if (!intent) {
      continue;
    }
    if (intent.targetRef !== undefined && intent.targetRef !== null) {
      errors.push(...validateAIConfigTargetRef(intent.targetRef, `capabilities.${capability}.targetRef`));
    }
    const policy = intent.readinessPolicy ?? 'required';
    if (policy !== 'required' && policy !== 'optional') {
      errors.push(`capabilities.${capability}.readinessPolicy is invalid`);
    }
    const state = intent.contractState ?? 'declared';
    if (state !== 'declared' && state !== 'proposed' && state !== 'unsupported') {
      errors.push(`capabilities.${capability}.contractState is invalid`);
    }
    errors.push(...validateRuntimeDescriptorSliceInput(
      intent.runtimeDescriptor,
      `capabilities.${capability}.runtimeDescriptor`,
    ));
  }
  return errors;
}

export function validateAIConfigCompactRefs(config: AIConfig): string[] {
  const errors = collectForbiddenPayloadErrors(config, 'config');
  for (const [capability, targetRef] of Object.entries(config.capabilities?.targetRefs || {})) {
    if (targetRef === undefined || targetRef === null) {
      errors.push(`capabilities.targetRefs.${capability} must be omitted rather than null`);
      continue;
    }
    errors.push(...validateAIConfigTargetRef(targetRef, `capabilities.targetRefs.${capability}`));
  }
  return errors;
}

function validateRuntimeDescriptorSliceInput(
  slice: RuntimeProfileDescriptorSliceInput | undefined,
  path: string,
): string[] {
  const errors = collectForbiddenPayloadErrors(slice, path);
  if (!slice) {
    return errors;
  }
  if (slice.executionMode !== undefined
    && slice.executionMode !== 'local'
    && slice.executionMode !== 'cloud_connector') {
    errors.push(`${path}.executionMode is invalid`);
  }
  if (slice.contractState !== undefined
    && slice.contractState !== 'declared'
    && slice.contractState !== 'proposed'
    && slice.contractState !== 'unsupported') {
    errors.push(`${path}.contractState is invalid`);
  }
  return errors;
}

export function projectAIProfileApply(profile: AIProfile): {
  outcome: AIConfigApplyOutcome;
  setupProjection: AIConfigSetupProjection | null;
} {
  const blockingCapabilities: string[] = [];
  const reasonCodes: string[] = [];
  for (const [capability, intent] of Object.entries(profile.capabilities || {})) {
    if (!intent) {
      continue;
    }
    const policy = intent.readinessPolicy ?? 'required';
    const state = intent.contractState ?? 'declared';
    const hasTargetRef = Boolean(intent.targetRef);
    if (state === 'unsupported') {
      if (policy === 'required') {
        blockingCapabilities.push(capability);
        reasonCodes.push('product_state_unsupported');
      }
      continue;
    }
    if (state === 'proposed') {
      if (policy === 'required') {
        blockingCapabilities.push(capability);
        reasonCodes.push('product_state_proposed');
      }
      continue;
    }
    if (!hasTargetRef && policy === 'required') {
      blockingCapabilities.push(capability);
      reasonCodes.push('required_slice_unresolved');
    }
  }
  if (blockingCapabilities.length === 0) {
    return { outcome: 'ready_to_apply', setupProjection: null };
  }
  const unsupported = reasonCodes.includes('product_state_unsupported');
  const outcome = unsupported ? 'unsupported_no_live_config' : 'setup_required_no_live_config';
  return {
    outcome,
    setupProjection: {
      outcome,
      blockingCapabilities,
      reasonCodes: [...new Set(reasonCodes)],
      actionRefs: blockingCapabilities.map((capability) => `setup:${capability}`),
    },
  };
}

export function validateAICapabilityRequirementDeclaration(
  declaration: unknown,
): AIProfileValidationResult {
  const errors: string[] = collectForbiddenPayloadErrors(declaration, 'requirement');
  if (!isRecord(declaration)) {
    return { valid: false, errors: ['requirement declaration must be a non-null object'] };
  }
  if (!nonEmptyString(declaration.requirementId)) {
    errors.push('requirementId is required');
  }
  try {
    assertExplicitAIScopeRef(declaration.scopeRef as AIScopeRef);
  } catch {
    errors.push('scopeRef must be an explicit AIScopeRef');
  }
  if (!Array.isArray(declaration.requiredSlices)) {
    errors.push('requiredSlices must be an array');
  }
  if (!nonEmptyString(declaration.setupProjectionPolicy)) {
    errors.push('setupProjectionPolicy is required');
  }
  const validateSlice = (slice: unknown, path: string, expectedPolicy: AIConfigReadinessPolicy) => {
    if (!isRecord(slice)) {
      errors.push(`${path} must be an object`);
      return;
    }
    for (const field of ['requirementSliceId', 'capability', 'profileSliceRef'] as const) {
      if (!nonEmptyString(slice[field])) {
        errors.push(`${path}.${field} is required`);
      }
    }
    if (slice.readinessPolicy !== expectedPolicy) {
      errors.push(`${path}.readinessPolicy must be ${expectedPolicy}`);
    }
    errors.push(...validateRuntimeDescriptorSliceInput(
      slice.runtimeDescriptor as RuntimeProfileDescriptorSliceInput | undefined,
      `${path}.runtimeDescriptor`,
    ));
  };
  (Array.isArray(declaration.requiredSlices) ? declaration.requiredSlices : [])
    .forEach((slice, index) => validateSlice(slice, `requiredSlices[${index}]`, 'required'));
  (Array.isArray(declaration.optionalSlices) ? declaration.optionalSlices : [])
    .forEach((slice, index) => validateSlice(slice, `optionalSlices[${index}]`, 'optional'));
  return { valid: errors.length === 0, errors };
}

export function formRuntimeProfileDescriptor(input: {
  profile: AIProfile;
  requirementDeclarations: readonly AICapabilityRequirementDeclaration[];
  descriptorId: string;
  sourceProfileDigest: string;
  assetBindings?: readonly RuntimeProfileDescriptorAssetBinding[];
  projectedAt?: string;
}): RuntimeProfileDescriptor {
  const profileValidation = validateAIProfile(input.profile);
  if (!profileValidation.valid) {
    throw new Error(`AIProfile cannot form runtime descriptor: ${profileValidation.errors.join('; ')}`);
  }
  const requirementRefs: string[] = [];
  for (const declaration of input.requirementDeclarations) {
    const validation = validateAICapabilityRequirementDeclaration(declaration);
    if (!validation.valid) {
      throw new Error(`AI requirement declaration is invalid: ${validation.errors.join('; ')}`);
    }
    requirementRefs.push(declaration.requirementId);
  }
  const descriptorId = String(input.descriptorId || '').trim();
  const sourceProfileDigest = String(input.sourceProfileDigest || '').trim();
  if (!descriptorId || !sourceProfileDigest) {
    throw new Error('runtime descriptor formation requires descriptorId and sourceProfileDigest');
  }
  if (requirementRefs.length === 0) {
    throw new Error('runtime descriptor formation requires at least one requirement declaration');
  }
  const capability_slices: RuntimeProfileDescriptorCapabilitySlice[] = [];
  for (const declaration of input.requirementDeclarations) {
    const declaredSlices: Array<{
      slice: AICapabilityRequirementSlice;
      optional: boolean;
    }> = [
      ...declaration.requiredSlices.map((slice) => ({ slice, optional: false })),
      ...(declaration.optionalSlices || []).map((slice) => ({ slice, optional: true })),
    ];
    for (const { slice, optional } of declaredSlices) {
      const intent = input.profile.capabilities?.[slice.capability] ?? null;
      const authored = intent?.runtimeDescriptor ?? slice.runtimeDescriptor;
      if (!authored && optional && !intent?.targetRef) {
        continue;
      }
      capability_slices.push(formRuntimeProfileDescriptorSlice({
        profile: input.profile,
        requirementSlice: slice,
        intent,
        authored,
      }));
    }
  }
  if (capability_slices.length === 0) {
    throw new Error('runtime descriptor formation produced no capability slices');
  }
  const descriptor: RuntimeProfileDescriptor = {
    schema_version: 1,
    descriptor_id: descriptorId,
    profile_ref: {
      profile_id: input.profile.profileId,
      title: input.profile.title,
    },
    source_profile_digest: sourceProfileDigest,
    projection_origin: {
      component: 'sdk.aiProfile.formRuntimeDescriptor',
      projected_at: input.projectedAt || new Date().toISOString(),
    },
    requirement_refs: requirementRefs,
    capability_slices,
  };
  if (input.assetBindings && input.assetBindings.length > 0) {
    descriptor.asset_bindings = input.assetBindings.map((binding) => ({ ...binding }));
  }
  return descriptor;
}

function formRuntimeProfileDescriptorSlice(input: {
  profile: AIProfile;
  requirementSlice: AICapabilityRequirementSlice;
  intent: AIProfileCapabilityIntent | null;
  authored: RuntimeProfileDescriptorSliceInput | undefined;
}): RuntimeProfileDescriptorCapabilitySlice {
  const { profile, requirementSlice, intent, authored } = input;
  const targetRef = intent?.targetRef ?? null;
  const executionMode = authored?.executionMode
    ?? (targetRef?.kind === 'cloud_connector_target_ref' ? 'cloud_connector' : 'local');
  const paramsRef = authored?.paramsRef
    ?? (intent?.params ? `params:${profile.profileId}:${requirementSlice.capability}` : 'params:none');
  const base: RuntimeProfileDescriptorCapabilitySlice = {
    slice_id: authored?.sliceId || requirementSlice.profileSliceRef || requirementSlice.requirementSliceId,
    capability: requirementSlice.capability,
    execution_mode: executionMode,
    contract_state: authored?.contractState ?? intent?.contractState ?? 'declared',
    readiness_policy: requirementSlice.readinessPolicy,
    params_ref: paramsRef,
  };

  if (executionMode === 'local') {
    if (!authored?.execution?.backend || !authored?.model?.family) {
      throw new Error(
        `runtime descriptor slice ${requirementSlice.requirementSliceId} requires execution.backend and model.family`,
      );
    }
    base.execution = { ...authored.execution };
    base.model = { ...authored.model };
  } else {
    const provider = authored?.provider
      ?? (targetRef?.kind === 'cloud_connector_target_ref' ? targetRef.provider : undefined);
    const modelId = authored?.modelId
      ?? (targetRef?.kind === 'cloud_connector_target_ref' ? targetRef.providerModelId : undefined);
    const connectorSelector = authored?.connectorSelector
      ?? (targetRef?.kind === 'cloud_connector_target_ref' ? targetRef.connectorId : undefined);
    if (!provider || !authored?.providerCapability || !modelId || !authored?.credentialPolicy) {
      throw new Error(
        `runtime descriptor slice ${requirementSlice.requirementSliceId} requires cloud provider/model/credential fields`,
      );
    }
    base.provider = provider;
    base.provider_capability = authored.providerCapability;
    base.model_id = modelId;
    base.credential_policy = authored.credentialPolicy;
    if (connectorSelector) {
      base.connector_selector = connectorSelector;
    }
  }

  if (authored?.assetRefs && authored.assetRefs.length > 0) {
    base.asset_refs = [...authored.assetRefs];
  }
  if (authored?.orderedCompanionOccurrences && authored.orderedCompanionOccurrences.length > 0) {
    base.ordered_companion_occurrences = authored.orderedCompanionOccurrences.map((occurrence) => ({
      ...occurrence,
      applies_to: occurrence.applies_to ? [...occurrence.applies_to] : occurrence.applies_to,
      options: occurrence.options ? { ...occurrence.options } : occurrence.options,
    }));
  }
  if (authored?.paramsDigest) {
    base.params_digest = authored.paramsDigest;
  }
  if (authored?.environmentDigest) {
    base.environment_digest = authored.environmentDigest;
  }
  return base;
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
  selectedTargetRef: AIConfigTargetRef | null;
  resolvedTarget?: unknown;
  health?: unknown;
  metadata?: unknown;
  agentResolution?: unknown;
  runtimeEvidence?: AIRuntimeEvidence | null;
  executionId?: string;
  createdAt?: string;
}): AISnapshot {
  const executionId = String(input.executionId || '').trim() || createAISnapshotExecutionId();
  const createdAt = String(input.createdAt || '').trim() || new Date().toISOString();
  const scopeRef = input.scopeRef || input.config.scopeRef;
  if (!areAIScopeRefsEqual(scopeRef, input.config.scopeRef)) {
    throw createNimiError({
      message: 'AISnapshot scopeRef must match the embedded AIConfig scopeRef',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'record_snapshot_with_matching_ai_config_scope',
      source: 'sdk',
    });
  }

  return {
    executionId,
    scopeRef,
    configEvidence: createAIConfigEvidence(input.config),
    conversationCapabilitySlice: {
      executionId,
      createdAt,
      capability: String(input.capability || '').trim(),
      selectedTargetRef: input.selectedTargetRef || null,
      resolvedTarget: input.resolvedTarget ?? null,
      health: input.health ?? null,
      metadata: input.metadata ?? null,
      agentResolution: input.agentResolution ?? null,
    },
    runtimeEvidence: input.runtimeEvidence ?? null,
    createdAt,
  };
}
