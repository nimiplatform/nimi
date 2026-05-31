/**
 * RealmAgent creation draft model (T5-3 / D-EXPL-009 ~ D-EXPL-011).
 *
 * A creation draft is client-side state. It is NOT Realm truth: per D-EXPL-010
 * the Realm write happens only on explicit user confirm. The draft is locally
 * persisted (per-world) so a failed creation stays recoverable (D-EXPL-011).
 *
 * The draft carries the full D-EXPL-009 minimum field set for all three modes
 * (manual / Character Card import / AI-assisted generation). Import and
 * generation modes differ only in how the draft is populated; they never
 * bypass a required field.
 */

import {
  readStorageJsonFrom,
  removeStorageKeyFrom,
  resolveBrowserStorage,
  writeStorageJsonTo,
} from '@nimiplatform/kit/core/storage-json';

export type RealmAgentCreationMode =
  | 'manual_quick_create'
  | 'character_card_import'
  | 'ai_assisted_generation';

export type RealmAgentWakeStrategy = '' | 'PASSIVE' | 'PROACTIVE';

export type RealmAgentPrimaryTrait =
  | ''
  | 'CARING'
  | 'PLAYFUL'
  | 'INTELLECTUAL'
  | 'CONFIDENT'
  | 'MYSTERIOUS'
  | 'ROMANTIC';

export const REALM_AGENT_SECONDARY_TRAITS = [
  'HUMOROUS',
  'SARCASTIC',
  'GENTLE',
  'DIRECT',
  'OPTIMISTIC',
  'REALISTIC',
  'DRAMATIC',
  'PASSIONATE',
  'REBELLIOUS',
  'INNOCENT',
  'WISE',
  'ECCENTRIC',
] as const;

export type RealmAgentSecondaryTrait = (typeof REALM_AGENT_SECONDARY_TRAITS)[number];

/**
 * Visibility / publish posture (D-EXPL-009 `visibility` field). Draft-level
 * product posture surfaced in review; only `PUBLISHED` is admitted as an
 * actively discoverable RealmAgent, `UNLISTED` keeps it owner-private.
 */
export type RealmAgentVisibility = 'PUBLISHED' | 'UNLISTED';

/**
 * A draft-level warning attached to a single field. Per D-EXPL-011 invalid /
 * unsupported imported or generated values are surfaced as warnings and kept
 * in the draft; they are never silently written.
 */
export type RealmAgentDraftWarning = {
  /** Draft field the warning relates to, or `source` for whole-import notices. */
  field: keyof RealmAgentCreationDraftFields | 'source';
  message: string;
};

/**
 * The D-EXPL-009 minimum creation field set. `selectedWorld` is sourced from
 * the entry World-detail context and is not user-editable in the draft.
 */
export type RealmAgentCreationDraftFields = {
  handle: string;
  displayName: string;
  concept: string;
  description: string;
  scenario: string;
  greeting: string;
  /** Object URL preview for a locally selected avatar, or a resolved URL. */
  avatarPreviewUrl: string;
  wakeStrategy: RealmAgentWakeStrategy;
  primaryTrait: RealmAgentPrimaryTrait;
  secondaryTraits: RealmAgentSecondaryTrait[];
  visibility: RealmAgentVisibility;
};

export type RealmAgentCreationDraft = {
  /** Owning World id — D-EXPL-008: no RealmAgent creation without a World. */
  worldId: string;
  mode: RealmAgentCreationMode;
  fields: RealmAgentCreationDraftFields;
  /** Warnings produced by import / generation, surfaced in review. */
  warnings: RealmAgentDraftWarning[];
  /** Source label, e.g. the imported Character Card filename. */
  sourceLabel: string | null;
  updatedAt: number;
};

export function createEmptyDraftFields(): RealmAgentCreationDraftFields {
  return {
    handle: '',
    displayName: '',
    concept: '',
    description: '',
    scenario: '',
    greeting: '',
    avatarPreviewUrl: '',
    wakeStrategy: 'PASSIVE',
    primaryTrait: '',
    secondaryTraits: [],
    visibility: 'PUBLISHED',
  };
}

export function createEmptyDraft(
  worldId: string,
  mode: RealmAgentCreationMode = 'manual_quick_create',
): RealmAgentCreationDraft {
  return {
    worldId,
    mode,
    fields: createEmptyDraftFields(),
    warnings: [],
    sourceLabel: null,
    updatedAt: Date.now(),
  };
}

/**
 * Required fields for a submittable draft. `handle` and `concept` are the
 * Realm-required minimum (`CreateAgentDto`); the remaining D-EXPL-009 fields
 * are optional product fields.
 */
