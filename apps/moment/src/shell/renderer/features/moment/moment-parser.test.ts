import { parseContinuationBeat, parseStoryOpening } from './moment-parser.js';

describe('moment-parser', () => {
  it('parses a strict story opening payload', () => {
    const opening = parseStoryOpening(JSON.stringify({
      title: '灯还亮着，像约定没有取消',
      opening: '路灯下的小桌子摆得像有人刚离开，又像还有一个人没来。',
      presence: '今晚可能已经有人来过，也可能还有一个人正在路上。',
      mystery: '真正奇怪的是，这种临时的小地方像被某种约定使用了很久。',
      sceneSummary: '小路边的路灯、贩卖机、两张板凳和一张小桌子。',
      actions: ['先看看桌上有没有留下什么', '站远一点等会不会有人来', '看看刚刚买走的是哪一瓶'],
      relationState: 'distant',
    }));

    expect(opening.title).toContain('灯还亮着');
    expect(opening.actions).toHaveLength(3);
    expect(opening.relationState).toBe('distant');
  });

  it('parses a continuation payload and carries user line', () => {
    const beat = parseContinuationBeat(JSON.stringify({
      storyBeat: '你刚退到路灯边缘，远处就传来了很轻的自行车刹车声。',
      actions: ['继续站远一点听', '靠近一点看是谁来了', '先看桌上的空瓶'],
      relationState: 'approaching',
    }), {
      userLine: '我先在远处等一会儿。',
      traceId: 'trace-1',
    });

    expect(beat.userLine).toBe('我先在远处等一会儿。');
    expect(beat.traceId).toBe('trace-1');
    expect(beat.relationState).toBe('approaching');
  });

  it('fails closed when required opening fields are missing', () => {
    expect(() => parseStoryOpening(JSON.stringify({
      title: '只有标题',
      actions: ['一', '二', '三'],
    }))).toThrow('MOMENT_OPENING_FIELDS_REQUIRED');
  });
});
