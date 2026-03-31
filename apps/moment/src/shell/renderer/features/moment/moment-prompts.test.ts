import { buildContinuationPrompt, buildContinuationSystemPrompt, buildOpeningSystemPrompt } from './moment-prompts.js';

describe('moment-prompts', () => {
  it('keeps ordinary-scene and anti-clue guidance in opening prompt', () => {
    const prompt = buildOpeningSystemPrompt('zh');
    expect(prompt).toContain('Do not force them into thriller, horror, occult, or danger-heavy readings.');
    expect(prompt).toContain('do not over-design the scene with symbolic clue objects');
    expect(prompt).toContain('let ordinary details stay ordinary');
  });

  it('keeps continuity and anti-escalation guidance in continuation prompt', () => {
    const prompt = buildContinuationSystemPrompt('zh');
    expect(prompt).toContain('preserve continuity strictly');
    expect(prompt).toContain('do not introduce brand-new clue objects');
    expect(prompt).toContain('prefer human continuity over clue accumulation');
  });

  it('passes established-facts reminder into beat prompt', () => {
    const prompt = buildContinuationPrompt({
      opening: {
        title: '晚风起时',
        opening: '自动贩卖机在夏夜里低声震动。',
        presence: '这里像有人刚离开。',
        mystery: '桌上那圈水渍还没有干。',
        sceneSummary: '路灯、贩卖机、两张板凳和一张小桌子。',
        actions: ['坐下等一会儿', '看桌上留下了什么', '先不靠近，只看着'],
        relationState: 'distant',
      },
      turns: [],
      userLine: '我先站在远处看着。',
    });
    expect(prompt).toContain('Established facts must remain consistent');
  });
});
