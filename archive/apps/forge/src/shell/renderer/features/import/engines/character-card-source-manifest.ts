import type {
  CharacterBook,
  CharacterBookManifestEntry,
  CharacterCardSourceManifest,
  LorebookClassification,
  TavernCardV2,
} from '../types.js';

const KNOWN_ROOT_FIELDS = new Set(['spec', 'spec_version', 'data']);
const KNOWN_DATA_FIELDS = new Set([
  'name',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
  'creator_notes',
  'system_prompt',
  'post_history_instructions',
  'alternate_greetings',
  'character_book',
  'tags',
  'creator',
  'character_version',
  'extensions',
]);

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function pickUnknownFields(
  source: Record<string, unknown>,
  knownFields: Set<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => !knownFields.has(key)),
  );
}

function getEntryName(book: CharacterBook | undefined, entryIndex: number): string {
  const entry = book?.entries[entryIndex];
  if (!entry) {
    return `entry_${entryIndex}`;
  }
  return entry.name?.trim() || entry.keys[0]?.trim() || `entry_${entryIndex}`;
}

export function createFallbackClassifications(
  book: CharacterBook | undefined,
): LorebookClassification[] {
  if (!book) {
    return [];
  }
  return book.entries.map((entry, entryIndex) => ({
    entryIndex,
    entryName: getEntryName(book, entryIndex),
    type: 'agent',
    domain: undefined,
    reasoning: entry.constant
      ? 'Fallback classification kept as agent lore to avoid strong world assumptions.'
      : 'Fallback classification defaulted to agent lore because no trusted world classification was available.',
  }));
}

export function createCharacterBookManifestEntries(
  book: CharacterBook | undefined,
  classifications: LorebookClassification[],
  classificationSource: CharacterBookManifestEntry['classificationSource'],
): CharacterBookManifestEntry[] {
  if (!book) {
    return [];
  }

  const classificationByIndex = new Map(
    classifications.map((classification) => [classification.entryIndex, classification]),
  );

  return book.entries.map((entry, entryIndex) => {
    const entryName = getEntryName(book, entryIndex);
    const classification = classificationByIndex.get(entryIndex) ?? {
      entryIndex,
      entryName,
      type: 'agent' as const,
      domain: undefined,
      reasoning: 'No classification available.',
    };

    return {
      entryIndex,
      entryName,
      entry,
      classification,
      classificationSource,
    };
  });
}

export function createCharacterCardSourceManifest(params: {
  sourceFile: string;
  rawJson: string;
  rawCard: Record<string, unknown>;
  normalizedCard: TavernCardV2;
  characterBookEntries?: CharacterBookManifestEntry[];
}): CharacterCardSourceManifest {
  const { sourceFile, rawJson, rawCard, normalizedCard } = params;
  const rawData = toRecord(rawCard.data);
  const rawCharacterBook = toRecord(rawData.character_book);

  return {
    sourceType: 'character_card',
    sourceFile,
    importedAt: new Date().toISOString(),
    rawJson,
    rawCard,
    normalizedCard,
    unknownRootFields: pickUnknownFields(rawCard, KNOWN_ROOT_FIELDS),
    unknownDataFields: pickUnknownFields(rawData, KNOWN_DATA_FIELDS),
    cardExtensions: toRecord(rawData.extensions),
    characterBookExtensions: toRecord(rawCharacterBook.extensions),
    characterBookEntries: params.characterBookEntries ?? [],
  };
}
