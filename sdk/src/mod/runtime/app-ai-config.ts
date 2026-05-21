/**
 * Per-app first-launch AIConfig initialization (S-AICONF-009).
 *
 * Spec authority:
 *   P-AISC-007    App-launch AIConfig scope identity
 *   S-AICONF-009  Per-app first-launch AIConfig initialization
 *   P-AIPS-009    First-party app AIProfile hint
 *   P-AIPS-013    Account Default Profile local library evidence
 *   D-AIPC-005    AIProfile atomic overwrite apply
 *
 * Responsibility split: `ai-config.ts` owns the canonical `AIScopeRef` /
 * `AIProfile` / `AIConfig` types and the generic profile-apply machinery.
 * This file owns ONLY the app-launch scope factory and the first-launch
 * initialization decision logic. It is host-agnostic: every external
 * dependency (existing-config lookup, recommended/default profile resolution,
 * host apply authority, manifest validation) is injected by the caller so the
 * SDK never reaches a renderer cache, file path, or string-keyed scope.
 *
 * Fail-closed posture:
 *   - The init scope must be the canonical P-AISC-007 `app` shape; an inferred
 *     or generic-default scope is rejected.
 *   - When neither a satisfied recommended profile nor a resolvable Account
 *     Default Profile is available, initialization fails closed with a typed
 *     error — never a synthesized/empty/placeholder AIConfig.
 *   - An app scope that already has an AIConfig is NEVER re-initialized; a
 *     changed Default Profile or recommended-profile ref cannot overwrite it.
 *   - Unmet manifest requirements produce a typed setup/repair plan, never a
 *     silent partial config or a mutated profile/template.
 */

import { createNimiError } from '../../runtime/errors.js';
import { ReasonCode } from '../../types/index.js';
import {
  applyAIProfileToConfig,
  createEmptyAIConfig,
  validateAIProfile,
  type AIConfig,
  type AIProfile,
  type AIScopeRef,
} from './ai-config.js';

// ---------------------------------------------------------------------------
// App-launch AIConfig scope  (P-AISC-007)
// ---------------------------------------------------------------------------

/**
 * Create the canonical app-launch `AIScopeRef` (P-AISC-007).
 *
 * `ownerId` must be the admitted Nimi App `app_id` (dot-separated namespace
 * app identity, e.g. `nimi.avatar`). `surfaceId` is optional and may only be
 * an app-manifest-declared stable AI feature surface id; omitting it denotes
 * the app's single canonical app-level AI scope.
 *
 * The caller must pass an explicit `app_id`. There is no omitted-scope
 * inference and the result is never the generic chat default scope.
 */
export function createAppAIScopeRef(appId: string, surfaceId?: string): AIScopeRef {
  const normalizedAppId = String(appId || '').trim();
  if (!normalizedAppId) {
    throw createNimiError({
      message: 'app-launch AIScopeRef requires an admitted Nimi App app_id',
      reasonCode: ReasonCode.SDK_APP_AI_CONFIG_SCOPE_INVALID,
      actionHint: 'provide_admitted_nimi_app_id',
      source: 'sdk',
    });
  }
  const normalizedSurfaceId = surfaceId === undefined ? undefined : String(surfaceId).trim();
  if (normalizedSurfaceId !== undefined && !normalizedSurfaceId) {
    // A surfaceId argument that resolves to empty is a caller mistake — it
    // must be omitted entirely, never carried as a blank value.
    throw createNimiError({
      message: 'app-launch AIScopeRef surfaceId must be a non-empty manifest-declared surface id',
      reasonCode: ReasonCode.SDK_APP_AI_CONFIG_SCOPE_INVALID,
      actionHint: 'omit_surface_id_or_pass_manifest_declared_surface_id',
      source: 'sdk',
    });
  }
  return normalizedSurfaceId
    ? { kind: 'app', ownerId: normalizedAppId, surfaceId: normalizedSurfaceId }
    : { kind: 'app', ownerId: normalizedAppId };
}

/**
 * True when the scope is a well-formed P-AISC-007 app-launch scope: `app`
 * kind, a non-empty `ownerId`, and either no `surfaceId` or a non-empty one.
 */
