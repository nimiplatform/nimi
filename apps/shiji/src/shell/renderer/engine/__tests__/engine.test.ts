import { describe, expect, it } from 'vitest';
import { parseChoices } from '../choice-parser.js';
import { detectExplanations } from '../explanation-detector.js';
import { buildKnowledgeBlock, formatKnowledgeBlockForPrompt } from '../knowledge-scaffolder.js';
import { matchLorebook } from '../lorebook-matcher.js';
import { enforcePacing } from '../pacing-enforcer.js';
import type { DialogueTurn, KnowledgeFlag, LoreEntry, SessionSnapshot } from '../types.js';

function makeSnapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    worldId: 'world-1',
    agentId: 'agent-1',
    contentType: 'history',
    truthMode: 'factual',
    chapterIndex: 1,
    sceneType: 'crisis',
    rhythmCounter: 0,
    trunkEventIndex: 0,
    ...overrides,
  };
}

function makeTurn(content: string, role: 'user' | 'assistant' = 'assistant'): DialogueTurn {
  return {
    id: 'turn-1',
    sessionId: 'session-1',
    seq: 1,
    role,
    content,
    sceneType: 'crisis',
    createdAt: '2026-04-01T00:00:00.000Z',
  };
}

describe('enforcePacing', () => {
  it('uses crisis pacing until the campfire threshold is reached', () => {
    const result = enforcePacing(makeSnapshot({ rhythmCounter: 2 }), 1, false);
    expect(result.nextSceneType).toBe('crisis');
    expect(result.rhythmCounter).toBe(3);
  });

  it('switches to campfire once the rhythm threshold is met', () => {
    const result = enforcePacing(makeSnapshot({ rhythmCounter: 3 }), 1, false);
    expect(result.nextSceneType).toBe('campfire');
    expect(result.rhythmCounter).toBe(0);
  });

  it('prioritizes verification on every fifth turn', () => {
    const result = enforcePacing(makeSnapshot(), 4, false);
    expect(result.nextSceneType).toBe('verification');
    expect(result.shouldTriggerVerification).toBe(true);
  });

  it('prioritizes metacognition over all other pacing states', () => {
    const result = enforcePacing(makeSnapshot(), 4, true);
    expect(result.nextSceneType).toBe('metacognition');
    expect(result.shouldTriggerMetacognition).toBe(true);
  });
});

describe('parseChoices', () => {
  it('parses simple lettered crisis choices', () => {
    const result = parseChoices('A. Push forward\nB. Fall back', 'crisis');
    expect(result.isCrisisScene).toBe(true);
    expect(result.choices).toHaveLength(2);
    expect(result.choices[0]?.description).toBe('Push forward');
    expect(result.choices[1]?.description).toBe('Fall back');
  });

  it('parses consequence previews and deduplicates by key', () => {
    const result = parseChoices('A. Advance | Risky\nA. Duplicate\nB. Hold line | Safer', 'crisis');
    expect(result.choices).toHaveLength(2);
    expect(result.choices[0]?.consequencePreview).toBe('Risky');
    expect(result.choices[1]?.consequencePreview).toBe('Safer');
  });

  it('returns narrative-only output for non-crisis scenes', () => {
    const result = parseChoices('The patrol makes camp by the river.', 'campfire');
    expect(result.isCrisisScene).toBe(false);
    expect(result.choices).toEqual([]);
  });
});

describe('matchLorebook', () => {
  it('returns empty when there are no lorebooks', () => {
    expect(matchLorebook([makeTurn('hello')], [], 'hello')).toEqual([]);
  });

  it('matches lore entries present in recent turns', () => {
    const lore: LoreEntry[] = [{ key: 'Cao Cao', value: 'Warlord of Wei' }];
    const result = matchLorebook([makeTurn('Cao Cao marched north')], lore, 'tell me about Cao Cao');
    expect(result).toHaveLength(1);
    expect(result[0]?.key).toBe('Cao Cao');
  });

  it('limits matches to the recent turn window', () => {
    const turns = Array.from({ length: 12 }, (_, index) =>
      makeTurn(index < 2 ? 'ancient keyword' : 'filler'),
    );
    const lore: LoreEntry[] = [{ key: 'ancient keyword', value: 'old lore' }];
    expect(matchLorebook(turns, lore, '')).toEqual([]);
  });
});

describe('knowledge scaffolder', () => {
  it('separates known concepts from explainable concepts', () => {
    const flags: KnowledgeFlag[] = [
      { conceptKey: 'known', domain: 'history', depth: 2 },
      { conceptKey: 'new', domain: 'history', depth: 0 },
    ];
    const lore: LoreEntry[] = [{ key: 'new', value: 'context' }];
    const block = buildKnowledgeBlock(flags, lore);
    expect(block.alreadyKnown).toEqual(['known']);
    expect(block.mayExplain).toEqual(['new']);
  });

  it('formats the prompt block with the stable knowledge sections', () => {
    const output = formatKnowledgeBlockForPrompt({
      alreadyKnown: ['known'],
      mayExplain: ['new'],
      newConceptLimit: 3,
    });
    expect(output).toContain('already understands');
    expect(output).toContain('May explain naturally');
    expect(output).toContain('at most 3');
  });
});

describe('detectExplanations', () => {
  it('detects repeated substantive concept mentions', () => {
    const lore: LoreEntry[] = [{ key: 'imperial exam', value: 'civil service system' }];
    const flags: KnowledgeFlag[] = [{ conceptKey: 'imperial exam', domain: 'history', depth: 0 }];
    const text = 'The imperial exam shaped careers. The imperial exam rewarded study. The imperial exam changed governance.';
    const result = detectExplanations(text, lore, flags);
    expect(result).toEqual([{ conceptKey: 'imperial exam', newDepth: 1 }]);
  });

  it('does not upgrade concepts that are already known', () => {
    const lore: LoreEntry[] = [{ key: 'imperial exam', value: 'civil service system' }];
    const flags: KnowledgeFlag[] = [{ conceptKey: 'imperial exam', domain: 'history', depth: 1 }];
    const text = 'The imperial exam shaped careers. The imperial exam rewarded study. The imperial exam changed governance.';
    expect(detectExplanations(text, lore, flags)).toEqual([]);
  });
});
