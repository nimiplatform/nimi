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
});
