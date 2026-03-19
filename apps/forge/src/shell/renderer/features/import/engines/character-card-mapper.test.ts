import { describe, expect, it } from 'vitest';

import { createCharacterBookManifestEntries } from './character-card-source-manifest.js';
import {
  mapCharacterCardToAgentRules,
  mapCharacterCardToWorldRules,
} from './character-card-mapper.js';
import { mapManifestCharacterBookEntriesToRules } from './character-book-mapper.js';
import type { TavernCardV2 } from '../types.js';

const CARD: TavernCardV2 = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Ari',
    description: 'A time-traveling archivist.',
    personality: 'Precise and warm.',
    scenario: 'The archive-city floats over a broken sea.',
    first_mes: 'Welcome back to the stacks.',
    mes_example: '',
    creator_notes: 'Internal only',
    system_prompt: 'Stay in character.',
    post_history_instructions: 'Keep continuity.',
    alternate_greetings: ['The archive doors are open.'],
    tags: ['floating-city', 'archivepunk'],
    creator: 'nimi',
    character_version: '1.2',
    extensions: {},
    character_book: {
      extensions: {},
      entries: [
        {
          keys: ['Archive City'],
          content: 'Archive City floats above the sea.',
          extensions: {},
          enabled: true,
          insertion_order: 0,
          constant: true,
          name: 'Archive City',
        },
      ],
    },
  },
};

describe('character card mapping', () => {
  it('maps weak world seeds from scenario, tags, and world-classified lorebook entries', () => {
    const worldRules = mapCharacterCardToWorldRules(CARD, 'ari.json');
    const manifestEntries = createCharacterBookManifestEntries(
      CARD.data.character_book,
      [{
        entryIndex: 0,
        entryName: 'Archive City',
        type: 'world',
        domain: 'SOCIETY',
        reasoning: 'Location and world structure.',
      }],
      'user_override',
    );
    const bookRules = mapManifestCharacterBookEntriesToRules(manifestEntries, CARD.data.name, 'ari.json');

    expect(worldRules.map((rule) => rule.ruleKey)).toContain('narrative:seed:scenario');
    expect(worldRules.map((rule) => rule.ruleKey)).toContain('meta:seed:source-tags');
    expect(worldRules.every((rule) => rule.structured?.weakWorldSeed)).toBe(true);
    expect(bookRules.worldRules[0]?.provenance).toBe('SEED');
    expect(bookRules.worldRules[0]?.structured?.weakWorldSeed).toBe(true);
  });

  it('keeps runtime persona fields as agent rules instead of world truth', () => {
    const agentRules = mapCharacterCardToAgentRules(CARD, 'ari.json');

    expect(agentRules.some((rule) => rule.ruleKey === 'identity:self:system_directive')).toBe(true);
    expect(agentRules.some((rule) => rule.ruleKey === 'behavior:directive:post_history')).toBe(true);
    expect(agentRules.some((rule) => rule.ruleKey === 'relational:world:scenario')).toBe(false);
  });
});
