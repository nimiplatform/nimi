/**
 * Character Card V2 JSON Parser & Validator
 *
 * Parses and validates Character Card V2 JSON files per
 * https://github.com/malfoyslastname/character-card-spec-v2
 */

import type { TavernCardV2, ValidationResult } from '../types.js';

export function validateCharacterCardV2(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Input is not a valid JSON object'], warnings };
  }

  const obj = raw as Record<string, unknown>;

  // Check for V1 format (no spec field)
  if (!('spec' in obj)) {
    errors.push('Missing "spec" field. Only Character Card V2 format is supported. This appears to be a V1 card.');
    return { valid: false, errors, warnings };
  }

  if (obj.spec !== 'chara_card_v2') {
    errors.push(`Invalid spec: expected "chara_card_v2", got "${String(obj.spec)}"`);
  }

  if (obj.spec_version !== '2.0') {
    warnings.push(`Expected spec_version "2.0", got "${String(obj.spec_version ?? 'undefined')}". Proceeding with best-effort parsing.`);
  }

  if (!obj.data || typeof obj.data !== 'object') {
    errors.push('Missing or invalid "data" object');
    return { valid: false, errors, warnings };
  }

  const data = obj.data as Record<string, unknown>;

  // Required string fields
  const requiredStrings = ['name', 'description', 'personality', 'first_mes'] as const;
  for (const field of requiredStrings) {
    if (typeof data[field] !== 'string') {
      errors.push(`Missing or invalid data.${field} (expected string)`);
    } else if (!String(data[field]).trim()) {
      warnings.push(`data.${field} is empty`);
    }
  }

  // Optional string fields (warn if missing, don't error)
  const optionalStrings = [
    'scenario', 'mes_example', 'creator_notes', 'system_prompt',
    'post_history_instructions', 'creator', 'character_version',
  ] as const;
  for (const field of optionalStrings) {
    if (field in data && typeof data[field] !== 'string') {
      warnings.push(`data.${field} should be a string, got ${typeof data[field]}`);
    }
  }

  // alternate_greetings
  if ('alternate_greetings' in data) {
    if (!Array.isArray(data.alternate_greetings)) {
      warnings.push('data.alternate_greetings should be an array');
    }
  }

  // tags
  if ('tags' in data) {
    if (!Array.isArray(data.tags)) {
      warnings.push('data.tags should be an array');
    }
  }

  // character_book validation
  if ('character_book' in data && data.character_book != null) {
    const book = data.character_book as Record<string, unknown>;
    if (!Array.isArray(book.entries)) {
      warnings.push('data.character_book.entries should be an array');
    } else {
      const entryCount = book.entries.length;
      if (entryCount > 500) {
        warnings.push(`CharacterBook has ${entryCount} entries (>500). This may exceed token budgets during LLM classification.`);
      }
      for (let i = 0; i < entryCount; i++) {
        const entry = book.entries[i] as Record<string, unknown>;
        if (!entry || typeof entry !== 'object') {
          warnings.push(`character_book.entries[${i}] is not a valid object`);
          continue;
        }
        if (!Array.isArray(entry.keys)) {
          warnings.push(`character_book.entries[${i}].keys should be an array`);
        }
        if (typeof entry.content !== 'string') {
          warnings.push(`character_book.entries[${i}].content should be a string`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function parseCharacterCardV2(jsonString: string): {
  card: TavernCardV2 | null;
  rawCard: Record<string, unknown> | null;
  validation: ValidationResult;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return {
      card: null,
      rawCard: null,
      validation: {
        valid: false,
        errors: ['Invalid JSON: failed to parse input'],
        warnings: [],
      },
    };
  }

  const validation = validateCharacterCardV2(parsed);
  if (!validation.valid) {
    return {
      card: null,
      rawCard: parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null,
      validation,
    };
  }

  // Normalize the card structure with safe defaults
  const raw = parsed as Record<string, unknown>;
  const data = raw.data as Record<string, unknown>;

  const card: TavernCardV2 = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: String(data.name || ''),
      description: String(data.description || ''),
      personality: String(data.personality || ''),
      scenario: String(data.scenario || ''),
      first_mes: String(data.first_mes || ''),
      mes_example: String(data.mes_example || ''),
      creator_notes: String(data.creator_notes || ''),
      system_prompt: String(data.system_prompt || ''),
      post_history_instructions: String(data.post_history_instructions || ''),
      alternate_greetings: Array.isArray(data.alternate_greetings)
        ? data.alternate_greetings.map((g) => String(g || ''))
        : [],
      character_book: normalizeCharacterBook(data.character_book),
      tags: Array.isArray(data.tags)
        ? data.tags.map((t) => String(t || ''))
        : [],
      creator: String(data.creator || ''),
      character_version: String(data.character_version || ''),
      extensions: data.extensions && typeof data.extensions === 'object'
        ? data.extensions as Record<string, unknown>
        : {},
    },
  };

  return { card, rawCard: raw, validation };
}

function normalizeCharacterBook(raw: unknown): TavernCardV2['data']['character_book'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const book = raw as Record<string, unknown>;
  if (!Array.isArray(book.entries)) return undefined;

  return {
    name: book.name != null ? String(book.name) : undefined,
    description: book.description != null ? String(book.description) : undefined,
    scan_depth: typeof book.scan_depth === 'number' ? book.scan_depth : undefined,
    token_budget: typeof book.token_budget === 'number' ? book.token_budget : undefined,
    recursive_scanning: typeof book.recursive_scanning === 'boolean' ? book.recursive_scanning : undefined,
    extensions: book.extensions && typeof book.extensions === 'object'
      ? book.extensions as Record<string, unknown>
      : {},
    entries: book.entries.map((rawEntry) => {
      const entry = (rawEntry && typeof rawEntry === 'object' ? rawEntry : {}) as Record<string, unknown>;
      return {
        keys: Array.isArray(entry.keys) ? entry.keys.map((k) => String(k || '')) : [],
        content: String(entry.content || ''),
        extensions: entry.extensions && typeof entry.extensions === 'object'
          ? entry.extensions as Record<string, unknown>
          : {},
        enabled: entry.enabled !== false,
        insertion_order: typeof entry.insertion_order === 'number' ? entry.insertion_order : 0,
        case_sensitive: typeof entry.case_sensitive === 'boolean' ? entry.case_sensitive : undefined,
        name: entry.name != null ? String(entry.name) : undefined,
        priority: typeof entry.priority === 'number' ? entry.priority : undefined,
        id: typeof entry.id === 'number' ? entry.id : undefined,
        comment: entry.comment != null ? String(entry.comment) : undefined,
        selective: typeof entry.selective === 'boolean' ? entry.selective : undefined,
        secondary_keys: Array.isArray(entry.secondary_keys)
          ? entry.secondary_keys.map((k) => String(k || ''))
          : undefined,
        constant: typeof entry.constant === 'boolean' ? entry.constant : undefined,
        position: entry.position != null ? String(entry.position) : undefined,
      };
    }),
  };
}
