import { describe, it, expect } from 'vitest';
import { enforcePacing } from '../pacing-enforcer.js';
import { parseChoices } from '../choice-parser.js';
import { matchLorebook } from '../lorebook-matcher.js';
import { buildKnowledgeBlock, formatKnowledgeBlockForPrompt } from '../knowledge-scaffolder.js';
import { detectExplanations } from '../explanation-detector.js';
import { checkTrunkConvergence } from '../trunk-convergence.js';
import type { SessionSnapshot, DialogueTurn, LoreEntry, KnowledgeFlag, TrunkEvent, SceneType } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    worldId: 'w1',
    agentId: 'a1',
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
  return { id: '1', sessionId: 's1', seq: 1, role, content, sceneType: 'crisis', createdAt: '' };
}

// ── pacing-enforcer ─────────────────────────────────────────────────────

describe('enforcePacing', () => {
  it('rhythm counter 0 produces crisis, counter becomes 1', () => {
    const result = enforcePacing(makeSnapshot({ rhythmCounter: 0 }), 1, false);
    expect(result.nextSceneType).toBe('crisis');
    expect(result.rhythmCounter).toBe(1);
  });

  it('rhythm counter 2 produces crisis, counter becomes 3', () => {
    const result = enforcePacing(makeSnapshot({ rhythmCounter: 2 }), 1, false);
    expect(result.nextSceneType).toBe('crisis');
    expect(result.rhythmCounter).toBe(3);
  });

  it('rhythm counter 3 produces campfire, counter resets to 0', () => {
    const result = enforcePacing(makeSnapshot({ rhythmCounter: 3 }), 1, false);
    expect(result.nextSceneType).toBe('campfire');
    expect(result.rhythmCounter).toBe(0);
  });

  it('triggers verification at turn 5, 10, 15', () => {
    for (const turnCount of [4, 9, 14]) {
      const result = enforcePacing(makeSnapshot(), turnCount, false);
      expect(result.nextSceneType).toBe('verification');
      expect(result.shouldTriggerVerification).toBe(true);
    }
  });

  it('triggers metacognition when trunkEventReached is true', () => {
    const result = enforcePacing(makeSnapshot(), 1, true);
    expect(result.nextSceneType).toBe('metacognition');
    expect(result.shouldTriggerMetacognition).toBe(true);
  });

  it('metacognition overrides verification', () => {
    const result = enforcePacing(makeSnapshot(), 4, true);
    expect(result.nextSceneType).toBe('metacognition');
    expect(result.shouldTriggerVerification).toBe(false);
  });
});

// ── choice-parser ───────────────────────────────────────────────────────

describe('parseChoices', () => {
  it('parses "A. text\\nB. text" pattern', () => {
    const text = 'A. Fight the enemy\nB. Retreat to safety';
    const result = parseChoices(text, 'crisis');
    expect(result.choices).toHaveLength(2);
    expect(result.choices[0]!.key).toBe('A');
    expect(result.choices[1]!.key).toBe('B');
  });

  it('parses "A. text | consequence\\nB. text | consequence"', () => {
    const text = 'A. Attack | You may get wounded\nB. Defend | Safer but slower';
    const result = parseChoices(text, 'crisis');
    expect(result.choices[0]!.consequencePreview).toBe('You may get wounded');
    expect(result.choices[1]!.consequencePreview).toBe('Safer but slower');
  });

  it('returns empty choices for narrative-only text in non-crisis scene', () => {
    const text = 'The sun sets over the river as the soldiers make camp.';
    const result = parseChoices(text, 'campfire');
    expect(result.choices).toHaveLength(0);
    expect(result.isCrisisScene).toBe(false);
  });

  it('handles Chinese choice pattern', () => {
    const text = '选A：出兵攻打\n选B：按兵不动';
    const result = parseChoices(text, 'crisis');
    expect(result.choices).toHaveLength(2);
    expect(result.choices[0]!.description).toBe('出兵攻打');
    expect(result.choices[1]!.description).toBe('按兵不动');
  });

  it('deduplicates by key', () => {
    const text = 'A. First option\nA. Duplicate option\nB. Second option';
    const result = parseChoices(text, 'crisis');
    const aChoices = result.choices.filter((c) => c.key === 'A');
    expect(aChoices).toHaveLength(1);
  });

  it('sets isCrisisScene flag correctly', () => {
    expect(parseChoices('A. x\nB. y', 'crisis').isCrisisScene).toBe(true);
    expect(parseChoices('A. x\nB. y', 'campfire').isCrisisScene).toBe(false);
  });
});