export function isAppAIScopeRef(scopeRef: AIScopeRef | null | undefined): boolean {
  if (!scopeRef || scopeRef.kind !== 'app') {
    return false;
  }
  if (!String(scopeRef.ownerId || '').trim()) {
    return false;
  }
  return scopeRef.surfaceId === undefined || String(scopeRef.surfaceId).trim().length > 0;
}

/**
 * Assert that the caller provided a canonical P-AISC-007 app-launch scope and
 * return its normalized form. Rejects an omitted/null scope, a non-`app`
 * kind, an empty `ownerId`, and a blank `surfaceId`. The SDK never infers the
 * scope from active selection or a consumer-default app scope.
 */
export function assertAppAIScopeRef(scopeRef: AIScopeRef | null | undefined): AIScopeRef {
  if (!scopeRef) {
    throw createNimiError({
      message: 'app-launch AIScopeRef is required and must be provided explicitly',
      reasonCode: ReasonCode.SDK_APP_AI_CONFIG_SCOPE_INVALID,
      actionHint: 'provide_explicit_app_launch_scope_ref',
      source: 'sdk',
    });
  }
  if (!isAppAIScopeRef(scopeRef)) {
    throw createNimiError({
      message:
        "app-launch AIScopeRef must be { kind: 'app', ownerId: <admitted app_id>, surfaceId? }",
      reasonCode: ReasonCode.SDK_APP_AI_CONFIG_SCOPE_INVALID,
      actionHint: 'use_canonical_app_launch_scope_ref',
      source: 'sdk',
    });
  }
  return createAppAIScopeRef(scopeRef.ownerId, scopeRef.surfaceId);
}

// ---------------------------------------------------------------------------
// First-launch initialization types  (S-AICONF-009)
// ---------------------------------------------------------------------------

/** Which profile source materialized the app's first-launch AIConfig. */
export type AppFirstLaunchProfileSource = 'recommended-profile' | 'account-default-profile';

/**
 * One unmet manifest requirement detected after the materialized AIConfig was
 * validated against the app's manifest (S-AICONF-009). The plan never mutates
 * the profile, scope config, or factory template to force a pass.
 */
export type AppManifestRequirementGap = {
  /** Stable typed requirement identifier from the app manifest. */
  requirementId: string;
  /** Human-readable detail of what is missing / unsatisfied. */
  detail: string;
};

/**
 * Typed setup/repair plan returned when the app validates the materialized
 * AIConfig against its manifest and finds requirements unmet. The app scope
 * AIConfig has still been atomically written (initialization is complete);
 * the plan describes follow-up setup the user must perform.
 */
export type AppAIConfigSetupRepairPlan = {
  /** Unmet manifest requirements, in stable order. */
  unmetRequirements: AppManifestRequirementGap[];
};

/**
 * Result of `ensureAppFirstLaunchAIConfig`.
 *
 * - `initialized` — first launch; the scope's AIConfig was materialized from
 *   `profileSource` via the typed apply path. `setupRepairPlan` is non-null
 *   when the materialized config does not yet meet the app's manifest reqs.
 * - `already-initialized` — the scope already had an AIConfig; nothing was
 *   written and the existing config is returned unchanged.
 */
export type AppFirstLaunchAIConfigResult =
  | {
      outcome: 'initialized';
      scopeRef: AIScopeRef;
      config: AIConfig;
      profileSource: AppFirstLaunchProfileSource;
      profileId: string;
      setupRepairPlan: AppAIConfigSetupRepairPlan | null;
    }
  | {
      outcome: 'already-initialized';
      scopeRef: AIScopeRef;
      config: AIConfig;
    };

/**
 * A resolved recommended factory `AIProfile` for an app, plus whether the app
 * validates its manifest requirements as satisfied by that profile.
 *
 * The caller resolves the app's registry-row `ai_profile_selection_ref`
 * (`P-NAPP-002` / `P-NAPP-003`) to a factory `AIProfile`; `manifestSatisfied`
 * reflects the app's own validation of that profile against its manifest. A
 * `null` resolution means the recommended profile is undeclared or does not
 * resolve to an admitted factory profile.
 */
export type ResolvedRecommendedProfile = {
  profile: AIProfile;
  manifestSatisfied: boolean;
};

