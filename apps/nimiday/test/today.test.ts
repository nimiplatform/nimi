import { describe, expect, it } from 'vitest';
import { emptyState } from '../src/nimiday/domain/defaults.js';
import { createItem, markReminder, snoozeItem } from '../src/nimiday/domain/items.js';
import type { SourceChange } from '../src/nimiday/domain/sources.js';
import { buildToday } from '../src/nimiday/domain/today.js';
import type { SkillRun } from '../src/nimiday/domain/types.js';

function run(id: string, skillId: string, state: SkillRun['state'], createdAt: string): SkillRun {
  return {
    id, skillId, skillName: skillId, trigger: 'user', rhythmId: null, scheduledFor: null, state, agentName: 'Aya',
    requestText: '', turnId: null, createdAt, startedAt: null, finishedAt: null, toolCalls: [], changes: [],
    undone: false, replyMessageId: null, replyText: null, error: null,
  };
}

function change(id: string, overrides: Partial<SourceChange>): SourceChange {
  return {
    id, appId: 'nimi.parentos', appName: 'ParentOS', type: 'nimi.parentos.care-reminder.v1', nature: 'reminder',
    title: id, summary: null, occurredAt: '2026-09-24T00:00:00.000Z', todoState: 'open', unread: false,
    needsAttention: false, openable: true, sourceAvailable: true, revision: 1, circleId: null, known: 'parentos-care-reminder', groupKey: null,
    ...overrides,
  };
}

describe('today', () => {
  it('moves a snoozed overdue item out of "now" until the snooze comes due', () => {
    const created = new Date('2026-09-24T05:50:00+08:00');
    const now = new Date('2026-09-24T06:34:00+08:00');
    const item = createItem({ title: '给窗台的花浇水', date: '2026-09-24', time: '06:04' }, { by: 'user' }, created);
    const state = { ...emptyState('zh', created), items: [item] };
    expect(buildToday(state, [], now).attention.map((entry) => entry.id)).toEqual([item.id]);

    const snoozed = snoozeItem(item, new Date('2026-09-24T06:44:00+08:00').toISOString(), now);
    const later = { ...state, items: [snoozed] };
    expect(buildToday(later, [], now).attention).toEqual([]);
    expect(buildToday(later, [], now).timeline.some((entry) => entry.kind === 'item' && entry.item.id === item.id)).toBe(true);
    expect(buildToday(later, [], new Date('2026-09-24T06:45:00+08:00')).attention.map((entry) => entry.id)).toEqual([item.id]);
  });

  it('lists a reminder that came due while NimiDay was closed once, under "while you were away"', () => {
    const created = new Date('2026-09-24T15:24:00+08:00');
    const reopened = new Date('2026-09-24T15:50:00+08:00');
    const item = createItem({ title: '给阳台的绿萝喷水', date: '2026-09-24', time: '15:31' }, { by: 'user' }, created);
    const missed = markReminder(item, new Date('2026-09-24T15:31:00+08:00').toISOString(), 'missed', reopened);
    const model = buildToday({ ...emptyState('zh', created), items: [missed] }, [], reopened);
    expect(model.missed.map((entry) => entry.id)).toEqual([item.id]);
    expect(model.attention).toEqual([]);
    expect(model.counts.overdue).toBe(1);
  });

  it('shows the latest run of each skill and keeps anything still in motion', () => {
    const now = new Date('2026-09-24T07:00:00+08:00');
    const state = {
      ...emptyState('zh', now),
      runs: [
        run('r1', 'morning-care', 'failed', '2026-09-24T05:57:00+08:00'),
        run('r2', 'morning-care', 'interrupted', '2026-09-24T06:25:00+08:00'),
        run('r3', 'morning-care', 'done', '2026-09-24T06:40:00+08:00'),
        run('r4', 'week-plan', 'queued', '2026-09-24T06:10:00+08:00'),
        run('r5', 'week-plan', 'failed', '2026-09-24T06:50:00+08:00'),
        run('r6', 'evening-wrap', 'dismissed', '2026-09-24T06:30:00+08:00'),
      ],
    };
    expect(buildToday(state, [], now).runs.map((entry) => entry.id)).toEqual(['r5', 'r3', 'r4']);
  });

  it('leaves reminders already handled in their own app out of the news', () => {
    const now = new Date('2026-09-24T07:00:00+08:00');
    const changes = [
      change('open', {}),
      change('done-read', { todoState: 'completed' }),
      change('done-unread', { todoState: 'completed', unread: true }),
      change('mirror', { todoState: null, nature: 'interpretation', known: 'shijing-daily-mirror' }),
    ];
    const model = buildToday(emptyState('zh', now), changes, now);
    // Still open there: something to arrange or finish. Done there and unread, or a reading: news.
    expect(model.reminders.map((entry) => entry.id)).toEqual(['open']);
    expect(model.changes.map((entry) => entry.id).sort()).toEqual(['done-unread', 'mirror']);
  });

  it('keeps open reminders from other apps in view first, however long ago their window opened', () => {
    const now = new Date('2026-09-24T07:00:00+08:00');
    const changes = [
      change('fresh-done-unread', { todoState: 'completed', unread: true, occurredAt: '2026-09-23T12:00:00.000Z' }),
      change('old-open', { occurredAt: '2026-02-28T16:00:00.000Z' }),
      change('old-mirror', { todoState: null, nature: 'interpretation', known: 'shijing-daily-mirror', occurredAt: '2026-09-01T00:00:00.000Z' }),
      change('recent-open', { occurredAt: '2026-08-27T16:00:00.000Z' }),
    ];
    const model = buildToday(emptyState('zh', now), changes, now);
    expect(model.reminders.map((entry) => entry.id)).toEqual(['recent-open', 'old-open']);
    expect(model.remindersTotal).toBe(2);
    expect(model.changes.map((entry) => entry.id)).toEqual(['fresh-done-unread']);
  });
});
