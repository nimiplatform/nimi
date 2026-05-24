/**
 * Character Card V2 → RealmAgent creation draft mapper (T5-3).
 *
 * The Character Card V2 parse + validation is the admitted shared kit surface
 * `@nimiplatform/kit/core/character-card` — the same parser Forge's heavy
 * import workbench uses. This module is the lightweight-creation projection:
 * it maps a parsed card onto the flat D-EXPL-009 creation field set rather than
 * Forge's rich 4-layer AgentRule structure.
 *
 * Per D-EXPL-010 the result is a draft, never Realm truth. Per D-EXPL-011
 * card fields that have no creation-field home are surfaced as warnings and
 * kept visible in review; they are never silently written.
 */

import {
  parseCharacterCardV2,
  type TavernCardV2,
} from '@nimiplatform/kit/core/character-card';
import {
  createEmptyDraft,
  type RealmAgentCreationDraft,
  type RealmAgentDraftWarning,
} from './realm-agent-creation-draft.js';

const MAX_CHARACTER_CARD_SIZE_BYTES = 2_000_000;

/** A handle must be a short, lowercased, underscore-joined token. */
function deriveHandleFromName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return normalized;
}

export type CharacterCardImportOutcome =
  | {
      ok: true;
      draft: RealmAgentCreationDraft;
    }
  | {
      ok: false;
      /** Fatal parse / validation errors — no draft could be produced. */
      errors: string[];
    };

/**
 * Map a parsed, validated card onto a creation draft. Warnings are carried
 * into the draft for review-time display (D-EXPL-011).
 */
export function mapCharacterCardToDraft(
  worldId: string,
  card: TavernCardV2,
  sourceFilename: string,
  parseWarnings: string[],
): RealmAgentCreationDraft {
  const draft = createEmptyDraft(worldId, 'character_card_import');
  const { data } = card;
  const warnings: RealmAgentDraftWarning[] = [];

  const name = data.name.trim();
  draft.fields.displayName = name;
  draft.fields.handle = deriveHandleFromName(name);
  if (name && !draft.fields.handle) {
    warnings.push({
      field: 'handle',
      message: `Could not derive a handle from "${name}" — set one before submitting.`,
    });
  }

  // `concept` has no direct V2 field; the card description is the closest
  // creation-field home. `personality` enriches `description`.
  draft.fields.concept = data.description.trim();
  draft.fields.description = [data.description.trim(), data.personality.trim()]
    .filter(Boolean)
    .join('\n\n');
  draft.fields.scenario = data.scenario.trim();
  draft.fields.greeting = data.first_mes.trim();

  // Card fields with no lightweight-creation home — surfaced, never written.
  if (data.alternate_greetings.length > 0) {
    warnings.push({
      field: 'greeting',
      message: `Card has ${data.alternate_greetings.length} alternate greeting(s); lightweight creation keeps only the primary greeting.`,
    });
  }
  if (data.mes_example.trim()) {
    warnings.push({
      field: 'source',
      message: 'Card dialogue examples (mes_example) are not part of the minimum creation fields and were not imported.',
    });
  }
  if (data.system_prompt.trim() || data.post_history_instructions.trim()) {
    warnings.push({
      field: 'source',
      message: 'Card system_prompt / post_history_instructions are not part of lightweight creation; use Forge to author rule-level directives.',
    });
  }
  if (data.character_book?.entries.length) {
    warnings.push({
      field: 'source',
      message: `Card CharacterBook (${data.character_book.entries.length} lore entr(y/ies)) is not imported by lightweight creation; use Forge for lorebook import.`,
    });
  }
  if (data.tags.length > 0) {
    warnings.push({
      field: 'source',
      message: `Card tags (${data.tags.join(', ')}) are not a creation field and were not imported.`,
    });
  }

  // Parser-level warnings (empty required fields, spec_version drift, etc.).
  for (const message of parseWarnings) {
    warnings.push({ field: 'source', message });
  }

  draft.warnings = warnings;
  draft.sourceLabel = sourceFilename;
  draft.updatedAt = Date.now();
  return draft;
}

/**
 * Load a Character Card file LOCALLY (D-EXPL-008: Nimi parses it locally),
 * parse with the shared kit parser, and map onto a creation draft.
 *
 * Returns a fail-closed outcome: a fatal parse/validation error yields no
 * draft (`ok: false`); non-fatal issues become draft warnings.
 */
export async function importCharacterCardFile(
  worldId: string,
  file: File,
): Promise<CharacterCardImportOutcome> {
  if (file.size > MAX_CHARACTER_CARD_SIZE_BYTES) {
    return {
      ok: false,
      errors: [`Character Card file exceeds ${MAX_CHARACTER_CARD_SIZE_BYTES.toLocaleString()} bytes.`],
    };
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, errors: ['Could not read the selected file.'] };
  }

  const { card, validation } = parseCharacterCardV2(text);
  if (!card) {
    return {
      ok: false,
      errors: validation.errors.length > 0
        ? validation.errors
        : ['The file is not a valid Character Card V2 document.'],
    };
  }

  return {
    ok: true,
    draft: mapCharacterCardToDraft(worldId, card, file.name, validation.warnings),
  };
}
