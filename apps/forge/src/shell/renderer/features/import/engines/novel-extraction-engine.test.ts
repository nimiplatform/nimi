import { describe, expect, it } from 'vitest';

import { extractChapter } from './novel-extraction-engine.js';
import { createAccumulator } from '../state/novel-accumulator.js';

describe('extractChapter', () => {
  it('canonicalizes stable rule keys from subjectKey and semanticSlot', async () => {
    const aiClient = {
      generateText: async () => ({
        text: JSON.stringify({
          worldRules: [{
            title: 'Archive City Political Structure',
            statement: 'Archive City is ruled by a council of curators.',
            domain: 'SOCIETY',
            category: 'DEFINITION',
            hardness: 'FIRM',
            scope: 'WORLD',
            subjectKey: 'archive-city',
            semanticSlot: 'political-structure',
          }],
          agentRules: [{
            characterName: 'Ari',
            title: 'Ari Greeting Style',
            statement: 'Ari greets people like old friends from the stacks.',
            layer: 'BEHAVIORAL',
            category: 'POLICY',
            hardness: 'SOFT',
            scope: 'DYAD',
            importance: 60,
            semanticSlot: 'greeting-style',
          }],
          newCharacters: [],
          contradictions: [],
          chapterSummary: 'Chapter summary',
        }),
      }),
    };

    const first = await extractChapter(aiClient as never, 0, 'Chapter 1', 'text', createAccumulator('novel.txt', 2));
    const second = await extractChapter(aiClient as never, 1, 'Chapter 2', 'text', createAccumulator('novel.txt', 2));

    expect(first.worldRules[0]?.ruleKey).toBe('society:archive-city:political-structure');
    expect(second.worldRules[0]?.ruleKey).toBe('society:archive-city:political-structure');
    expect(first.agentRules[0]?.rules[0]?.ruleKey).toBe('behavior:greeting-style');
    expect(second.agentRules[0]?.rules[0]?.ruleKey).toBe('behavior:greeting-style');
  });

  it('drops incomplete extraction items instead of synthesizing fallback values', async () => {
    const aiClient = {
      generateText: async () => ({
        text: JSON.stringify({
          worldRules: [
            {
              title: 'Valid World Rule',
              statement: 'The archive closes at moonrise.',
              domain: 'SOCIETY',
              category: 'POLICY',
              hardness: 'FIRM',
              scope: 'WORLD',
              subjectKey: 'archive',
              semanticSlot: 'closing-hours',
            },
            {
              statement: 'Missing title should be rejected.',
              domain: 'SOCIETY',
              category: 'POLICY',
              hardness: 'FIRM',
              scope: 'WORLD',
            },
          ],
          agentRules: [
            {
              characterName: 'Ari',
              title: 'Valid Agent Rule',
              statement: 'Ari catalogs every new visitor.',
              layer: 'BEHAVIORAL',
              category: 'DEFINITION',
              hardness: 'SOFT',
              scope: 'SELF',
              importance: 70,
              semanticSlot: 'cataloging-habit',
            },
            {
              characterName: 'Bex',
              title: 'Invalid Agent Rule',
              statement: 'Missing layer should be rejected.',
              category: 'DEFINITION',
              hardness: 'SOFT',
              scope: 'SELF',
              importance: 50,
            },
          ],
          newCharacters: [
            { name: 'Ari', aliases: ['Archivist'], description: 'Keeps the stacks in order.' },
            { aliases: ['Ghost'], description: 'Missing name should be rejected.' },
          ],
          contradictions: [
            {
              ruleKind: 'WORLD',
              ruleKey: 'society:archive:closing-hours',
              previousStatement: 'The archive closes at dusk.',
              newStatement: 'The archive closes at moonrise.',
              previousHardness: 'FIRM',
              newHardness: 'FIRM',
              reason: 'Updated curfew.',
            },
            {
              ruleKey: 'society:archive:missing-kind',
              previousStatement: 'Missing kind should be rejected.',
              newStatement: 'Still missing kind.',
              previousHardness: 'FIRM',
              newHardness: 'FIRM',
              reason: 'Invalid payload.',
            },
          ],
          chapterSummary: 'Chapter summary',
        }),
      }),
    };

    const result = await extractChapter(
      aiClient as never,
      0,
      'Chapter 1',
      'text',
      createAccumulator('novel.txt', 1),
    );

    expect(result.worldRules).toHaveLength(1);
    expect(result.worldRules[0]?.title).toBe('Valid World Rule');
    expect(result.agentRules).toHaveLength(1);
    expect(result.agentRules[0]?.characterName).toBe('Ari');
    expect(result.agentRules[0]?.rules).toHaveLength(1);
    expect(result.newCharacters).toHaveLength(1);
    expect(result.newCharacters[0]?.name).toBe('Ari');
    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0]?.ruleKind).toBe('WORLD');
  });
});
