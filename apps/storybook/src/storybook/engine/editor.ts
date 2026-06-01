// Studio editor + scoped regeneration (wave-12). Explicit, lineage-bearing edit
// operations over the app-owned truth package, with undo/redo and optimistic
// conflict detection. Every applied edit routes through `bumpVersion` (version++ and
// projections marked stale) so a projection is never silently fresh after an edit.
//
// Undo/redo is powered by package snapshots. Because all truth mutations are
// immutable (structural sharing), a prior package is just a reference — snapshots
// are cheap. The `operations` list is the human-readable lineage.
//
// Regeneration requests are scoped and validated: an unknown scope or a target that
// does not resolve in the project is `regeneration_scope_invalid` (fail-closed).

import { mintId } from './ids.js';
import { type Result, ok, fail } from './failure.js';
import { type StorybookTruthPackage, bumpVersion, collectKnownTruthRefs } from './truth.js';

export type EditTargetKind =
  | 'bible'
  | 'scenario-frame'
  | 'agent'
  | 'node-text'
  | 'choice'
  | 'asset'
  | 'rule'
  | 'branch-topology'
  | 'state-matrix';

export type EditOperationKind = 'update-text' | 'update-field' | 'add' | 'remove' | 'replace-asset';

export type EditOperation = {
  id: string;
  targetRef: string;
  targetKind: EditTargetKind;
  operation: EditOperationKind;
  /** target sub-value snapshots for human-readable lineage (not used for undo). */
  before: unknown;
  after: unknown;
  /** version the edit was authored against (optimistic concurrency). */
  baseVersion: number;
  note: string;
  at: string;
};

const MAX_HISTORY = 50;

export type EditLog = {
  projectId: string;
  operations: EditOperation[];
  /** package snapshots for undo (most recent last). */
  undoStack: StorybookTruthPackage[];
  redoStack: StorybookTruthPackage[];
};

export function createEditLog(projectId: string): EditLog {
  return { projectId, operations: [], undoStack: [], redoStack: [] };
}

export type EditInput = {
  targetRef: string;
  targetKind: EditTargetKind;
  operation: EditOperationKind;
  before: unknown;
  after: unknown;
  baseVersion: number;
  note: string;
};

/**
 * Apply an explicit edit. Fails closed with `edit_conflict` when the edit was
 * authored against a stale version. On success: runs the mutation, bumps version +
 * stales projections, records the operation in lineage, and pushes an undo snapshot.
 */
export function applyEdit(input: {
  pkg: StorybookTruthPackage;
  log: EditLog;
  edit: EditInput;
  mutate: (pkg: StorybookTruthPackage) => StorybookTruthPackage;
  now: string;
}): Result<{ pkg: StorybookTruthPackage; log: EditLog; operation: EditOperation }> {
  if (input.edit.baseVersion !== input.pkg.version) {
    return fail('edit_conflict', `Edit authored against version ${input.edit.baseVersion} but the package is at ${input.pkg.version}; reload before editing.`, [input.edit.targetRef]);
  }
  const mutated = bumpVersion(input.mutate(input.pkg), input.now);
  const operation: EditOperation = { ...input.edit, id: mintId('edit'), at: input.now };
  const log: EditLog = {
    ...input.log,
    operations: [...input.log.operations, operation],
    undoStack: [...input.log.undoStack, input.pkg].slice(-MAX_HISTORY),
    redoStack: [],
  };
  return ok({ pkg: mutated, log, operation });
}

export function canUndo(log: EditLog): boolean {
  return log.undoStack.length > 0;
}

export function canRedo(log: EditLog): boolean {
  return log.redoStack.length > 0;
}

/** Restore the previous package snapshot. No-op (returns current) when history is empty. */
export function undoEdit(log: EditLog, currentPkg: StorybookTruthPackage): { pkg: StorybookTruthPackage; log: EditLog } {
  if (log.undoStack.length === 0) return { pkg: currentPkg, log };
  const restored = log.undoStack[log.undoStack.length - 1] as StorybookTruthPackage;
  return {
    pkg: restored,
    log: { ...log, undoStack: log.undoStack.slice(0, -1), redoStack: [...log.redoStack, currentPkg].slice(-MAX_HISTORY) },
  };
}

