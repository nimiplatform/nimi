/**
 * Shared Desktop host AIConfig service (S-AICONF-001~006).
 *
 * Desktop host owns app/mod scope AIConfig and AISnapshot persistence here.
 * Chat, runtime-config, and future mod bridge callers consume this service;
 * none of them own the underlying persistence authority.
 */

import { createModRuntimeClient } from '@nimiplatform/sdk/mod';
import {
  applyAIProfileToConfig,
  assertAppAIScopeRef,
  computeAIConfigDiff,
  computeAIConfigVersion,
  createEmptyAIConfig,
  ensureAppFirstLaunchAIConfig as ensureAppFirstLaunchAIConfig_sdk,
  validateAIProfile,
  type AIConfig,
  type AIConfigProbeResult,
  type AIConfigSDKSurface,
  type AIConfigSurface,
  type AIProfile,
  type AIProfileApplyResult,
  type AIProfilePreviewResult,
  type AIProfileSurface,
  type AIProfileValidationResult,
  type AIProbeStatus,
  type AIRuntimeEvidence,
  type AISchedulingEvaluationTarget,
  type AISchedulingJudgement,
  type AISchedulingState,
  type AIScopeRef,
  type AISnapshot,
  type AISnapshotSurface,
  type AppFirstLaunchAIConfigResult,
  type AppManifestRequirementGap,
} from '@nimiplatform/sdk/mod';
import { loadPlatformAIProfileFactoryCatalog } from '@runtime/platform-catalog';
import {
  listPersistedScopeKeys,
  loadAIConfigForScope,
  parseScopeKey,
  persistAIConfigForScope,
  scopeKeyFromRef,
} from './desktop-ai-config-storage.js';
import {
  getConversationCapabilityRouteRuntime,
  type ConversationCapabilityRouteRuntime,
} from '@renderer/features/chat/conversation-capability.js';
import { getAccountDefaultProfileForScopeInit } from '@renderer/bridge/runtime-bridge/product-control.js';

// ---------------------------------------------------------------------------
// Snapshot store — in-memory ring buffer (S-AICONF-005: host-local persistence)
// ---------------------------------------------------------------------------

const SNAPSHOT_RING_SIZE = 64;

type SnapshotStore = {
  byExecutionId: Map<string, AISnapshot>;
  byScopeKey: Map<string, AISnapshot>; // latest per scope
  insertionOrder: string[]; // executionId ring for eviction
};

function createSnapshotStore(): SnapshotStore {
  return {
    byExecutionId: new Map(),
    byScopeKey: new Map(),
    insertionOrder: [],
  };
}

function scopeKey(ref: AIScopeRef): string {
  return scopeKeyFromRef(ref);
}

function storeSnapshot(store: SnapshotStore, snapshot: AISnapshot): void {
  if (store.insertionOrder.length >= SNAPSHOT_RING_SIZE) {
    const evictId = store.insertionOrder.shift()!;
    store.byExecutionId.delete(evictId);
  }
  store.byExecutionId.set(snapshot.executionId, snapshot);
  store.byScopeKey.set(scopeKey(snapshot.scopeRef), snapshot);
  store.insertionOrder.push(snapshot.executionId);
}

// ---------------------------------------------------------------------------
// Config subscription registry (S-AICONF-006)
// ---------------------------------------------------------------------------

type ConfigSubscription = {
  scopeKey: string;
  callback: (config: AIConfig) => void;
};

let subscriptionIdCounter = 0;
const subscriptions = new Map<number, ConfigSubscription>();

