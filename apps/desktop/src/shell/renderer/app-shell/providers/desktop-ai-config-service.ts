/**
 * Shared Desktop host NimiAIConfig service (S-AICONF-001~006).
 *
 * Desktop host owns app scope NimiAIConfig and NimiAISnapshot persistence here.
 * Chat and runtime-config callers consume this service;
 * none of them own the underlying persistence authority.
 */

import {
  createNimiAIConfigSubscriptionRegistry,
  createNimiAIRuntimeEvidence,
  previewNimiAIProfileApply,
  validateNimiAIProfile,
  versionNimiAIConfig,
  type NimiAIConfig,
  type NimiAIConfigProbeResult,
  type NimiAIProfile,
  type NimiAIProfileApplyOptions,
  type NimiAIProfilePreviewOptions,
  type NimiAIProfileApplyResult,
  type NimiAIProfilePreviewResult,
  type NimiAIProfileValidationResult,
  type NimiAIProbeStatus,
  type NimiAIRuntimeEvidence,
  type NimiAISchedulingEvaluationTarget,
  type NimiAISchedulingJudgement,
  type NimiAIScopeRef,
  type NimiAISnapshot,
} from '@nimiplatform/sdk/ai';
import type { NimiDesktopMachineProductRuntimeClient } from '@nimiplatform/sdk/runtime';
import {
  listPersistedScopeKeys,
  loadAIConfigForScope,
  parseScopeKey,
  persistAIConfigForScope,
  scopeKeyFromRef,
} from './desktop-ai-config-storage.js';
import type { ConversationCapabilityRouteRuntime } from '../../features/chat/conversation-capability.js';
import { getProductionConversationCapabilityRouteRuntime } from '../../features/chat/production-conversation-route-runtime-state.js';
import {
  listAccountProfileLibrary,
} from '../../bridge/runtime-bridge/account-profile-library.js';

import { createDesktopAISnapshotStore } from './desktop-ai-config-snapshot-store.js';
import {
  ensureDesktopAppFirstLaunchAIConfig,
  type EnsureAppFirstLaunchAIConfigDepsOverride,
  type EnsureAppFirstLaunchAIConfigInput,
} from './desktop-ai-config-first-launch.js';

import {
  normalizeNimiAISchedulingTarget,
  peekDesktopRuntimeAggregateSchedulingJudgement,
  peekDesktopRuntimeSchedulingBatch,
  resolveNimiAIConfigRuntimeSchedulingTargets,
  nimiAISchedulingTargetsEqual,
} from './desktop-ai-config-scheduling.js';

// ---------------------------------------------------------------------------
// Multi-scope config state
// ---------------------------------------------------------------------------

const snapshotStore = createDesktopAISnapshotStore();
const configSubscriptions = createNimiAIConfigSubscriptionRegistry();

function scopeKey(ref: NimiAIScopeRef): string {
  return scopeKeyFromRef(ref);
}

/** In-memory config map keyed by scope key string. */
const configByScope = new Map<string, NimiAIConfig>();
const materializedScopeKeys = new Set<string>();

const CORE_RUNTIME_PROFILE_OWNER_ID = 'core:runtime';
const DESKTOP_RUNTIME_APP_ID = 'nimi.desktop';

export type DesktopAIProfileSurface = {
  list(): Promise<NimiAIProfile[]>;
  get(profileId: string): Promise<NimiAIProfile | null>;
  validate(profile: NimiAIProfile): NimiAIProfileValidationResult;
  previewApply(
    scopeRef: NimiAIScopeRef,
    profileId: string,
    options: NimiAIProfilePreviewOptions,
  ): Promise<NimiAIProfilePreviewResult>;
  apply(
    scopeRef: NimiAIScopeRef,
    profileId: string,
    options: NimiAIProfileApplyOptions,
  ): Promise<NimiAIProfileApplyResult>;
};

