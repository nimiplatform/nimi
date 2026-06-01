// Realm import & promotion boundary (wave-6). Stage-one Realm use is STRUCTURAL
// REFERENCE and reverse-audit only: Storybook may point at Realm world/agent
// definitions by stable ref, or fork them into app-owned adaptation truth, but it
// never mutates Realm and never treats Realm as live distribution. Three states:
//
//   imported_ref         — read-only Realm ref + release/version; Storybook owns nothing.
//   adapted_fork         — app-owned adaptation derived from a Realm ref, preserving
//                          origin ref, source release, divergence reason, local precedence.
//   promoted_realm_change — an EXPLICIT outbound proposal (handshake). Never caused by
//                          run execution. Run state / transcripts / scratch can NEVER
//                          become Realm truth — that is fail-closed here.
//
// This module has no Runtime/Realm imports: it is an app-local data model + validators.
// It cannot, by construction, write to Realm or shared ecosystem memory.

import { type TruthRef, isTruthRef, mintId } from './ids.js';
import { type Result, ok, fail, type ValidationFinding } from './failure.js';

export type RealmObjectKind =
  | 'world-rule'
  | 'agent-rule'
  | 'canonical-truth-package'
  | 'inheritance-link'
  | 'world-release'
  | 'projection-input';

export type RealmImportState = 'imported_ref' | 'adapted_fork' | 'promoted_realm_change';

/** copy = a snapshot was taken; reference = read-only live ref. */
export type RealmCopyMode = 'reference' | 'copy';

export type RealmConflictStatus =
  | 'none'
  | 'stale_imported_ref'
  | 'local_divergence'
  | 'realm_hard_truth_contradiction'
  | 'user_approved_story_local_divergence';

/** Stable Realm ref. Shape: `realm:<namespace>:<kind>:<localId>`. Release is carried separately. */
export type RealmRef = `realm:${string}:${RealmObjectKind}:${string}`;

export function makeRealmRef(namespace: string, kind: RealmObjectKind, localId: string): RealmRef {
  return `realm:${namespace}:${kind}:${localId}` as RealmRef;
}

export function parseRealmRef(ref: string): { namespace: string; kind: RealmObjectKind; localId: string } | null {
  const parts = ref.split(':');
  if (parts.length !== 4 || parts[0] !== 'realm') return null;
  const [, namespace, kind, localId] = parts;
  if (!namespace || !kind || !localId) return null;
  return { namespace, kind: kind as RealmObjectKind, localId };
}

export function isRealmRef(value: unknown): value is RealmRef {
  return typeof value === 'string' && parseRealmRef(value) !== null;
}

export type RealmWorldAgentImport = {
  id: string;
  state: RealmImportState;
  realmRef: RealmRef;
  realmObjectKind: RealmObjectKind;
  /** Source release/version this import was pinned to. */
  realmRelease: string;
  refNamespace: string;
  copyMode: RealmCopyMode;
  /** The Storybook projection input that consumes this import, if any. */
  importedProjectionInputRef?: string;
  // --- adapted_fork only ---
  /** App-owned truth ref the fork created (Storybook authority, provenance world-inherited). */
  originTruthRef?: TruthRef;
  divergenceReason?: string;
  localPrecedence?: boolean;
  currentPackageVersion?: number;
  conflictStatus: RealmConflictStatus;
};

export type RealmObjectMutation = 'create' | 'update' | 'supersede' | 'delete';

/** An EXPLICIT outbound proposal to change Realm. Never produced by run execution. */
export type RealmPromotionRequest = {
  id: string;
  targetRealmObject: { kind: RealmObjectKind; ref: RealmRef };
  mutationType: RealmObjectMutation;
  /** Source authority refs — MUST be Storybook truth refs, never run/transcript/scratch ids. */
  sourceTruthRefs: TruthRef[];
  evidenceRefs: string[];
  conflictStatus: RealmConflictStatus;
  /** Reviewer / authority that must approve the handshake. */
  authority: string;
  note: string;
  createdAt: string;
};

export type RealmPromotionResult = {
  requestId: string;
  accepted: boolean;
  resultingRelease?: string;
  reason: string;
  decidedAt: string;
};