export function draftIsSubmittable(draft: RealmAgentCreationDraft): boolean {
  return (
    draft.fields.handle.trim().length > 0
    && draft.fields.concept.trim().length > 0
  );
}

const DRAFT_STORAGE_PREFIX = 'nimi.realm-agent-creation-draft.v1';
const MAX_PERSISTED_WARNINGS = 64;

function draftStorageKey(worldId: string): string {
  return `${DRAFT_STORAGE_PREFIX}.${worldId}`;
}

function isSecondaryTrait(value: unknown): value is RealmAgentSecondaryTrait {
  return typeof value === 'string'
    && (REALM_AGENT_SECONDARY_TRAITS as readonly string[]).includes(value);
}

function normalizeWakeStrategy(value: unknown): RealmAgentWakeStrategy {
  return value === 'PASSIVE' || value === 'PROACTIVE' ? value : 'PASSIVE';
}

function normalizePrimaryTrait(value: unknown): RealmAgentPrimaryTrait {
  return value === 'CARING'
    || value === 'PLAYFUL'
    || value === 'INTELLECTUAL'
    || value === 'CONFIDENT'
    || value === 'MYSTERIOUS'
    || value === 'ROMANTIC'
    ? value
    : '';
}

function normalizeVisibility(value: unknown): RealmAgentVisibility {
  return value === 'UNLISTED' ? 'UNLISTED' : 'PUBLISHED';
}

function normalizeMode(value: unknown): RealmAgentCreationMode {
  return value === 'character_card_import' || value === 'ai_assisted_generation'
    ? value
    : 'manual_quick_create';
}

/**
 * Persist the draft for failed-creation recoverability (D-EXPL-011).
 * The avatar preview URL is intentionally NOT persisted — object URLs do not
 * survive a reload — so a recovered draft simply has no avatar preview.
 */
export function persistDraft(draft: RealmAgentCreationDraft): void {
  if (!draft.worldId) {
    return;
  }
  const persisted: RealmAgentCreationDraft = {
    ...draft,
    fields: { ...draft.fields, avatarPreviewUrl: '' },
    warnings: draft.warnings.slice(0, MAX_PERSISTED_WARNINGS),
  };
  writeStorageJsonTo(resolveBrowserStorage('local'), draftStorageKey(draft.worldId), persisted);
}

export function loadPersistedDraft(worldId: string): RealmAgentCreationDraft | null {
  if (!worldId) {
    return null;
  }
  const result = readStorageJsonFrom<Record<string, unknown>>(resolveBrowserStorage('local'), draftStorageKey(worldId));
  if (result.state !== 'ready') {
    return null;
  }
  try {
    const parsed = result.value;
    const fields = (parsed.fields && typeof parsed.fields === 'object'
      ? parsed.fields
      : {}) as Record<string, unknown>;
    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings
          .filter((entry): entry is RealmAgentDraftWarning =>
            Boolean(entry) && typeof entry === 'object'
            && typeof (entry as RealmAgentDraftWarning).message === 'string')
          .slice(0, MAX_PERSISTED_WARNINGS)
      : [];
    const draft: RealmAgentCreationDraft = {
      worldId,
      mode: normalizeMode(parsed.mode),
      fields: {
        handle: String(fields.handle || ''),
        displayName: String(fields.displayName || ''),
        concept: String(fields.concept || ''),
        description: String(fields.description || ''),
        scenario: String(fields.scenario || ''),
        greeting: String(fields.greeting || ''),
        avatarPreviewUrl: '',
        wakeStrategy: normalizeWakeStrategy(fields.wakeStrategy),
        primaryTrait: normalizePrimaryTrait(fields.primaryTrait),
        secondaryTraits: Array.isArray(fields.secondaryTraits)
          ? (fields.secondaryTraits.filter(isSecondaryTrait) as RealmAgentSecondaryTrait[]).slice(0, 3)
          : [],
        visibility: normalizeVisibility(fields.visibility),
      },
      warnings,
      sourceLabel: typeof parsed.sourceLabel === 'string' ? parsed.sourceLabel : null,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };
    return draft;
  } catch {
    return null;
  }
}

/** True only when a persisted draft holds at least some authored content. */
export function persistedDraftHasContent(draft: RealmAgentCreationDraft | null): boolean {
  if (!draft) {
    return false;
  }
  const f = draft.fields;
  return Boolean(
    f.handle.trim()
    || f.displayName.trim()
    || f.concept.trim()
    || f.description.trim()
    || f.scenario.trim()
    || f.greeting.trim()
    || f.secondaryTraits.length
    || f.primaryTrait,
  );
}

export function clearPersistedDraft(worldId: string): void {
  if (!worldId) {
    return;
  }
  removeStorageKeyFrom(resolveBrowserStorage('local'), draftStorageKey(worldId));
}