/** Re-apply the most recently undone snapshot. No-op when the redo stack is empty. */
export function redoEdit(log: EditLog, currentPkg: StorybookTruthPackage): { pkg: StorybookTruthPackage; log: EditLog } {
  if (log.redoStack.length === 0) return { pkg: currentPkg, log };
  const restored = log.redoStack[log.redoStack.length - 1] as StorybookTruthPackage;
  return {
    pkg: restored,
    log: { ...log, redoStack: log.redoStack.slice(0, -1), undoStack: [...log.undoStack, currentPkg].slice(-MAX_HISTORY) },
  };
}

// --- scoped regeneration ---

export type RegenerationScope =
  | 'segment'
  | 'node'
  | 'asset'
  | 'scene'
  | 'chapter'
  | 'bible-slice'
  | 'agent-scene'
  | 'branch'
  | 'source-structure';

const ADMITTED_SCOPES: ReadonlySet<RegenerationScope> = new Set<RegenerationScope>([
  'segment', 'node', 'asset', 'scene', 'chapter', 'bible-slice', 'agent-scene', 'branch', 'source-structure',
]);

export type RegenerationStatus = 'queued' | 'executed' | 'failed' | 'deferred';

export type RegenerationRequest = {
  id: string;
  scope: RegenerationScope;
  targetRef: string;
  reason: string;
  /** feedback patches to apply during regeneration (app-internal refs). */
  feedbackPatchRefs: string[];
  /** evidence refs that must be preserved (or explicit divergence recorded). */
  preserveEvidenceRefs: string[];
  baseVersion: number;
  createdAt: string;
  /** Lifecycle: queued on creation; executed/failed/deferred after the workflow runs it. */
  status: RegenerationStatus;
  resolutionNote?: string;
  resolvedAt?: string;
};

function targetResolvesInProject(pkg: StorybookTruthPackage, targetRef: string): boolean {
  if (collectKnownTruthRefs(pkg).has(targetRef)) return true;
  for (const chapter of pkg.chapters) {
    if (chapter.id === targetRef || chapter.ref === targetRef) return true;
    if (chapter.nodes.some((node) => node.id === targetRef)) return true;
  }
  return pkg.assets.some((asset) => asset.id === targetRef || asset.ref === targetRef);
}

/**
 * Build a scoped regeneration request. Fails closed when the scope is not admitted
 * or the target does not resolve in the project (`regeneration_scope_invalid`).
 */
export function createRegenerationRequest(input: {
  pkg: StorybookTruthPackage;
  scope: RegenerationScope;
  targetRef: string;
  reason: string;
  feedbackPatchRefs?: string[];
  preserveEvidenceRefs?: string[];
  now: string;
}): Result<RegenerationRequest> {
  if (!ADMITTED_SCOPES.has(input.scope)) {
    return fail('regeneration_scope_invalid', `Regeneration scope "${input.scope}" is not admitted.`, ['scope']);
  }
  if (!targetResolvesInProject(input.pkg, input.targetRef)) {
    return fail('regeneration_scope_invalid', `Regeneration target "${input.targetRef}" does not resolve in the project.`, ['targetRef']);
  }
  return ok({
    id: mintId('regen'),
    scope: input.scope,
    targetRef: input.targetRef,
    reason: input.reason,
    feedbackPatchRefs: input.feedbackPatchRefs ?? [],
    preserveEvidenceRefs: input.preserveEvidenceRefs ?? [],
    baseVersion: input.pkg.version,
    createdAt: input.now,
    status: 'queued',
  });
}

/** Transition a queued regeneration request to a terminal/deferred status. */
export function markRegeneration(request: RegenerationRequest, status: RegenerationStatus, note: string, now: string): RegenerationRequest {
  return { ...request, status, resolutionNote: note, resolvedAt: now };
}
