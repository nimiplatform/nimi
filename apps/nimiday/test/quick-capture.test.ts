import { describe, expect, it } from 'vitest';
import { asksToRecord, circleMentioned, draftFromRequest, parseQuickCapture } from '../src/nimiday/domain/quick-capture.js';

// Thursday 2026-09-24, 10:00 in Asia/Shanghai.
const now = new Date('2026-09-24T10:00:00+08:00');

describe('quick capture', () => {
  it.each([
    ['周五 9:30 带小米打疫苗', { title: '带小米打疫苗', date: '2026-09-25', time: '09:30', kind: 'appointment' }],
    ['明天下午3点给妈妈打电话', { title: '给妈妈打电话', date: '2026-09-25', time: '15:00' }],
    ['下周三 体检', { title: '体检', date: '2026-09-30', time: null, kind: 'todo' }],
    ['10月8号 交房租', { title: '交房租', date: '2026-10-08', time: null }],
    ['今晚 收快递', { title: '收快递', date: '2026-09-24', time: '19:00' }],
    ['3点半 接孩子', { title: '接孩子', date: '2026-09-24', time: '15:30' }],
    ['星期日 上午十点 去看奶奶', { title: '去看奶奶', date: '2026-09-27', time: '10:00' }],
    ['2月3日 结婚纪念日', { title: '结婚纪念日', date: '2027-02-03' }],
    ['tomorrow 3pm call mom', { title: 'call mom', date: '2026-09-25', time: '15:00' }],
    ['tomorrow 3:30pm call mom', { title: 'call mom', date: '2026-09-25', time: '15:30' }],
    ['tomorrow 3:30 pm call mom', { title: 'call mom', date: '2026-09-25', time: '15:30' }],
    ['tomorrow 12:30am call mom', { title: 'call mom', date: '2026-09-25', time: '00:30' }],
    ['tomorrow 12:30pm lunch with dad', { title: 'lunch with dad', date: '2026-09-25', time: '12:30' }],
    ['tomorrow 12am take medicine', { title: 'take medicine', date: '2026-09-25', time: '00:00' }],
    ['friday at 7:45pm movie', { title: 'movie', date: '2026-09-25', time: '19:45' }],
    ['next monday dentist at 9:15', { title: 'dentist', date: '2026-09-28', time: '09:15' }],
    ['buy milk', { title: 'buy milk', date: null, time: null, repeat: null }],
  ])('parses %s', (input, expected) => {
    expect(parseQuickCapture(input, now)).toMatchObject(expected);
  });

  it('understands repeats', () => {
    expect(parseQuickCapture('每周二、五 晚上8点 倒垃圾', now)).toMatchObject({
      title: '倒垃圾',
      time: '20:00',
      repeat: { freq: 'weekly', weekdays: [2, 5] },
    });
    expect(parseQuickCapture('每月15号 还信用卡', now)).toMatchObject({
      title: '还信用卡',
      date: '2026-10-15',
      repeat: { freq: 'monthly' },
    });
    expect(parseQuickCapture('每天 21:00 吃维生素', now)).toMatchObject({
      title: '吃维生素',
      date: '2026-09-24',
      time: '21:00',
      repeat: { freq: 'daily' },
    });
    expect(parseQuickCapture('water plants every monday', now)).toMatchObject({
      title: 'water plants',
      repeat: { freq: 'weekly', weekdays: [1] },
    });
  });

  it('tells an appointment from getting ready for one', () => {
    expect(parseQuickCapture('周五 9:30 带小米打疫苗', now).kind).toBe('appointment');
    expect(parseQuickCapture('明天下午2点 复查', now).kind).toBe('appointment');
    expect(parseQuickCapture('明天晚上8点 准备体检要带的疫苗本', now)).toMatchObject({ title: '准备体检要带的疫苗本', kind: 'todo', time: '20:00' });
    expect(parseQuickCapture('明天上午10点 预约体检', now).kind).toBe('todo');
    expect(parseQuickCapture('tomorrow 3pm pack the gym bag for the check-up', now).kind).toBe('todo');
    expect(parseQuickCapture('friday 10am dentist', now).kind).toBe('appointment');
  });

  it('keeps the words when nothing is recognized', () => {
    expect(parseQuickCapture('  ', now).title).toBe('');
    expect(parseQuickCapture('想想周末带孩子去哪', now)).toMatchObject({ date: null, title: '想想周末带孩子去哪' });
  });
});

describe('circle mentioned in a captured line', () => {
  const circles = [
    { id: 'c1', name: '小米', status: 'active' },
    { id: 'c2', name: '妈妈', status: 'active' },
    { id: 'c3', name: '小米爸爸', status: 'active' },
    { id: 'c4', name: '旧家', status: 'ended' },
  ];
  it('files a line under the one person it names', () => {
    expect(circleMentioned('给妈妈打电话提醒吃药', circles)).toBe('c2');
    expect(circleMentioned('带小米打流感疫苗', circles)).toBe('c1');
  });
  it('prefers the longer name when one contains another and stays unsorted when ambiguous', () => {
    expect(circleMentioned('和小米爸爸商量周末', circles)).toBe('c3');
    expect(circleMentioned('带小米去看妈妈', circles)).toBeNull();
    expect(circleMentioned('收拾旧家的储物间', circles)).toBeNull();
    expect(circleMentioned('买牛奶', circles)).toBeNull();
  });
});

describe('requests made in conversation', () => {
  it('notices when the user asked for something to be kept or arranged', () => {
    expect(asksToRecord('明天早上8点提醒我给小米带上疫苗本')).toBe(true);
    expect(asksToRecord('帮我记一下，小米对花生过敏')).toBe(true);
    expect(asksToRecord('remind me to call mom tomorrow')).toBe(true);
    expect(asksToRecord('今天天气怎么样')).toBe(false);
    expect(asksToRecord('谢谢你')).toBe(false);
  });

  it('turns a spoken request into a reviewable draft', () => {
    expect(draftFromRequest('明天早上8点提醒我给小米带上体检要用的疫苗本，这件事挺重要的。', now)).toMatchObject({
      title: '给小米带上体检要用的疫苗本',
      date: '2026-09-25',
      time: '08:00',
      importance: 'important',
    });
    expect(draftFromRequest('remind me to call mom tomorrow at 3pm', now)).toMatchObject({ title: 'call mom', date: '2026-09-25', time: '15:00', importance: 'normal' });
    expect(draftFromRequest('帮我记一下周六带奶奶去复查', now)).toMatchObject({ title: '带奶奶去复查', date: '2026-09-26' });
  });
});