// --- constructors (fail-closed) ---

export function createImportedRef(input: {
  realmRef: RealmRef;
  realmObjectKind: RealmObjectKind;
  realmRelease: string;
  copyMode?: RealmCopyMode;
}): Result<RealmWorldAgentImport> {
  if (!isRealmRef(input.realmRef)) return fail('realm_world_agent_import_invalid', `"${input.realmRef}" is not a Realm ref.`, ['realmRef']);
  if (!input.realmRelease.trim()) return fail('realm_world_agent_import_invalid', 'imported_ref requires a source release/version.', ['realmRelease']);
  const parsed = parseRealmRef(input.realmRef)!;
  return ok({
    id: mintId('realmimp'),
    state: 'imported_ref',
    realmRef: input.realmRef,
    realmObjectKind: input.realmObjectKind,
    realmRelease: input.realmRelease,
    refNamespace: parsed.namespace,
    copyMode: input.copyMode ?? 'reference',
    conflictStatus: 'none',
  });
}

export function createAdaptedFork(input: {
  realmRef: RealmRef;
  realmObjectKind: RealmObjectKind;
  realmRelease: string;
  originTruthRef: TruthRef;
  divergenceReason: string;
  currentPackageVersion: number;
}): Result<RealmWorldAgentImport> {
  if (!isRealmRef(input.realmRef)) return fail('realm_world_agent_import_invalid', `"${input.realmRef}" is not a Realm ref.`, ['realmRef']);
  if (!isTruthRef(input.originTruthRef)) return fail('realm_world_agent_import_invalid', 'adapted_fork requires a Storybook origin truth ref.', ['originTruthRef']);
  if (!input.divergenceReason.trim()) return fail('realm_world_agent_import_invalid', 'adapted_fork requires a divergence reason.', ['divergenceReason']);
  if (!input.realmRelease.trim()) return fail('realm_world_agent_import_invalid', 'adapted_fork requires the source release it diverged from.', ['realmRelease']);
  const parsed = parseRealmRef(input.realmRef)!;
  return ok({
    id: mintId('realmimp'),
    state: 'adapted_fork',
    realmRef: input.realmRef,
    realmObjectKind: input.realmObjectKind,
    realmRelease: input.realmRelease,
    refNamespace: parsed.namespace,
    copyMode: 'copy',
    originTruthRef: input.originTruthRef,
    divergenceReason: input.divergenceReason,
    localPrecedence: true,
    currentPackageVersion: input.currentPackageVersion,
    conflictStatus: 'local_divergence',
  });
}

// --- validators ---

/**
 * Validate a Realm import record. `knownRealmRelease`, when supplied, enables
 * stale-import detection: an `imported_ref` pinned to an older release than the
 * one Realm currently advertises is flagged `realm_imported_ref_stale` (explicit,
 * never silently refreshed).
 */
export function validateRealmImport(record: RealmWorldAgentImport, knownRealmRelease?: string): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (!isRealmRef(record.realmRef)) {
    findings.push({ code: 'realm_world_agent_import_invalid', message: `Import ${record.id} has an invalid Realm ref.`, pointers: [`realm-import:${record.id}`] });
  }
  if (record.state === 'adapted_fork') {
    if (!record.originTruthRef || !isTruthRef(record.originTruthRef)) {
      findings.push({ code: 'realm_world_agent_import_invalid', message: `adapted_fork ${record.id} must preserve a Storybook origin truth ref.`, pointers: [`realm-import:${record.id}`] });
    }
    if (!record.divergenceReason?.trim()) {
      findings.push({ code: 'realm_world_agent_import_invalid', message: `adapted_fork ${record.id} must record a divergence reason.`, pointers: [`realm-import:${record.id}`] });
    }
    if (record.localPrecedence !== true) {
      findings.push({ code: 'realm_world_agent_import_invalid', message: `adapted_fork ${record.id} must declare local precedence over the source ref.`, pointers: [`realm-import:${record.id}`] });
    }
  }
  if (knownRealmRelease && record.state === 'imported_ref' && record.realmRelease !== knownRealmRelease) {
    findings.push({ code: 'realm_imported_ref_stale', message: `imported_ref ${record.id} is pinned to release "${record.realmRelease}" but Realm advertises "${knownRealmRelease}".`, pointers: [`realm-import:${record.id}`] });
  }
  if (record.conflictStatus === 'realm_hard_truth_contradiction') {
    findings.push({ code: 'realm_import_conflict', message: `Import ${record.id} contradicts Realm hard truth and needs explicit resolution.`, pointers: [`realm-import:${record.id}`] });
  }
  return findings;
}