export type DesktopAIConfigSurface = {
  get(scopeRef: NimiAIScopeRef): NimiAIConfig;
  update(scopeRef: NimiAIScopeRef, config: NimiAIConfig): void;
  listScopes(): readonly NimiAIScopeRef[];
  probe(scopeRef: NimiAIScopeRef): Promise<NimiAIConfigProbeResult>;
  probeFeasibility(
    scopeRef: NimiAIScopeRef,
    runtime?: NimiDesktopMachineProductRuntimeClient,
  ): Promise<NimiAIConfigProbeResult>;
  probeSchedulingTarget(
    scopeRef: NimiAIScopeRef,
    target: NimiAISchedulingEvaluationTarget,
    runtime?: NimiDesktopMachineProductRuntimeClient,
  ): Promise<NimiAISchedulingJudgement | null>;
  subscribe(scopeRef: NimiAIScopeRef, callback: (config: NimiAIConfig) => void): () => void;
};

export type DesktopAISnapshotSurface = {
  record(snapshot: NimiAISnapshot): void;
  get(executionId: string): NimiAISnapshot | null;
  getLatest(scopeRef: NimiAIScopeRef): NimiAISnapshot | null;
};

export type DesktopAIConfigSDKSurface = {
  aiProfile: DesktopAIProfileSurface;
  aiConfig: DesktopAIConfigSurface;
  aiSnapshot: DesktopAISnapshotSurface;
};

/**
 * App store sync callback. Set by `bindDesktopAIConfigAppStore()` at bootstrap time.
 * Receives the scope key and new config so the store can decide whether
 * to update (e.g. the Zustand store only tracks the "active" scope).
 */
let appStoreSetter: ((scopeKey: string, config: NimiAIConfig) => void) | null = null;

/** Bootstrap: load all persisted scopes into memory. */
function ensureHydrated(): void {
  if (configByScope.size > 0) return;
  const keys = listPersistedScopeKeys();
  for (const key of keys) {
    const ref = parseScopeKey(key);
    if (!ref) continue;
    const config = loadAIConfigForScope(ref);
    configByScope.set(key, config);
    materializedScopeKeys.add(key);
  }
}

/**
 * True when the scope already has a persisted (or in-memory) NimiAIConfig.
 * Used by `previewApply` to decide whether `before` is a real config or an
 * explicit `null` first-apply (D-AIPC-014).
 */
function scopeHasPersistedConfig(scopeRef: NimiAIScopeRef): boolean {
  ensureHydrated();
  const key = scopeKey(scopeRef);
  if (materializedScopeKeys.has(key)) {
    return true;
  }
  return listPersistedScopeKeys().includes(key);
}

/**
 * Get the in-memory config for a scope, loading from persistence if needed.
 */
