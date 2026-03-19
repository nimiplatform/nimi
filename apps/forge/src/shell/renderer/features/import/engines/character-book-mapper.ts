/**
 * CharacterBook → WorldRule[] / AgentRule[] Mapper
 *
 * Uses LLM-assisted classification to determine whether each lorebook
 * entry is a WorldRule or AgentRule, then maps accordingly.
 */

import type {
  CharacterBook,
  CharacterBookEntry,
  CharacterBookManifestEntry,
  LocalWorldRuleDraft,
  LocalAgentRuleDraft,
  LorebookClassification,
  WorldRuleDomain,
} from '../types.js';

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 64);
}

function getEntryName(entry: CharacterBookEntry, index: number): string {
  if (entry.name?.trim()) return entry.name.trim();
  if (entry.keys.length > 0 && entry.keys[0]?.trim()) return entry.keys[0].trim();
  return `entry_${index}`;
}

export function buildClassificationPrompt(
  characterName: string,
  entries: Array<{ index: number; name: string; content: string }>,
): string {
  const entriesJson = JSON.stringify(
    entries.map((e) => ({ entryIndex: e.index, name: e.name, content: e.content })),
    null,
    2,
  );

  return `Given character "${characterName}", classify each lorebook entry as either:
- "world": a fact about the world (locations, factions, history, laws, species, magic systems)
- "agent": a fact specific to this character (personal knowledge, memories, relationships, abilities)

Also assign a domain for world entries: AXIOM | PHYSICS | SOCIETY | ECONOMY | CHARACTER | NARRATIVE | META

Domain guide:
- AXIOM: fundamental laws (time, space, causality, magic systems)
- PHYSICS: natural laws of the world
- SOCIETY: social structures, languages, customs, organizations
- ECONOMY: resources, trade, currency
- CHARACTER: species, races, existence types
- NARRATIVE: plot hooks, narrative elements
- META: visual style, glossary

Entries:
${entriesJson}

Output ONLY a valid JSON array of objects, each with:
{ "entryIndex": number, "entryName": string, "type": "world" | "agent", "domain": string | null, "reasoning": string }`;
}

export function parseClassificationResponse(
  response: string,
): LorebookClassification[] {
  // Extract JSON array from response (handle markdown code blocks)
  const cleaned = response
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();

  const startIdx = cleaned.indexOf('[');
  const endIdx = cleaned.lastIndexOf(']');
  if (startIdx === -1 || endIdx === -1) return [];

  try {
    const parsed = JSON.parse(cleaned.slice(startIdx, endIdx + 1));
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item): item is Record<string, unknown> =>
        item && typeof item === 'object' && !Array.isArray(item),
      )
      .map((item) => ({
        entryIndex: Number.isInteger(item.entryIndex) ? Number(item.entryIndex) : -1,
        entryName: String(item.entryName || ''),
        type: item.type === 'world' ? 'world' : 'agent',
        domain: isValidDomain(String(item.domain || ''))
          ? (String(item.domain) as WorldRuleDomain)
          : undefined,
        reasoning: String(item.reasoning || ''),
      }));
  } catch {
    return [];
  }
}

function isValidDomain(value: string): boolean {
  return ['AXIOM', 'PHYSICS', 'SOCIETY', 'ECONOMY', 'CHARACTER', 'NARRATIVE', 'META'].includes(value);
}

export function mapClassifiedEntriesToRules(
  book: CharacterBook,
  characterName: string,
  classifications: LorebookClassification[],
  sourceFilename: string,
): {
  worldRules: LocalWorldRuleDraft[];
  agentRules: LocalAgentRuleDraft[];
} {
  const classMap = new Map(classifications.map((c) => [c.entryName, c]));
  const classByIndex = new Map(classifications.map((c) => [c.entryIndex, c]));
  const worldRules: LocalWorldRuleDraft[] = [];
  const agentRules: LocalAgentRuleDraft[] = [];
  const sourceRef = `chara_card_v2:${sourceFilename}:character_book`;

  for (let i = 0; i < book.entries.length; i++) {
    const entry = book.entries[i];
    if (!entry) {
      continue;
    }
    const entryName = getEntryName(entry, i);
    const sanitized = sanitizeName(entryName);
    const classification = classByIndex.get(i) ?? classMap.get(entryName);
    const isWorld = classification?.type === 'world';

    if (isWorld) {
      worldRules.push(mapEntryToWorldRule(entry, entryName, sanitized, classification, sourceRef));
    } else {
      agentRules.push(mapEntryToAgentRule(entry, entryName, sanitized, characterName, sourceRef));
    }
  }

  return { worldRules, agentRules };
}

