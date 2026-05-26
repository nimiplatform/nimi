import { describe, expect, it } from 'vitest';

import { parseCharacterCardV2 } from './character-card-parser.js';

const VALID_CARD_JSON = JSON.stringify({
  spec: 'chara_card_v2',
  spec_version: '2.0',
  extra_root: 'keep-me',
  data: {
    name: 'Ari',
    description: 'A time-traveling archivist.',
    personality: 'Precise and warm.',
    scenario: 'The archive-city floats over a broken sea.',
    first_mes: 'Welcome back to the stacks.',
    mes_example: 'Ari adjusts her glasses.',
    creator_notes: 'Optimized for long-form RP.',
    system_prompt: 'Stay in character.',
    post_history_instructions: 'Keep continuity with prior turns.',
    alternate_greetings: ['The archive doors are open.'],
    tags: ['floating-city', 'archivepunk'],
    creator: 'nimi',
    character_version: '1.2',
    extensions: { 'vendor/theme': 'copper' },
    unused_data_field: 'keep-me-too',
  },
});

describe('parseCharacterCardV2', () => {
  it('parses valid V2 JSON and preserves raw card payload', () => {
    const result = parseCharacterCardV2(VALID_CARD_JSON);

    expect(result.validation.valid).toBe(true);
    expect(result.card?.data.name).toBe('Ari');
    expect(result.card?.data.extensions).toEqual({ 'vendor/theme': 'copper' });
    expect(result.rawCard?.extra_root).toBe('keep-me');
    expect((result.rawCard?.data as Record<string, unknown>)?.unused_data_field).toBe('keep-me-too');
  });

  it('rejects cards without spec as unsupported V1 input', () => {
    const result = parseCharacterCardV2(JSON.stringify({
      name: 'Old Card',
      description: 'Legacy',
      personality: 'Legacy',
      first_mes: 'Legacy',
    }));

    expect(result.card).toBeNull();
    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors[0]).toContain('V1');
  });
});