function getConfigForScope(scopeRef: NimiAIScopeRef): NimiAIConfig {
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
 * This is the single write path for NimiAIConfig. No caller outside this module
 * should write to persistence or app store directly for config mutations.
 */
function commitConfig(config: NimiAIConfig, options?: { readonly expectedBaseVersion?: string }): void {
  const key = scopeKey(config.scopeRef);
  const expectedBaseVersion = options?.expectedBaseVersion?.trim();
  if (expectedBaseVersion) {
    const current = getConfigForScope(config.scopeRef);
    const currentVersion = versionNimiAIConfig(current);
    if (currentVersion !== expectedBaseVersion) {
      throw new Error('NimiAIConfig CAS conflict: baseVersion is stale');
    }
  }
  persistAIConfigForScope(config);
  configByScope.set(key, config);
  materializedScopeKeys.add(key);
  if (appStoreSetter) {
    appStoreSetter(key, config);
  }
  configSubscriptions.notify(config);
}

export function pushDesktopAIConfigToBoundStore(scopeRef: NimiAIScopeRef): void {
  if (!appStoreSetter) {
    return;
  }
  appStoreSetter(scopeKey(scopeRef), getConfigForScope(scopeRef));
}

// ---------------------------------------------------------------------------
// Per-app first-launch NimiAIConfig initialization (S-AICONF-009)
// ---------------------------------------------------------------------------

/**
 * Initialize a Nimi App's per-app NimiAIConfig on first launch (S-AICONF-009).
 *
 * Wires the host-agnostic SDK helper `ensureAppFirstLaunchAIConfig` to the
 * Desktop host NimiAIConfig persistence:
 *  - the init scope is the canonical `P-AISC-007` app shape;
 *  - an existing per-app NimiAIConfig is returned unchanged and NEVER overwritten
 *    on any later launch when the Account Default Profile changes;
 *  - first launch materializes the scope's NimiAIConfig only from the Account
 *    Default Profile (`P-AIPS-013`) via the typed atomic-overwrite apply path
 *    (`commitConfig`); future registry or package metadata is not an input;
 *  - when the Account Default Profile does not resolve, it fails closed — no
 *    synthesized, empty, or placeholder NimiAIConfig and no launch;
 *  - unmet manifest requirements surface as a typed setup/repair plan.
 */
export async function ensureAppFirstLaunchAIConfig(
  input: EnsureAppFirstLaunchAIConfigInput,
  deps?: EnsureAppFirstLaunchAIConfigDepsOverride,
): ReturnType<typeof ensureDesktopAppFirstLaunchAIConfig> {
  return ensureDesktopAppFirstLaunchAIConfig(input, {
    scopeHasPersistedConfig,
    getConfigForScope,
    commitConfig,
  }, deps);
}

// ---------------------------------------------------------------------------
// NimiAIProfile surface implementation (S-AICONF-001 catalog + apply)
// ---------------------------------------------------------------------------

async function resolveAccountLibraryAIProfile(profileId: string): Promise<NimiAIProfile | null> {
  try {
    const projection = await listAccountProfileLibrary();
    return projection.profiles
      .map((entry) => entry.profile)
      .find((profile) => profile.profileId === profileId) ?? null;
  } catch {
    return null;
  }
}

async function resolveDesktopAIProfile(profileId: string): Promise<NimiAIProfile | null> {
  const normalizedProfileId = String(profileId || '').trim();
  if (!normalizedProfileId) {
    return null;
  }
  return resolveAccountLibraryAIProfile(normalizedProfileId);
}

function createMissingProfileApplyResult(profileId: string): NimiAIProfileApplyResult {
  return {
    success: false,
    config: null,
    failureReason: `profile_not_found:${profileId}`,
    outcome: 'failed',
    probeWarnings: [`AI profile not found: ${profileId}`],
  };
}

function createAIProfileSurface(): DesktopAIProfileSurface {
  async function previewApply(
    scopeRef: NimiAIScopeRef,
    profileId: string,
    previewOptions: NimiAIProfilePreviewOptions,
  ): Promise<NimiAIProfilePreviewResult> {
    const profile = await resolveDesktopAIProfile(profileId);
    if (!profile) {
      return {
        before: scopeHasPersistedConfig(scopeRef) ? getConfigForScope(scopeRef) : null,
        after: null,
        outcome: 'failed',
        diff: { identical: true, fields: [] },
        baseVersion: versionNimiAIConfig(getConfigForScope(scopeRef)),
        probeWarnings: [`AI profile not found: ${profileId}`],
      };
    }
    return previewNimiAIProfileApply({
      before: scopeHasPersistedConfig(scopeRef) ? getConfigForScope(scopeRef) : null,
      scopeRef,
      profile,
      requirementDeclarations: previewOptions.requirementDeclarations,
    });
  }

  return {
    async list(): Promise<NimiAIProfile[]> {
      try {
        const projection = await listAccountProfileLibrary();
        return projection.profiles.map((entry) => entry.profile);
      } catch {
        return [];
      }
    },

    async get(profileId: string): Promise<NimiAIProfile | null> {
      return resolveDesktopAIProfile(profileId);
    },

    validate(profile: NimiAIProfile): NimiAIProfileValidationResult {
      return validateNimiAIProfile(profile);
    },

    previewApply,

    async apply(
      scopeRef: NimiAIScopeRef,
      profileId: string,
      options: NimiAIProfileApplyOptions,
    ): Promise<NimiAIProfileApplyResult> {
      const preview = await previewApply(scopeRef, profileId, {
        requirementDeclarations: options.requirementDeclarations,
      });
      if (preview.outcome === 'failed') {
        return createMissingProfileApplyResult(profileId);
      }
      if (preview.outcome !== 'ready_to_apply' || !preview.after) {
        return {
          success: false,
          config: null,
          failureReason: preview.outcome,
          outcome: preview.outcome,
          setupProjection: preview.setupProjection,
          probeWarnings: preview.probeWarnings,
        };
      }
      if (options.expectedBaseVersion && options.expectedBaseVersion !== preview.baseVersion) {
        return {
          success: false,
          config: null,
          failureReason: 'stale_base',
          outcome: 'stale_base',
          probeWarnings: [],
        };
      }
      commitConfig(preview.after, options.expectedBaseVersion
        ? { expectedBaseVersion: options.expectedBaseVersion }
        : undefined);
      return {
        success: true,
        config: getConfigForScope(scopeRef),
        failureReason: null,
        outcome: 'ready_to_apply',
        probeWarnings: [],
      };
    },

  };
}

// ---------------------------------------------------------------------------
// NimiAIConfig surface implementation (S-AICONF-001 config CRUD + probe)
// ---------------------------------------------------------------------------

function createAIConfigSurface(): DesktopAIConfigSurface {
  return {
    get(scopeRef: NimiAIScopeRef): NimiAIConfig {
      return getConfigForScope(scopeRef);
    },

    update(scopeRef: NimiAIScopeRef, config: NimiAIConfig): void {
      // Full materialized write (D-AIPC-003)
      const resolved: NimiAIConfig = {
        ...config,
        scopeRef,
      };
      commitConfig(resolved);
    },

    listScopes(): NimiAIScopeRef[] {
      ensureHydrated();
      const refs: NimiAIScopeRef[] = [];
      for (const key of configByScope.keys()) {
        const ref = parseScopeKey(key);
        if (ref) refs.push(ref);
      }
      return refs;
    },

    async probe(scopeRef: NimiAIScopeRef): Promise<NimiAIConfigProbeResult> {
      // D-AIPC-012 layer 2: runtime availability probe
      const config = this.get(scopeRef);
      const routeRuntime = getProductionConversationCapabilityRouteRuntime();
      if (!routeRuntime) {
        return { status: 'unknown', capabilityStatuses: {} };
      }
      return probeConfigAvailability(config, routeRuntime);
    },

    async probeFeasibility(
      scopeRef: NimiAIScopeRef,
      runtime?: NimiDesktopMachineProductRuntimeClient,
    ): Promise<NimiAIConfigProbeResult> {
      // D-AIPC-012 layer 3: resource feasibility probe.
      // Consumes runtime Peek (K-SCHED-002) for scheduling judgement.
      const config = this.get(scopeRef);
      const routeRuntime = getProductionConversationCapabilityRouteRuntime();
      if (!routeRuntime) {
        return { status: 'unknown', capabilityStatuses: {}, schedulingJudgement: null };
      }
      const availabilityResult = await probeConfigAvailability(config, routeRuntime);
      const targets = resolveNimiAIConfigRuntimeSchedulingTargets(config);
      const schedulingJudgement = targets.length > 0 && runtime
        ? await peekDesktopRuntimeAggregateSchedulingJudgement(
          runtime,
          CORE_RUNTIME_PROFILE_OWNER_ID,
          DESKTOP_RUNTIME_APP_ID,
          targets,
        )
        : null;

      // Aggregate status projection: combine availability + scheduling.
      let status: NimiAIProbeStatus = availabilityResult.status;
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
      scopeRef: NimiAIScopeRef,
      target: NimiAISchedulingEvaluationTarget,
      runtime?: NimiDesktopMachineProductRuntimeClient,
    ): Promise<NimiAISchedulingJudgement | null> {
      const normalizedTarget = normalizeNimiAISchedulingTarget(target);
      if (!normalizedTarget) {
        return null;
      }
      if (!runtime) return null;
      const batchResult = await peekDesktopRuntimeSchedulingBatch(
        runtime,
        CORE_RUNTIME_PROFILE_OWNER_ID,
        DESKTOP_RUNTIME_APP_ID,
        [normalizedTarget],
      );
      if (!batchResult) {
        return null;
      }
      const exactMatch = batchResult.targetJudgements.find((entry) =>
        nimiAISchedulingTargetsEqual(entry.target, normalizedTarget));
      return exactMatch?.judgement ?? batchResult.aggregateJudgement ?? null;
    },

    subscribe(scopeRef: NimiAIScopeRef, callback: (config: NimiAIConfig) => void): () => void {
      return configSubscriptions.subscribe(scopeRef, callback);
    },
  };
}

// ---------------------------------------------------------------------------
// NimiAISnapshot surface implementation (S-AICONF-001 snapshot read)
// ---------------------------------------------------------------------------

function createAISnapshotSurface(): DesktopAISnapshotSurface {
  return {
    record(snapshot: NimiAISnapshot): void {
      snapshotStore.record(snapshot);
    },

    get(executionId: string): NimiAISnapshot | null {
      return snapshotStore.get(executionId);
    },

    getLatest(scopeRef: NimiAIScopeRef): NimiAISnapshot | null {
      return snapshotStore.getLatest(scopeRef);
    },
  };
}

// ---------------------------------------------------------------------------
// Aggregate surface factory
// ---------------------------------------------------------------------------

let desktopAIConfigServiceSingleton: DesktopAIConfigSDKSurface | null = null;

/**
 * Get or create the shared Desktop host NimiAIConfig service singleton.
 */
export function getDesktopAIConfigService(): DesktopAIConfigSDKSurface {
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
  setter: (scopeKey: string, config: NimiAIConfig) => void,
): void {
  appStoreSetter = setter;
}

/**
 * Record an NimiAISnapshot into host-local storage.
 * Called by submit/execution paths after snapshot creation.
 */
export function recordDesktopAISnapshot(snapshot: NimiAISnapshot): void {
  getDesktopAIConfigService().aiSnapshot.record(snapshot);
}

// ---------------------------------------------------------------------------
// Scheduling evidence helper (K-AIEXEC-003 + K-SCHED-002)
// ---------------------------------------------------------------------------

export {
  resolveNimiAIConfigRuntimeSchedulingTargetForCapability,
  resolveNimiAIConfigRuntimeSchedulingTargets,
} from './desktop-ai-config-scheduling.js';
export type {
  EnsureAppFirstLaunchAIConfigDepsOverride,
  EnsureAppFirstLaunchAIConfigInput,
} from './desktop-ai-config-first-launch.js';

/**
 * Peek scheduling judgement for snapshot evidence capture.
 * Returns NimiAIRuntimeEvidence with scheduling judgement, or null if unavailable.
 * Used by AI and Agent submit paths before creating NimiAISnapshot.
 *
 */
export async function peekDesktopAISchedulingForEvidence(input: {
  scopeRef: NimiAIScopeRef;
  target: NimiAISchedulingEvaluationTarget | null;
  runtime: NimiDesktopMachineProductRuntimeClient;
}): Promise<NimiAIRuntimeEvidence | null> {
  const target = normalizeNimiAISchedulingTarget(input.target);
  if (!target) {
    return null;
  }
  const judgement = await getDesktopAIConfigService().aiConfig.probeSchedulingTarget(
    input.scopeRef,
    target,
    input.runtime,
  );
  return createNimiAIRuntimeEvidence({ schedulingJudgement: judgement });
}

// ---------------------------------------------------------------------------
// Probe helper
// ---------------------------------------------------------------------------

async function probeConfigAvailability(
  config: NimiAIConfig,
  _routeRuntime: ConversationCapabilityRouteRuntime,
): Promise<NimiAIConfigProbeResult> {
  const capabilityStatuses: Record<string, NimiAIProbeStatus> = {};
  const targetRefEntries = Object.entries(config.capabilities.targetRefs);

  if (targetRefEntries.length === 0) {
    return { status: 'unavailable', capabilityStatuses: {} };
  }

  for (const [capability, targetRef] of targetRefEntries) {
    capabilityStatuses[capability] = targetRef ? 'unknown' : 'unavailable';
  }

  return { status: 'unknown', capabilityStatuses };
}