function notifyConfigSubscribers(config: AIConfig): void {
  const key = scopeKey(config.scopeRef);
  for (const sub of subscriptions.values()) {
    if (sub.scopeKey === key) {
      try {
        sub.callback(config);
      } catch {
        // Subscriber errors must not break the surface
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Multi-scope config state
// ---------------------------------------------------------------------------

const snapshotStore = createSnapshotStore();

/** In-memory config map keyed by scope key string. */
const configByScope = new Map<string, AIConfig>();

const CORE_RUNTIME_MOD_ID = 'core:runtime';
const DESKTOP_RUNTIME_APP_ID = 'nimi.desktop';

/**
 * App store sync callback. Set by `bindDesktopAIConfigAppStore()` at bootstrap time.
 * Receives the scope key and new config so the store can decide whether
 * to update (e.g. the Zustand store only tracks the "active" scope).
 */
let appStoreSetter: ((scopeKey: string, config: AIConfig) => void) | null = null;

/** Bootstrap: load all persisted scopes into memory. */
function ensureHydrated(): void {
  if (configByScope.size > 0) return;
  const keys = listPersistedScopeKeys();
  for (const key of keys) {
    const ref = parseScopeKey(key);
    if (!ref) continue;
    const config = loadAIConfigForScope(ref);
    configByScope.set(key, config);
  }
}

/**
 * True when the scope already has a persisted (or in-memory) AIConfig.
 * Used by `previewApply` to decide whether `before` is a real config or an
 * explicit `null` first-apply (D-AIPC-014).
 */
function scopeHasPersistedConfig(scopeRef: AIScopeRef): boolean {
  ensureHydrated();
  const key = scopeKey(scopeRef);
  if (configByScope.has(key)) {
    return true;
  }
  return listPersistedScopeKeys().includes(key);
}

/**
 * Get the in-memory config for a scope, loading from persistence if needed.
 */
function getConfigForScope(scopeRef: AIScopeRef): AIConfig {
  ensureHydrated();
  const key = scopeKey(scopeRef);
  const existing = configByScope.get(key);
  if (existing) return existing;
  // Scope not in memory — try loading from persistence
  const loaded = loadAIConfigForScope(scopeRef);
  configByScope.set(key, loaded);
  return loaded;
}

/**
 * Unified config commit: persistence + in-memory + app store + subscribers.
 * This is the single write path for AIConfig. No caller outside this module
 * should write to persistence or app store directly for config mutations.
 */
function commitConfig(config: AIConfig): void {
  const key = scopeKey(config.scopeRef);
  persistAIConfigForScope(config);
  configByScope.set(key, config);
  if (appStoreSetter) {
    appStoreSetter(key, config);
  }
  notifyConfigSubscribers(config);
}

export function pushDesktopAIConfigToBoundStore(scopeRef: AIScopeRef): void {
  if (!appStoreSetter) {
    return;
  }
  appStoreSetter(scopeKey(scopeRef), getConfigForScope(scopeRef));
}

/**
 * AIConfig scope-init rule (product manual "Profile And AIConfig Model").
 *
 * A new AIConfig scope initializes its config from the Account Default Profile
 * ONLY when no prior `AIConfig` exists for that scope. When the scope already
 * has a persisted (or in-memory) `AIConfig`, this is a no-op — the scope's
 * config is never re-initialized and never silently overwritten by a Default
 * Profile change. Editing/replacing the Account Default Profile therefore never
 * mutates an existing scope's `AIConfig`.
 *
 * The Account Default Profile content is the verified durable `default.json`
 * record resolved through the Rust host; the renderer never reconstructs it
 * from realm session or app-local state (P-AIPS-013).
 *
 * Returns `true` when this call materialized the scope's first config from the
 * Account Default Profile, `false` when the scope already had a config.
 */
export async function initializeScopeFromAccountDefaultProfile(
  scopeRef: AIScopeRef,
): Promise<boolean> {
  // Never re-initialize / overwrite a scope that already has an AIConfig.
  if (scopeHasPersistedConfig(scopeRef)) {
    return false;
  }
  const accountDefaultProfile = await getAccountDefaultProfileForScopeInit();
  const profile: AIProfile = {
    profileId: accountDefaultProfile.profileId,
    title: accountDefaultProfile.title,
    description: accountDefaultProfile.description,
    tags: [...accountDefaultProfile.tags],
    capabilities: accountDefaultProfile.capabilities as AIProfile['capabilities'],
  };
  const validation = validateAIProfile(profile);
  if (!validation.valid) {
    throw new Error(
      `Account Default Profile is schema-invalid: ${validation.errors.join(', ')}`,
    );
  }
  // Re-check after the await: a concurrent path may have created the config.
  // The scope-init rule must never overwrite an already-initialized scope.
  if (scopeHasPersistedConfig(scopeRef)) {
    return false;
  }
  const initialConfig = applyAIProfileToConfig(createEmptyAIConfig(scopeRef), profile);
  commitConfig(initialConfig);
  return true;
}

// ---------------------------------------------------------------------------
// Per-app first-launch AIConfig initialization (S-AICONF-009)
// ---------------------------------------------------------------------------

/**
 * Resolve an app's recommended factory `AIProfile` from its registry-row
 * `ai_profile_selection_ref` (`P-NAPP-002` / `P-NAPP-003`, `P-AIPS-009`).
 *
 * The ref is a factory `AIProfile` alias / profileId admitted in
 * `tables/ai-profile-factory-catalog.yaml`; it is matched against the packaged
 * factory catalog projection. An undeclared (`null`/blank) or unresolvable ref
 * yields `null` so first-launch init falls back to the Account Default Profile.
 */
function resolveRecommendedFactoryProfile(
  recommendedProfileRef: string | null | undefined,
): AIProfile | null {
  const ref = String(recommendedProfileRef || '').trim();
  if (!ref) {
    return null;
  }
  return loadPlatformAIProfileFactoryCatalog().find((profile) => profile.profileId === ref) ?? null;
}

/**
 * Input for `ensureAppFirstLaunchAIConfig`.
 *
 * The caller (the app Open / launch path) owns scope construction and the
 * registry-row recommended-profile ref. `surfaceId` is an optional
 * app-manifest-declared AI feature surface id (`P-AISC-007`).
 */
export interface EnsureAppFirstLaunchAIConfigInput {
  /** Admitted Nimi App `app_id` (dot-separated namespace identity). */
  readonly appId: string;
  /** Optional app-manifest-declared stable AI feature surface id. */
  readonly surfaceId?: string;
  /**
   * The app registry row `ai_profile_selection_ref`. Pass the value from the
   * Nimi App registry projection; `null`/omitted when the app declares no
   * recommended profile, which routes init to the Account Default Profile.
   */
  readonly recommendedProfileRef?: string | null;
  /**
   * Whether the app validates its manifest requirements as satisfied by the
   * recommended profile. Defaults to `true` when a recommended profile is
   * resolvable; pass `false` to force the Account Default Profile fallback
   * when the app's manifest requirements are not met by the recommended one.
   */
  readonly recommendedProfileManifestSatisfied?: boolean;
  /**
   * Optional manifest validation of the materialized AIConfig. Returns the
   * unmet requirement gaps (empty when satisfied). Unmet gaps surface as a
   * typed setup/repair plan; the config is never mutated to force a pass.
   */
  readonly validateManifestRequirements?: (
    scopeRef: AIScopeRef,
    config: AIConfig,
  ) => Promise<AppManifestRequirementGap[]> | AppManifestRequirementGap[];
}

/**
 * Test seam for `ensureAppFirstLaunchAIConfig`. Production callers omit this;
 * the defaults wire the real factory catalog and the Tauri-backed Account
 * Default Profile resolver. Tests inject stubs to exercise the init branches
 * without the Tauri layer.
 */
export interface EnsureAppFirstLaunchAIConfigDepsOverride {
  /** Resolve a recommended factory `AIProfile` from a registry-row ref. */
  readonly resolveRecommendedFactoryProfile?: (
    recommendedProfileRef: string | null | undefined,
  ) => AIProfile | null;
  /** Resolve the Account Default Profile as a portable `AIProfile`. */
  readonly resolveAccountDefaultProfile?: () => Promise<AIProfile | null> | AIProfile | null;
}

/**
 * Initialize a Nimi App's per-app AIConfig on first launch (S-AICONF-009).
 *
 * Wires the host-agnostic SDK helper `ensureAppFirstLaunchAIConfig` to the
 * Desktop host AIConfig persistence:
 *  - the init scope is the canonical `P-AISC-007` app shape;
 *  - an existing per-app AIConfig is returned unchanged and NEVER overwritten
 *    on any later launch — a changed Default Profile or registry
 *    `ai_profile_selection_ref` cannot re-initialize it;
 *  - first launch materializes the scope's AIConfig from the recommended
 *    factory profile when declared + resolvable + manifest-satisfied, else
 *    from the Account Default Profile (`P-AIPS-013`), via the typed
 *    atomic-overwrite apply path (`commitConfig`);
 *  - when neither resolves, it fails closed with a typed error — no
 *    synthesized, empty, or placeholder AIConfig and no launch;
 *  - unmet manifest requirements surface as a typed setup/repair plan.
 *
 * The runtime install path does not call this — install handles package
 * readiness only and must not mutate AIConfig (S-AICONF-009 `MUST NOT`,
 * `K-APP-011`). The app Open / launch path is the caller.
 */
export async function ensureAppFirstLaunchAIConfig(
  input: EnsureAppFirstLaunchAIConfigInput,
  deps?: EnsureAppFirstLaunchAIConfigDepsOverride,
): Promise<AppFirstLaunchAIConfigResult> {
  // Canonical P-AISC-007 app-launch scope — explicit, never inferred.
  const scopeRef = assertAppAIScopeRef(
    input.surfaceId
      ? { kind: 'app', ownerId: input.appId, surfaceId: input.surfaceId }
      : { kind: 'app', ownerId: input.appId },
  );

  const resolveRecommended =
    deps?.resolveRecommendedFactoryProfile ?? resolveRecommendedFactoryProfile;
  const resolveAccountDefault =
    deps?.resolveAccountDefaultProfile
    ?? (async (): Promise<AIProfile> => {
      const accountDefaultProfile = await getAccountDefaultProfileForScopeInit();
      return {
        profileId: accountDefaultProfile.profileId,
        title: accountDefaultProfile.title,
        description: accountDefaultProfile.description,
        tags: [...accountDefaultProfile.tags],
        capabilities: accountDefaultProfile.capabilities as AIProfile['capabilities'],
      };
    });

  return ensureAppFirstLaunchAIConfig_sdk({
    scopeRef,
    // Existing per-app AIConfig lookup: a persisted config short-circuits to
    // `already-initialized` with no write.
    getExistingAppAIConfig: (ref) =>
      scopeHasPersistedConfig(ref) ? getConfigForScope(ref) : null,
    // Recommended profile from the app registry row ai_profile_selection_ref.
    resolveRecommendedProfile: (_ref) => {
      const profile = resolveRecommended(input.recommendedProfileRef);
      if (!profile) {
        return null;
      }
      return {
        profile,
        manifestSatisfied: input.recommendedProfileManifestSatisfied !== false,
      };
    },
    // Account Default Profile (P-AIPS-013) — verified durable default.json.
    resolveAccountDefaultProfile: resolveAccountDefault,
    // Host apply authority: the single AIConfig write path (commitConfig).
    applyHostAiConfig: (ref, config) => {
      const committed: AIConfig = { ...config, scopeRef: ref };
      commitConfig(committed);
      return committed;
    },
    ...(input.validateManifestRequirements
      ? { validateManifestRequirements: input.validateManifestRequirements }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// AIProfile surface implementation (S-AICONF-001 catalog + apply)
// ---------------------------------------------------------------------------

function createAIProfileSurface(): AIProfileSurface {
  return {
    async list(): Promise<AIProfile[]> {
      const client = createModRuntimeClient(CORE_RUNTIME_MOD_ID);
      const rawProfiles = await client.local.listProfiles();
      return rawProfiles.map((p) => toAIProfile(p));
    },

    async get(profileId: string): Promise<AIProfile | null> {
      const client = createModRuntimeClient(CORE_RUNTIME_MOD_ID);
      const rawProfiles = await client.local.listProfiles();
      const matched = rawProfiles.find((p) => p.id === profileId);
      return matched ? toAIProfile(matched) : null;
    },

    validate(profile: AIProfile): AIProfileValidationResult {
      return validateAIProfile(profile);
    },

    async previewApply(
      scopeRef: AIScopeRef,
      profileId: string,
    ): Promise<AIProfilePreviewResult> {
      // D-AIPC-014 / S-AICONF-008: non-committing apply preview.
      // Computes the before→after AIConfig diff a D-AIPC-005 apply would
      // produce, with the SAME full-materialization overwrite semantics.
      // It MUST NOT commitConfig / persist / notify subscribers / record a
      // snapshot. Fails closed on schema-invalid input.
      const profile = await this.get(profileId);
      if (!profile) {
        throw new Error(`Profile not found: ${profileId}`);
      }

      const validation = this.validate(profile);
      if (!validation.valid) {
        throw new Error(`Profile schema invalid: ${validation.errors.join(', ')}`);
      }

      // `before` is the scope's current AIConfig, or explicit null on first
      // apply (D-AIPC-014: diff represents full creation).
      const before = scopeHasPersistedConfig(scopeRef)
        ? getConfigForScope(scopeRef)
        : null;

      // `after` uses the exact D-AIPC-005 materialization. The base config a
      // commit would overwrite is the current config (or an empty one for
      // first apply); apply is a full overwrite, not a merge.
      const baseConfig = before ?? getConfigForScope(scopeRef);
      const after = applyAIProfileToConfig(baseConfig, profile);

      // baseVersion is the CAS freshness token for `before` (or for an empty
      // config when there is no current config).
      const baseVersion = computeAIConfigVersion(baseConfig);

      const probeWarnings = collectProfileSchemaProbeWarnings(profile);

      return {
        before,
        after,
        diff: computeAIConfigDiff(before, after),
        baseVersion,
        probeWarnings,
      };
    },

    async apply(scopeRef: AIScopeRef, profileId: string): Promise<AIProfileApplyResult> {
      const profile = await this.get(profileId);
      if (!profile) {
        return {
          success: false,
          config: null,
          failureReason: `Profile not found: ${profileId}`,
          probeWarnings: [],
        };
      }

      const validation = this.validate(profile);
      if (!validation.valid) {
        return {
          success: false,
          config: null,
          failureReason: `Profile schema invalid: ${validation.errors.join(', ')}`,
          probeWarnings: [],
        };
      }

      // Atomic overwrite (D-AIPC-005)
      const baseConfig = getConfigForScope(scopeRef);
      const nextConfig = applyAIProfileToConfig(baseConfig, profile);

      commitConfig(nextConfig);

      return {
        success: true,
        config: nextConfig,
        failureReason: null,
        probeWarnings: [],
      };
    },

    async resolveLocalDependencies(profileId: string): Promise<unknown[]> {
      // K-AIEXEC-001: projection from portable AIProfile to LocalProfileDescriptor
      const client = createModRuntimeClient(CORE_RUNTIME_MOD_ID);
      const rawProfiles = await client.local.listProfiles();
      const matched = rawProfiles.find((p) => p.id === profileId);
      if (!matched?.entries) return [];
      return matched.entries;
    },
  };
}

/**
 * Static-schema preview warnings (D-AIPC-012 layer 1 / D-AIPC-014).
 *
 * Preview may carry availability / feasibility warnings without blocking the
 * diff. This collects only the static-schema-derivable ones — capability
 * intents that would materialize with no binding and no local profile ref,
 * i.e. an unexecutable capability. Runtime availability / resource feasibility
 * remain D-AIPC-005 commit-time concerns; preview does not go online.
 */
function collectProfileSchemaProbeWarnings(profile: AIProfile): string[] {
  const warnings: string[] = [];
  for (const capability of Object.keys(profile.capabilities).sort()) {
    const intent = profile.capabilities[capability];
    if (!intent) {
      continue;
    }
    const hasBinding = intent.binding !== undefined && intent.binding !== null;
    const hasLocalRef = intent.localProfileRef !== undefined && intent.localProfileRef !== null;
    if (!hasBinding && !hasLocalRef) {
      warnings.push(
        `Capability "${capability}" has no model binding; it will not be executable until configured.`,
      );
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// AIConfig surface implementation (S-AICONF-001 config CRUD + probe)
// ---------------------------------------------------------------------------

function createAIConfigSurface(): AIConfigSurface {
  return {
    get(scopeRef: AIScopeRef): AIConfig {
      return getConfigForScope(scopeRef);
    },

    update(scopeRef: AIScopeRef, config: AIConfig): void {
      // Full materialized write (D-AIPC-003)
      const resolved: AIConfig = {
        ...config,
        scopeRef,
      };
      commitConfig(resolved);
    },

    listScopes(): AIScopeRef[] {
      ensureHydrated();
      const refs: AIScopeRef[] = [];
      for (const key of configByScope.keys()) {
        const ref = parseScopeKey(key);
        if (ref) refs.push(ref);
      }
      return refs;
    },

    async probe(scopeRef: AIScopeRef): Promise<AIConfigProbeResult> {
      // D-AIPC-012 layer 2: runtime availability probe
      const config = this.get(scopeRef);
      const routeRuntime = getConversationCapabilityRouteRuntime();
      if (!routeRuntime) {
        return { status: 'unknown', capabilityStatuses: {} };
      }
      return probeConfigAvailability(config, routeRuntime);
    },

    async probeFeasibility(scopeRef: AIScopeRef): Promise<AIConfigProbeResult> {
      // D-AIPC-012 layer 3: resource feasibility probe.
      // Consumes runtime Peek (K-SCHED-002) for scheduling judgement.
      const config = this.get(scopeRef);
      const routeRuntime = getConversationCapabilityRouteRuntime();
      if (!routeRuntime) {
        return { status: 'unknown', capabilityStatuses: {}, schedulingJudgement: null };
      }
      const availabilityResult = await probeConfigAvailability(config, routeRuntime);
      const targets = resolveAIConfigScopeSchedulingTargets(config);
      const schedulingJudgement = targets.length > 0
        ? await peekAggregateSchedulingJudgement(DESKTOP_RUNTIME_APP_ID, targets)
        : null;

      // Aggregate status projection: combine availability + scheduling.
      let status: AIProbeStatus = availabilityResult.status;
      if (schedulingJudgement) {
        if (schedulingJudgement.state === 'denied') {
          status = 'unavailable';
        } else if (schedulingJudgement.state === 'unknown' && status === 'available') {
          // Scheduling assessment missing but routes are healthy → degraded.
          status = 'degraded';
        }
        // queue_required, preemption_risk, slowdown_risk: advisory, don't downgrade.
      } else if (targets.length > 0 && status === 'available') {
        // No scheduling data at all — degraded.
        status = 'degraded';
      }

      return { ...availabilityResult, status, schedulingJudgement };
    },

    async probeSchedulingTarget(
      scopeRef: AIScopeRef,
      target: AISchedulingEvaluationTarget,
    ): Promise<AISchedulingJudgement | null> {
      const normalizedTarget = normalizeSchedulingTarget(target);
      if (!normalizedTarget) {
        return null;
      }
      const batchResult = await peekSchedulingBatch(DESKTOP_RUNTIME_APP_ID, [normalizedTarget]);
      if (!batchResult) {
        return null;
      }
      const exactMatch = batchResult.targetJudgements.find((entry) =>
        schedulingTargetsEqual(entry.target, normalizedTarget));
      return exactMatch?.judgement ?? batchResult.aggregateJudgement ?? null;
    },

    subscribe(scopeRef: AIScopeRef, callback: (config: AIConfig) => void): () => void {
      const id = ++subscriptionIdCounter;
      subscriptions.set(id, {
        scopeKey: scopeKey(scopeRef),
        callback,
      });
      return () => { subscriptions.delete(id); };
    },
  };
}

// ---------------------------------------------------------------------------
// AISnapshot surface implementation (S-AICONF-001 snapshot read)
// ---------------------------------------------------------------------------

function createAISnapshotSurface(): AISnapshotSurface {
  return {
    record(scopeRef: AIScopeRef, snapshot: AISnapshot): void {
      storeSnapshot(snapshotStore, {
        ...snapshot,
        scopeRef,
      });
    },

    get(executionId: string): AISnapshot | null {
      return snapshotStore.byExecutionId.get(executionId) || null;
    },

    getLatest(scopeRef: AIScopeRef): AISnapshot | null {
      return snapshotStore.byScopeKey.get(scopeKey(scopeRef)) || null;
    },
  };
}

// ---------------------------------------------------------------------------
// Aggregate surface factory
// ---------------------------------------------------------------------------

let desktopAIConfigServiceSingleton: AIConfigSDKSurface | null = null;

/**
 * Get or create the shared Desktop host AIConfig service singleton.
 */
export function getDesktopAIConfigService(): AIConfigSDKSurface {
  if (!desktopAIConfigServiceSingleton) {
    desktopAIConfigServiceSingleton = {
      aiProfile: createAIProfileSurface(),
      aiConfig: createAIConfigSurface(),
      aiSnapshot: createAISnapshotSurface(),
    };
  }
  return desktopAIConfigServiceSingleton;
}

/**
 * Bind the Zustand app store setter so the service can push config
 * updates to the store atomically. Must be called once at bootstrap.
 *
 * The setter receives the scope key and config. Consumer-local active-scope
 * helpers decide whether to project that update into app state.
 */
export function bindDesktopAIConfigAppStore(
  setter: (scopeKey: string, config: AIConfig) => void,
): void {
  appStoreSetter = setter;
}

/**
 * Record an AISnapshot into host-local storage.
 * Called by submit/execution paths after snapshot creation.
 */
export function recordDesktopAISnapshot(snapshot: AISnapshot): void {
  getDesktopAIConfigService().aiSnapshot.record(snapshot.scopeRef, snapshot);
}

// ---------------------------------------------------------------------------
// Scheduling evidence helper (K-AIEXEC-003 + K-SCHED-002)
// ---------------------------------------------------------------------------

export function resolveAIConfigScopeSchedulingTargets(
  config: AIConfig,
): AISchedulingEvaluationTarget[] {
  const localRefs = config.capabilities.localProfileRefs || {};
  const selectedBindings = config.capabilities.selectedBindings || {};
  const targets: AISchedulingEvaluationTarget[] = [];
  const capabilities = Object.keys(selectedBindings).sort((left, right) => left.localeCompare(right));
  for (const capability of capabilities) {
    const binding = selectedBindings[capability];
    if (!binding || binding.source !== 'local') {
      continue;
    }
    const ref = localRefs[capability];
    targets.push({
      capability,
      modId: ref?.modId || null,
      profileId: ref?.profileId || null,
      resourceHint: null,
    });
  }
  return targets;
}

export function resolveAIConfigSchedulingTargetForCapability(
  config: AIConfig,
  capability: string,
): AISchedulingEvaluationTarget | null {
  const binding = config.capabilities.selectedBindings?.[capability];
  if (!binding || binding.source !== 'local') {
    return null;
  }
  const ref = config.capabilities.localProfileRefs?.[capability];
  return {
    capability,
    modId: ref?.modId || null,
    profileId: ref?.profileId || null,
    resourceHint: null,
  };
}

const VALID_SCHEDULING_STATES: AISchedulingState[] = [
  'runnable', 'queue_required', 'preemption_risk', 'slowdown_risk', 'denied', 'unknown',
];

type SchedulingBatchPeekResult = {
  occupancy: AISchedulingJudgement['occupancy'];
  aggregateJudgement: AISchedulingJudgement | null;
  targetJudgements: Array<{
    target: AISchedulingEvaluationTarget;
    judgement: AISchedulingJudgement;
  }>;
};

function normalizeSchedulingTarget(
  target: AISchedulingEvaluationTarget | null | undefined,
): AISchedulingEvaluationTarget | null {
  if (!target) {
    return null;
  }
  const capability = String(target.capability || '').trim();
  if (!capability) {
    return null;
  }
  return {
    capability,
    modId: String(target.modId || '').trim() || null,
    profileId: String(target.profileId || '').trim() || null,
    resourceHint: target.resourceHint ? {
      estimatedVramBytes: target.resourceHint.estimatedVramBytes ?? null,
      estimatedRamBytes: target.resourceHint.estimatedRamBytes ?? null,
      estimatedDiskBytes: target.resourceHint.estimatedDiskBytes ?? null,
      engine: target.resourceHint.engine ?? null,
    } : null,
  };
}

function schedulingTargetsEqual(
  left: AISchedulingEvaluationTarget,
  right: AISchedulingEvaluationTarget,
): boolean {
  return left.capability === right.capability
    && (left.modId || null) === (right.modId || null)
    && (left.profileId || null) === (right.profileId || null);
}

function toSchedulingJudgement(value: {
  state: string;
  detail: string;
  occupancy: { globalUsed: number; globalCap: number; appUsed: number; appCap: number } | null;
  resourceWarnings: string[];
} | null | undefined): AISchedulingJudgement | null {
  if (!value) {
    return null;
  }
  const state = VALID_SCHEDULING_STATES.includes(value.state as AISchedulingState)
    ? value.state as AISchedulingState
    : 'unknown';
  return {
    state,
    detail: value.detail || null,
    occupancy: value.occupancy,
    resourceWarnings: value.resourceWarnings || [],
  };
}

async function peekSchedulingBatch(
  appId: string,
  targets: AISchedulingEvaluationTarget[],
): Promise<SchedulingBatchPeekResult | null> {
  const normalizedTargets = targets
    .map((target) => normalizeSchedulingTarget(target))
    .filter((target): target is AISchedulingEvaluationTarget => target !== null);
  if (normalizedTargets.length === 0) {
    return null;
  }
  try {
    const client = createModRuntimeClient(CORE_RUNTIME_MOD_ID);
    const peekResult = await client.scheduler.peek({
      appId,
      targets: normalizedTargets,
    });
    return {
      occupancy: peekResult.occupancy,
      aggregateJudgement: toSchedulingJudgement(peekResult.aggregateJudgement),
      targetJudgements: (peekResult.targetJudgements || [])
        .map((entry) => {
          const target = normalizeSchedulingTarget(entry.target);
          const judgement = toSchedulingJudgement(entry.judgement);
          if (!target || !judgement) {
            return null;
          }
          return { target, judgement };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    };
  } catch {
    // Runtime Peek RPC not available — honest null per D-AIPC-012.
    return null;
  }
}

async function peekAggregateSchedulingJudgement(
  appId: string,
  targets: AISchedulingEvaluationTarget[],
): Promise<AISchedulingJudgement | null> {
  const batchResult = await peekSchedulingBatch(appId, targets);
  return batchResult?.aggregateJudgement ?? null;
}

/**
 * Peek scheduling judgement for snapshot evidence capture.
 * Returns AIRuntimeEvidence with scheduling judgement, or null if unavailable.
 * Used by AI and Agent submit paths before creating AISnapshot.
 *
 */
export async function peekDesktopAISchedulingForEvidence(input: {
  scopeRef: AIScopeRef;
  target: AISchedulingEvaluationTarget | null;
}): Promise<AIRuntimeEvidence | null> {
  const target = normalizeSchedulingTarget(input.target);
  if (!target) {
    return null;
  }
  const judgement = await getDesktopAIConfigService().aiConfig.probeSchedulingTarget(
    input.scopeRef,
    target,
  );
  return judgement ? { schedulingJudgement: judgement } : null;
}

// ---------------------------------------------------------------------------
// Probe helper
// ---------------------------------------------------------------------------

async function probeConfigAvailability(
  config: AIConfig,
  routeRuntime: ConversationCapabilityRouteRuntime,
): Promise<AIConfigProbeResult> {
  const capabilityStatuses: Partial<Record<string, AIProbeStatus>> = {};
  const bindingEntries = Object.entries(config.capabilities.selectedBindings);

  if (bindingEntries.length === 0) {
    return { status: 'unavailable', capabilityStatuses: {} };
  }

  let allAvailable = true;
  let anyAvailable = false;

  await Promise.all(
    bindingEntries.map(async ([capability, binding]) => {
      if (!binding) {
        capabilityStatuses[capability] = 'unavailable';
        allAvailable = false;
        return;
      }
      try {
        const health = await routeRuntime.checkHealth({
          capability: capability as Parameters<typeof routeRuntime.checkHealth>[0]['capability'],
          binding,
        });
        const healthy = health.healthy !== false
          && health.status !== 'unavailable'
          && health.status !== 'unhealthy';
        capabilityStatuses[capability] = healthy ? 'available' : 'unavailable';
        if (healthy) anyAvailable = true;
        else allAvailable = false;
      } catch {
        capabilityStatuses[capability] = 'unavailable';
        allAvailable = false;
      }
    }),
  );

  let status: AIProbeStatus;
  if (allAvailable) status = 'available';
  else if (anyAvailable) status = 'degraded';
  else status = 'unavailable';

  return { status, capabilityStatuses };
}

// ---------------------------------------------------------------------------
// Internal: runtime local profile -> AIProfile bridge
// ---------------------------------------------------------------------------

function toAIProfile(raw: {
  id: string;
  title?: string;
  description?: string;
  entries?: Array<{
    capability?: string;
    assetId?: string;
    engine?: string;
  }>;
}): AIProfile {
  const capabilities: AIProfile['capabilities'] = {};

  for (const entry of raw.entries || []) {
    const cap = entry.capability || 'image.generate';
    capabilities[cap] = {
      localProfileRef: { modId: CORE_RUNTIME_MOD_ID, profileId: raw.id },
      binding: entry.assetId
        ? {
          source: 'local' as const,
          connectorId: '',
          model: entry.assetId,
          localModelId: entry.assetId,
          engine: entry.engine || undefined,
        }
        : null,
    };
  }

  return {
    profileId: raw.id,
    title: raw.title || raw.id,
    description: raw.description || '',
    tags: [],
    capabilities,
  };
}
