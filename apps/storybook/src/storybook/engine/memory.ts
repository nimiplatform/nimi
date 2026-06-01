// App-internal, project-scoped memory. Feedback, corrections, transcripts,
// preference weights, run state, and promotion records improve FUTURE Storybook
// generation inside the project/app only. They do NOT mutate model weights,
// Runtime agent memory, Realm world state, or any shared Nimi ecosystem memory.
//
// This module is deliberately self-contained: it has no Runtime/Realm imports and
// exposes no surface that could write outside the app. That boundary is part of
// the contract (see storybook-memory-boundary test).

import { type TruthRef, isTruthRef, mintId } from './ids.js';
import { type Result, ok, fail } from './failure.js';
import { type StorybookTruthPackage, collectKnownTruthRefs } from './truth.js';
import { type PromotionDecision, type PromotionCandidate } from './promotion.js';

export type FeedbackPatchKind = 'correction' | 'preference' | 'example';

export type FeedbackPatch = {
  id: string;
  projectId: string;
  /** Optional truth ref this patch is about; validated against the package. */
  targetRef: TruthRef | null;
  kind: FeedbackPatchKind;
  note: string;
  /** Relative weight used to bias future generation within the project. */
  weight: number;
  createdAt: string;
};

/** The memory scope marker is a literal — it can never reference an external owner. */
export const STORYBOOK_MEMORY_SCOPE = 'app-internal-project-scoped' as const;

export type ProjectMemory = {
  scope: typeof STORYBOOK_MEMORY_SCOPE;
  projectId: string;
  feedbackPatches: FeedbackPatch[];
  /** Aggregated preference weights keyed by tag/target. */
  preferenceWeights: Record<string, number>;
  /** App-local refs only (transcript ids, promotion decision ids). */
  transcriptRefs: string[];
  promotionRecordRefs: string[];
};

export function createProjectMemory(projectId: string): ProjectMemory {
  return {
    scope: STORYBOOK_MEMORY_SCOPE,
    projectId,
    feedbackPatches: [],
    preferenceWeights: {},
    transcriptRefs: [],
    promotionRecordRefs: [],
  };
}

export function validateFeedbackPatch(patch: Pick<FeedbackPatch, 'targetRef'>, pkg: StorybookTruthPackage): Result<true> {
  if (patch.targetRef === null) return ok(true);
  if (!isTruthRef(patch.targetRef)) {
    return fail('feedback_patch_target_invalid', `Feedback patch target "${patch.targetRef}" is not a truth ref.`);
  }
  if (!collectKnownTruthRefs(pkg).has(patch.targetRef)) {
    return fail('feedback_patch_target_invalid', `Feedback patch target "${patch.targetRef}" does not resolve in the project's truth package.`);
  }
  return ok(true);
}

/** Add a feedback patch (app-internal). Target validity is enforced fail-closed. */
export function addFeedbackPatch(
  memory: ProjectMemory,
  input: { targetRef: TruthRef | null; kind: FeedbackPatchKind; note: string; weight?: number; now: string },
  pkg: StorybookTruthPackage,
): Result<ProjectMemory> {
  const valid = validateFeedbackPatch({ targetRef: input.targetRef }, pkg);
  if (!valid.ok) return valid;
  const patch: FeedbackPatch = {
    id: mintId('fbpatch'),
    projectId: memory.projectId,
    targetRef: input.targetRef,
    kind: input.kind,
    note: input.note,
    weight: input.weight ?? 1,
    createdAt: input.now,
  };
  const preferenceWeights = { ...memory.preferenceWeights };
  if (patch.kind === 'preference') {
    const key = patch.targetRef ?? 'global';
    preferenceWeights[key] = (preferenceWeights[key] ?? 0) + patch.weight;
  }
  return ok({ ...memory, feedbackPatches: [...memory.feedbackPatches, patch], preferenceWeights });
}

export function recordTranscriptRef(memory: ProjectMemory, transcriptRef: string): ProjectMemory {
  if (memory.transcriptRefs.includes(transcriptRef)) return memory;
  return { ...memory, transcriptRefs: [...memory.transcriptRefs, transcriptRef] };
}

export function recordPromotionRef(memory: ProjectMemory, promotionRef: string): ProjectMemory {
  if (memory.promotionRecordRefs.includes(promotionRef)) return memory;
  return { ...memory, promotionRecordRefs: [...memory.promotionRecordRefs, promotionRef] };
}

/**
 * Wire an accepted promotion into app-internal project memory: always record the
 * decision ref; for an accepted `add-feedback` promotion, materialize a feedback
 * patch (app-internal, project-scoped). This is the run -> memory path: it stays
 * inside the app and never touches Runtime/Realm/ecosystem memory. session_only and
 * reject decisions record the ref but materialize nothing.
 */
export function recordAcceptedPromotion(
  memory: ProjectMemory,
  input: { decision: PromotionDecision; candidate: PromotionCandidate; note?: string; now: string },
  pkg: StorybookTruthPackage,
): Result<ProjectMemory> {
  let next = recordPromotionRef(memory, input.decision.id);
  // Only a committed acceptance materializes truth-adjacent memory. needs_review,
  // reject, and session_only record the ref but materialize nothing.
  const accepted = input.decision.decision === 'auto_accept';
  if (accepted && input.candidate.mutationType === 'add-feedback') {
    const added = addFeedbackPatch(
      next,
      { targetRef: input.candidate.targetTruthRef, kind: 'preference', note: input.note ?? input.decision.reason, now: input.now },
      pkg,
    );
    if (!added.ok) return added;
    next = added.value;
  }
  return ok(next);
}