function mapEntryToWorldRule(
  entry: CharacterBookEntry,
  entryName: string,
  sanitizedName: string,
  classification: LorebookClassification | undefined,
  sourceRef: string,
): LocalWorldRuleDraft {
  return {
    ruleKey: `lore:${sanitizedName}`,
    title: entryName,
    statement: entry.content,
    domain: classification?.domain ?? 'SOCIETY',
    category: 'DEFINITION',
    hardness: entry.constant ? 'FIRM' : 'SOFT',
    scope: 'WORLD',
    provenance: 'SEED',
    priority: entry.priority ?? 100,
    sourceRef,
    reasoning: classification?.reasoning ?? 'Classified from CharacterBook entry',
    structured: {
      keywords: entry.keys,
      constant: entry.constant ?? false,
      selective: entry.selective ?? false,
      secondaryKeys: entry.secondary_keys ?? [],
      insertionOrder: entry.insertion_order,
      originalEnabled: entry.enabled,
      weakWorldSeed: true,
    },
  };
}

function mapEntryToAgentRule(
  entry: CharacterBookEntry,
  entryName: string,
  sanitizedName: string,
  characterName: string,
  sourceRef: string,
): LocalAgentRuleDraft {
  return {
    ruleKey: `knowledge:lore:${sanitizedName}`,
    title: `${characterName} — ${entryName}`,
    statement: entry.content,
    layer: 'CONTEXTUAL',
    category: 'DEFINITION',
    hardness: entry.constant ? 'FIRM' : 'SOFT',
    scope: 'SELF',
    importance: entry.priority != null ? Math.min(entry.priority, 100) : 50,
    provenance: 'CREATOR',
    sourceRef,
    reasoning: 'Character-specific lorebook entry',
    priority: entry.priority ?? 100,
    structured: {
      keywords: entry.keys,
      constant: entry.constant ?? false,
      selective: entry.selective ?? false,
      secondaryKeys: entry.secondary_keys ?? [],
      insertionOrder: entry.insertion_order,
      originalEnabled: entry.enabled,
    },
  };
}

/**
 * Convenience: map an entire CharacterBook without LLM classification.
 * All entries default to AgentRule. Use this as a fallback when
 * the LLM classification is unavailable.
 */
export function mapCharacterBookFallback(
  book: CharacterBook,
  characterName: string,
  sourceFilename: string,
): {
  worldRules: LocalWorldRuleDraft[];
  agentRules: LocalAgentRuleDraft[];
} {
  const emptyClassifications: LorebookClassification[] = [];
  return mapClassifiedEntriesToRules(book, characterName, emptyClassifications, sourceFilename);
}

export function mapManifestCharacterBookEntriesToRules(
  entries: CharacterBookManifestEntry[],
  characterName: string,
  sourceFilename: string,
): {
  worldRules: LocalWorldRuleDraft[];
  agentRules: LocalAgentRuleDraft[];
} {
  const worldRules: LocalWorldRuleDraft[] = [];
  const agentRules: LocalAgentRuleDraft[] = [];
  const sourceRef = `chara_card_v2:${sourceFilename}:character_book`;

  for (const item of entries) {
    if (!item.entry.enabled) {
      continue;
    }
    const sanitized = sanitizeName(item.entryName);
    if (item.classification.type === 'world') {
      worldRules.push(
        mapEntryToWorldRule(
          item.entry,
          item.entryName,
          sanitized,
          item.classification,
          sourceRef,
        ),
      );
      continue;
    }
    agentRules.push(
      mapEntryToAgentRule(
        item.entry,
        item.entryName,
        sanitized,
        characterName,
        sourceRef,
      ),
    );
  }

  return { worldRules, agentRules };
}
