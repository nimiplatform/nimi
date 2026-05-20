/**
 * RealmAgent creation draft → Realm write payload (T5-3 / D-EXPL-010).
 *
 * The single Realm truth write happens here, on explicit user confirm, via the
 * existing `dataSync.createAgent` → `CreatorService.creatorControllerCreateAgent`
 * path. There is no Realm-side draft entity: the draft is client-side only and
 * this module is the one place that turns a reviewed draft into Realm truth.
 *
 * `creatorControllerCreateAgent` only admits a subset of the D-EXPL-009 field
 * set. `scenario` / `greeting` / `wakeStrategy` / `visibility` are draft- and
 * review-level product fields with no current `CreateAgentDto` home; the review
 * surface shows exactly which fields become Realm truth so nothing is written
 * silently (D-EXPL-010 / D-EXPL-011).
 */

import type {
  RealmAgentCreationDraft,
  RealmAgentPrimaryTrait,
  RealmAgentSecondaryTrait,
} from './realm-agent-creation-draft.js';

/** Realm-write subset of the creation draft accepted by `CreateAgentDto`. */
export type RealmAgentWritePayload = {
  worldId: string;
  handle: string;
  concept: string;
  displayName?: string;
  description?: string;
  referenceImageUrl?: string;
  dnaPrimary?: Exclude<RealmAgentPrimaryTrait, ''>;
  dnaSecondary?: RealmAgentSecondaryTrait[];
};

/**
 * The exact set of draft fields that reach Realm truth on confirm. Used by the
 * review surface to tell the user what will be written.
 */
export const REALM_WRITTEN_DRAFT_FIELDS = [
  'handle',
  'displayName',
  'concept',
  'description',
  'avatar',
  'primaryTrait',
  'secondaryTraits',
] as const;

/**
 * Draft fields that are part of the D-EXPL-009 minimum set but are NOT written
 * by the current `creatorControllerCreateAgent` contract. The review surface
 * shows these as "kept in draft, not written" so there is no silent drop.
 */
export const REALM_UNWRITTEN_DRAFT_FIELDS = [
  'scenario',
  'greeting',
  'wakeStrategy',
  'visibility',
] as const;

export function buildRealmAgentWritePayload(
  draft: RealmAgentCreationDraft,
  resolvedReferenceImageUrl: string | undefined,
): RealmAgentWritePayload {
  const fields = draft.fields;
  return {
    worldId: draft.worldId,
    handle: fields.handle.trim(),
    concept: fields.concept.trim(),
    displayName: fields.displayName.trim() || undefined,
    description: fields.description.trim() || undefined,
    referenceImageUrl: resolvedReferenceImageUrl,
    dnaPrimary: fields.primaryTrait || undefined,
    dnaSecondary: fields.secondaryTraits.length ? fields.secondaryTraits : undefined,
  };
}