/**
 * Dependencies for `ensureAppFirstLaunchAIConfig`. Every external authority is
 * injected so the SDK helper stays host-agnostic and testable.
 */
export type EnsureAppFirstLaunchAIConfigDeps = {
  /**
   * The canonical P-AISC-007 app-launch scope to initialize. Required and
   * explicit — the helper never infers it.
   */
  scopeRef: AIScopeRef;
  /**
   * Read the scope's existing persisted AIConfig, or `null` when the scope
   * has never been initialized. Resolving to a config short-circuits the
   * helper to `already-initialized` with no write.
   */
  getExistingAppAIConfig: (scopeRef: AIScopeRef) => Promise<AIConfig | null> | AIConfig | null;
  /**
   * Resolve the app's recommended factory `AIProfile` from its registry-row
   * `ai_profile_selection_ref` (`P-NAPP-002` / `P-NAPP-003`, `P-AIPS-009`).
   * Returns `null` when the ref is undeclared or unresolvable. The returned
   * `manifestSatisfied` flag is the app's own validation of the profile
   * against its manifest.
   */
  resolveRecommendedProfile: (
    scopeRef: AIScopeRef,
  ) => Promise<ResolvedRecommendedProfile | null> | ResolvedRecommendedProfile | null;
  /**
   * Resolve the Account Default Profile (`accountDefaultProfileRef`,
   * `P-AIPS-013`) as a portable `AIProfile`. Returns `null` when the durable
   * record is missing/stale/unresolvable.
   */
  resolveAccountDefaultProfile: () => Promise<AIProfile | null> | AIProfile | null;
  /**
   * Host AIConfig apply authority: atomically overwrite the scope's AIConfig
   * from the materialized config (D-AIPC-005, `aiProfile.apply` path) and
   * return the committed config. The host owns durable persistence.
   */
  applyHostAiConfig: (scopeRef: AIScopeRef, config: AIConfig) => Promise<AIConfig> | AIConfig;
  /**
   * Optionally validate the materialized AIConfig against the app's manifest
   * requirements. Returns the unmet requirement gaps (empty when satisfied).
   * When omitted, no manifest validation is performed.
   */
  validateManifestRequirements?: (
    scopeRef: AIScopeRef,
    config: AIConfig,
  ) => Promise<AppManifestRequirementGap[]> | AppManifestRequirementGap[];
};

// ---------------------------------------------------------------------------
// First-launch initialization  (S-AICONF-009)
// ---------------------------------------------------------------------------

function assertValidProfile(profile: AIProfile, label: string): void {
  const validation = validateAIProfile(profile);
  if (!validation.valid) {
    throw createNimiError({
      message: `${label} is schema-invalid: ${validation.errors.join('; ')}`,
      reasonCode: ReasonCode.SDK_APP_AI_CONFIG_INIT_PROFILE_UNRESOLVED,
      actionHint: 'resolve_a_schema_valid_factory_ai_profile',
      source: 'sdk',
    });
  }
}

/**
 * Initialize a Nimi App's per-app AIConfig on first launch (S-AICONF-009).
 *
 * Decision order:
 *  1. If the app scope already has an AIConfig → `already-initialized`, no
 *     write. A changed Default Profile or `ai_profile_selection_ref` can
 *     never re-initialize an existing scope.
 *  2. Else resolve the app's recommended profile. Use it ONLY when it is
 *     declared, resolves to an admitted factory `AIProfile`, AND the app
 *     validates its manifest requirements as satisfied.
 *  3. Else initialize from the Account Default Profile (`P-AIPS-013`).
 *  4. If neither resolves → fail closed with a typed error. No synthesized,
 *     empty, or placeholder AIConfig; the app does not launch.
 *
 * The chosen profile is materialized via the D-AIPC-005 atomic-overwrite path
 * (`applyAIProfileToConfig`) into a full AIConfig and committed through the
 * host apply authority. When manifest validation finds remaining unmet
 * requirements, the result carries a typed setup/repair plan — the helper
 * never mutates the profile, scope config, or template to force a pass.
 */