const RUN_STATE_PREFIXES = ['run_', 'snapshot_', 'turn:', 'transcript', 'spine_', 'genrun_'];

/** True when a ref looks like run/transcript/scratch state rather than authority. */
export function isRunStateRef(ref: string): boolean {
  if (isTruthRef(ref)) return false;
  return RUN_STATE_PREFIXES.some((prefix) => ref.startsWith(prefix));
}

/**
 * Build an outbound Realm promotion request. FAILS CLOSED if any source ref is run
 * state, a transcript, a branch snapshot, or authoring scratch — those can never
 * become Realm truth. Only Storybook authority truth refs are admissible sources.
 */
export function createRealmPromotionRequest(input: {
  targetRealmObject: { kind: RealmObjectKind; ref: RealmRef };
  mutationType: RealmObjectMutation;
  /** Raw source refs. Validated to be Storybook truth refs; run/transcript/scratch is rejected. */
  sourceTruthRefs: string[];
  evidenceRefs: string[];
  authority: string;
  note: string;
  now: string;
  conflictStatus?: RealmConflictStatus;
}): Result<RealmPromotionRequest> {
  if (!isRealmRef(input.targetRealmObject.ref)) {
    return fail('realm_promotion_request_invalid', 'Promotion target must be a Realm ref.', ['targetRealmObject.ref']);
  }
  if (!input.authority.trim()) {
    return fail('realm_promotion_request_invalid', 'A Realm promotion handshake requires a named reviewing authority.', ['authority']);
  }
  if (input.sourceTruthRefs.length === 0) {
    return fail('realm_promotion_request_invalid', 'A Realm promotion proposal requires at least one Storybook source truth ref.', ['sourceTruthRefs']);
  }
  for (const ref of input.sourceTruthRefs) {
    if (isRunStateRef(ref) || !isTruthRef(ref)) {
      return fail('realm_run_state_promotion_forbidden', `Source "${ref}" is run/transcript/scratch state and can never be promoted into Realm world truth.`, ['sourceTruthRefs']);
    }
  }
  return ok({
    id: mintId('realmprom'),
    targetRealmObject: input.targetRealmObject,
    mutationType: input.mutationType,
    // every entry validated as a truth ref above (and not run-state)
    sourceTruthRefs: input.sourceTruthRefs as TruthRef[],
    evidenceRefs: input.evidenceRefs,
    conflictStatus: input.conflictStatus ?? 'none',
    authority: input.authority,
    note: input.note,
    createdAt: input.now,
  });
}

/** Validate a promotion request again at handshake time (defense in depth). */
export function validateRealmPromotionRequest(request: RealmPromotionRequest): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (!isRealmRef(request.targetRealmObject.ref)) {
    findings.push({ code: 'realm_promotion_request_invalid', message: `Promotion ${request.id} has an invalid target Realm ref.`, pointers: [`realm-promotion:${request.id}`] });
  }
  if (!request.authority.trim()) {
    findings.push({ code: 'realm_promotion_request_invalid', message: `Promotion ${request.id} has no reviewing authority.`, pointers: [`realm-promotion:${request.id}`] });
  }
  for (const ref of request.sourceTruthRefs) {
    if (isRunStateRef(ref) || !isTruthRef(ref)) {
      findings.push({ code: 'realm_run_state_promotion_forbidden', message: `Promotion ${request.id} sources run/transcript/scratch ref "${ref}".`, pointers: [`realm-promotion:${request.id}`] });
    }
  }
  if (request.conflictStatus === 'realm_hard_truth_contradiction') {
    findings.push({ code: 'realm_import_conflict', message: `Promotion ${request.id} contradicts Realm hard truth; resolve before handshake.`, pointers: [`realm-promotion:${request.id}`] });
  }
  return findings;
}