// ── lorebook-matcher ────────────────────────────────────────────────────

describe('matchLorebook', () => {
  it('returns empty for no lorebooks', () => {
    const result = matchLorebook([makeTurn('hello')], [], 'hello');
    expect(result).toEqual([]);
  });

  it('matches keyword present in dialogue', () => {
    const lore: LoreEntry[] = [{ key: 'Cao Cao', value: 'Warlord of Wei' }];
    const turns = [makeTurn('Cao Cao marched north')];
    const result = matchLorebook(turns, lore, 'tell me about Cao Cao');
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('Cao Cao');
  });

  it('limits to 5 entries', () => {
    const lore: LoreEntry[] = Array.from({ length: 8 }, (_, i) => ({
      key: `k${i}`,
      value: `v${i}`,
    }));
    const turns = [makeTurn(lore.map((l) => l.key).join(' '))];
    const result = matchLorebook(turns, lore, '');
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('prioritizes entries in user input', () => {
    const lore: LoreEntry[] = Array.from({ length: 7 }, (_, i) => ({
      key: `concept${i}`,
      value: `val${i}`,
    }));
    const turns = [makeTurn(lore.map((l) => l.key).join(' '))];
    const result = matchLorebook(turns, lore, 'concept6 concept5');
    // Entries in user input should appear before those not in user input
    const inUserInput = result.filter((r) => ['concept5', 'concept6'].includes(r.key));
    const notInUserInput = result.filter((r) => !['concept5', 'concept6'].includes(r.key));
    const firstNonUserIdx = result.findIndex((r) => !['concept5', 'concept6'].includes(r.key));
    const lastUserIdx = result.reduce((acc, r, i) => ['concept5', 'concept6'].includes(r.key) ? i : acc, -1);
    expect(inUserInput.length).toBe(2);
    expect(lastUserIdx).toBeLessThan(firstNonUserIdx === -1 ? Infinity : firstNonUserIdx);
  });

  it('respects 10-turn context window', () => {
    const oldTurns: DialogueTurn[] = Array.from({ length: 12 }, (_, i) =>
      makeTurn(i < 2 ? 'ancient keyword' : 'filler'),
    );
    const lore: LoreEntry[] = [{ key: 'ancient keyword', value: 'old lore' }];
    const result = matchLorebook(oldTurns, lore, '');
    expect(result).toHaveLength(0);
  });
});

// ── knowledge-scaffolder ────────────────────────────────────────────────

describe('buildKnowledgeBlock', () => {
  it('separates depth>=1 as alreadyKnown', () => {
    const flags: KnowledgeFlag[] = [
      { conceptKey: 'a', domain: 'd', depth: 2 },
      { conceptKey: 'b', domain: 'd', depth: 0 },
    ];
    const block = buildKnowledgeBlock(flags, []);
    expect(block.alreadyKnown).toEqual(['a']);
  });

  it('depth=0 with matching lorebook goes to mayExplain', () => {
    const flags: KnowledgeFlag[] = [{ conceptKey: 'x', domain: 'd', depth: 0 }];
    const lore: LoreEntry[] = [{ key: 'x', value: 'info' }];
    const block = buildKnowledgeBlock(flags, lore);
    expect(block.mayExplain).toEqual(['x']);
  });

  it('has newConceptLimit of 3', () => {
    const block = buildKnowledgeBlock([], []);
    expect(block.newConceptLimit).toBe(3);
  });

  it('formatKnowledgeBlockForPrompt contains expected sections', () => {
    const block = { alreadyKnown: ['a'], mayExplain: ['b'], newConceptLimit: 3 };
    const output = formatKnowledgeBlockForPrompt(block);
    expect(output).toContain('already understands');
    expect(output).toContain('May explain');
    expect(output).toContain('at most 3');
  });
});

// ── explanation-detector ────────────────────────────────────────────────

describe('detectExplanations', () => {
  it('detects explanation with indicator keyword', () => {
    const lore: LoreEntry[] = [{ key: '屯田', value: 'farming policy' }];
    const flags: KnowledgeFlag[] = [{ conceptKey: '屯田', domain: 'd', depth: 0 }];
    const text = '所谓屯田，就是让士兵在边疆种地。';
    const result = detectExplanations(text, lore, flags);
    expect(result).toHaveLength(1);
    expect(result[0]!.conceptKey).toBe('屯田');
    expect(result[0]!.newDepth).toBe(1);
  });

  it('does NOT upgrade depth>=1 concepts', () => {
    const lore: LoreEntry[] = [{ key: '屯田', value: 'farming' }];
    const flags: KnowledgeFlag[] = [{ conceptKey: '屯田', domain: 'd', depth: 1 }];
    const text = '所谓屯田，就是让士兵在边疆种地。';
    const result = detectExplanations(text, lore, flags);
    expect(result).toHaveLength(0);
  });

  it('requires keyword present in text', () => {
    const lore: LoreEntry[] = [{ key: '屯田', value: 'farming' }];
    const flags: KnowledgeFlag[] = [{ conceptKey: '屯田', domain: 'd', depth: 0 }];
    const text = '所谓这个政策是很重要的。';
    const result = detectExplanations(text, lore, flags);
    expect(result).toHaveLength(0);
  });

  it('detects via 3+ occurrences without indicator', () => {
    const lore: LoreEntry[] = [{ key: '科举', value: 'imperial exam' }];
    const flags: KnowledgeFlag[] = [{ conceptKey: '科举', domain: 'd', depth: 0 }];
    const text = '科举制度在唐代非常重要。科举考试分为多个等级。科举的影响延续了千年。';
    const result = detectExplanations(text, lore, flags);
    expect(result).toHaveLength(1);
  });

  it('returns empty for no matches', () => {
    const result = detectExplanations('nothing here', [], []);
    expect(result).toHaveLength(0);
  });
});

// ── trunk-convergence ───────────────────────────────────────────────────

describe('checkTrunkConvergence', () => {
  const trunkEvents: TrunkEvent[] = [
    { index: 0, title: '赤壁之战 火攻', content: '曹操大军南下，孙刘联军在赤壁设火攻之计', requiresChoice: true },
  ];

  it('empty trunk events returns free directive', () => {
    const result = checkTrunkConvergence(makeSnapshot(), [], '', 0);
    expect(result.convergenceDirective).toBe('free');
    expect(result.trunkEventReached).toBe(false);
  });

  it('approaching detection after PROXIMITY_TURN_THRESHOLD turns', () => {
    const result = checkTrunkConvergence(makeSnapshot(), trunkEvents, 'some text', 5);
    expect(result.convergenceDirective).toBe('approach');
    expect(result.isApproachingTrunk).toBe(true);
  });

  it('arrival detection with matching keywords', () => {
    // Text must include >= 2 title words AND >= 1 content word (3+ char, exact substring)
    // Title words: ['赤壁之战', '火攻']   Content words: ['曹操大军南下', '孙刘联军在赤壁设火攻之计']
    const text = '赤壁之战即将打响，火攻之计已经准备就绪。曹操大军南下，孙刘联军在赤壁设火攻之计。';
    const result = checkTrunkConvergence(makeSnapshot(), trunkEvents, text, 2);
    expect(result.trunkEventReached).toBe(true);
    expect(result.convergenceDirective).toBe('arrived');
    expect(result.reachedEvent).toEqual(trunkEvents[0]);
  });

  it('index advances on arrival', () => {
    const text = '赤壁之战即将打响，火攻之计已经准备就绪。曹操大军南下，孙刘联军在赤壁设火攻之计。';
    const result = checkTrunkConvergence(makeSnapshot({ trunkEventIndex: 0 }), trunkEvents, text, 2);
    expect(result.nextTrunkIndex).toBe(1);
  });
});
