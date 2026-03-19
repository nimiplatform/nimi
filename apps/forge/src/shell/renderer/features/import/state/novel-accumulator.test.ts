import { describe, expect, it } from 'vitest';

import {
  createAccumulator,
  mergeChapterIntoAccumulator,
  updateConflictResolution,
} from './novel-accumulator.js';
import type { ChapterExtractionArtifact } from '../types.js';

function makeArtifact(overrides: Partial<ChapterExtractionArtifact>): ChapterExtractionArtifact {
  return {
    chapterIndex: 0,
    chapterTitle: 'Chapter 1',
    worldRules: [],
    agentRules: [],
    newCharacters: [],
    contradictions: [],
    chapterSummary: 'summary',
    status: 'COMPLETED',
    ...overrides,
  };
}

describe('novel accumulator', () => {
  it('applies user conflict resolution back into world truth and lineage', () => {
    const base = createAccumulator('novel.txt', 2);
    const afterFirst = mergeChapterIntoAccumulator(base, makeArtifact({
      worldRules: [{
        ruleKey: 'society:archive-city:political-structure',
        title: 'Archive City Structure',
        statement: 'Archive City is ruled by curators.',
        domain: 'SOCIETY',
        category: 'DEFINITION',
        hardness: 'SOFT',
        scope: 'WORLD',
        provenance: 'WORLD_STUDIO',
      }],
    }));
    const afterSecond = mergeChapterIntoAccumulator(afterFirst, makeArtifact({
      chapterIndex: 1,
      chapterTitle: 'Chapter 2',
      worldRules: [{
        ruleKey: 'society:archive-city:political-structure',
        title: 'Archive City Structure',
        statement: 'Archive City is ruled by seven curators and one auditor.',
        domain: 'SOCIETY',
        category: 'DEFINITION',
        hardness: 'FIRM',
        scope: 'WORLD',
        provenance: 'WORLD_STUDIO',
      }],
    }));

    expect(afterSecond.conflicts).toHaveLength(1);

    const resolved = updateConflictResolution(afterSecond, 0, 'USE_NEW');

    expect(resolved.worldRules['society:archive-city:political-structure']?.statement)
      .toBe('Archive City is ruled by seven curators and one auditor.');
    expect(resolved.worldRuleLineage['society:archive-city:political-structure']?.at(-1)?.action)
      .toBe('USER_RESOLVED');
  });

  it('applies user conflict resolution back into agent truth', () => {
    const base = createAccumulator('novel.txt', 2);
    const afterFirst = mergeChapterIntoAccumulator(base, makeArtifact({
      agentRules: [{
        characterName: 'Ari',
        rules: [{
          ruleKey: 'behavior:greeting-style',
          title: 'Greeting Style',
          statement: 'Ari greets cautiously.',
          layer: 'BEHAVIORAL',
          category: 'POLICY',
          hardness: 'SOFT',
          scope: 'DYAD',
          importance: 60,
          provenance: 'CREATOR',
        }],
      }],
    }));
    const afterSecond = mergeChapterIntoAccumulator(afterFirst, makeArtifact({
      chapterIndex: 1,
      chapterTitle: 'Chapter 2',
      agentRules: [{
        characterName: 'Ari',
        rules: [{
          ruleKey: 'behavior:greeting-style',
          title: 'Greeting Style',
          statement: 'Ari greets like a long-lost friend.',
          layer: 'BEHAVIORAL',
          category: 'POLICY',
          hardness: 'FIRM',
          scope: 'DYAD',
          importance: 70,
          provenance: 'CREATOR',
        }],
      }],
    }));

    const resolved = updateConflictResolution(afterSecond, 0, 'MERGE', 'Ari greets cautiously, then opens up like a long-lost friend.');

    expect(resolved.agentRulesByCharacter.Ari?.['behavior:greeting-style']?.statement)
      .toBe('Ari greets cautiously, then opens up like a long-lost friend.');
    expect(resolved.agentRuleLineageByCharacter.Ari?.['behavior:greeting-style']?.at(-1)?.resolution)
      .toBe('MERGE');
  });
});