export async function ensureAppFirstLaunchAIConfig(
  deps: EnsureAppFirstLaunchAIConfigDeps,
): Promise<AppFirstLaunchAIConfigResult> {
  const scopeRef = assertAppAIScopeRef(deps.scopeRef);

  if (typeof deps.getExistingAppAIConfig !== 'function'
    || typeof deps.resolveRecommendedProfile !== 'function'
    || typeof deps.resolveAccountDefaultProfile !== 'function'
    || typeof deps.applyHostAiConfig !== 'function') {
    throw createNimiError({
      message: 'ensureAppFirstLaunchAIConfig requires explicit host resolution authorities',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_existing_config_recommended_default_and_apply_authorities',
      source: 'sdk',
    });
  }

  // (1) An existing per-app AIConfig is never re-initialized or overwritten.
  const existing = await deps.getExistingAppAIConfig(scopeRef);
  if (existing) {
    return { outcome: 'already-initialized', scopeRef, config: existing };
  }

  // (2) Recommended profile — used only when declared + resolved + the app
  //     validates its manifest requirements as satisfied.
  const recommended = await deps.resolveRecommendedProfile(scopeRef);
  let chosenProfile: AIProfile | null = null;
  let profileSource: AppFirstLaunchProfileSource | null = null;
  if (recommended && recommended.manifestSatisfied) {
    assertValidProfile(recommended.profile, 'app recommended AIProfile');
    chosenProfile = recommended.profile;
    profileSource = 'recommended-profile';
  }

  // (3) Account Default Profile fallback when the recommended profile is
  //     undeclared, unresolvable, or its manifest reqs are not satisfied.
  if (!chosenProfile) {
    const accountDefault = await deps.resolveAccountDefaultProfile();
    if (accountDefault) {
      assertValidProfile(accountDefault, 'Account Default Profile');
      chosenProfile = accountDefault;
      profileSource = 'account-default-profile';
    }
  }

  // (4) Neither resolved → fail closed. No synthesized / placeholder config.
  if (!chosenProfile || !profileSource) {
    throw createNimiError({
      message:
        'app first-launch AIConfig cannot initialize: neither a satisfied recommended '
        + 'profile nor a resolvable Account Default Profile is available',
      reasonCode: ReasonCode.SDK_APP_AI_CONFIG_INIT_PROFILE_UNRESOLVED,
      actionHint: 'resolve_recommended_profile_or_account_default_profile',
      source: 'sdk',
    });
  }

  // Re-check after the awaits: a concurrent launch may have just initialized
  // the scope. The never-overwrite rule must hold even under a race.
  const concurrent = await deps.getExistingAppAIConfig(scopeRef);
  if (concurrent) {
    return { outcome: 'already-initialized', scopeRef, config: concurrent };
  }

  // Materialize via the D-AIPC-005 atomic-overwrite path: a full AIConfig,
  // not a partial overlay. Commit through the host apply authority.
  const materialized = applyAIProfileToConfig(createEmptyAIConfig(scopeRef), chosenProfile);
  let committed: AIConfig;
  try {
    committed = await deps.applyHostAiConfig(scopeRef, materialized);
  } catch (error) {
    throw createNimiError({
      message: `app first-launch AIConfig apply failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      reasonCode: ReasonCode.SDK_APP_AI_CONFIG_INIT_APPLY_FAILED,
      actionHint: 'check_host_ai_config_apply_authority',
      source: 'sdk',
    });
  }
  if (!committed || committed.scopeRef?.kind !== 'app') {
    throw createNimiError({
      message: 'host AIConfig apply authority did not return a committed app-scope AIConfig',
      reasonCode: ReasonCode.SDK_APP_AI_CONFIG_INIT_APPLY_FAILED,
      actionHint: 'host_ai_config_apply_authority_must_return_committed_config',
      source: 'sdk',
    });
  }

  // Manifest validation against the materialized config. Unmet requirements
  // surface as a typed setup/repair plan; the config is NOT mutated to pass.
  let setupRepairPlan: AppAIConfigSetupRepairPlan | null = null;
  if (typeof deps.validateManifestRequirements === 'function') {
    const gaps = await deps.validateManifestRequirements(scopeRef, committed);
    if (gaps && gaps.length > 0) {
      setupRepairPlan = { unmetRequirements: [...gaps] };
    }
  }

  return {
    outcome: 'initialized',
    scopeRef,
    config: committed,
    profileSource,
    profileId: chosenProfile.profileId,
    setupRepairPlan,
  };
}
