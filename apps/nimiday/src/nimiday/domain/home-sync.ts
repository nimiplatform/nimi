// Which NimiDay records belong in Nimi Home. Home should show what needs the
// user — a delivered reminder, a decision — and close them when handled, so
// the message center never keeps stale todos.

import { parseInstant, HOUR_MS } from './time.js';
import type { LifeItem, SkillRun } from './types.js';

export type OwnRecord = {
  readonly activityId: string;
  readonly key: string;
  readonly revision: number;
  readonly kind: 'activity' | 'todo';
  readonly todoState: 'open' | 'completed' | 'cancelled' | null;
};

export type HomePut = {
  readonly key: string;
  readonly kind: 'activity' | 'todo';
  readonly todoState?: 'open' | 'completed' | 'cancelled';
  readonly attention: boolean;
  readonly title: string;
  readonly summary: string;
  readonly objectRef: string;
  readonly type: string;
  readonly data: Record<string, string>;
  readonly occurredAt: string;
  readonly revision: number;
  readonly agentAttributed: boolean;
};

export type HomeCopy = {
  readonly reminderSummary: (item: LifeItem) => string;
  readonly decisionSummary: (item: LifeItem) => string;
  readonly resultTitle: (run: SkillRun) => string;
  readonly resultSummary: (run: SkillRun) => string;
};

export const HOME_TYPES = {
  reminder: 'nimi.day.care-reminder.v1',
  decision: 'nimi.day.decision.v1',
  result: 'nimi.day.skill-result.v1',
} as const;

export function reminderKey(item: LifeItem): string {
  return `reminder:${item.id}:${item.date ?? 'undated'}`;
}

export function decisionKey(item: LifeItem): string {
  return `decision:${item.id}`;
}

export function resultKey(run: SkillRun): string {
  return `result:${run.id}`;
}

function nextRevision(previous: OwnRecord | undefined, now: Date): number {
  return Math.max(now.getTime(), (previous?.revision ?? 0) + 1);
}

/** Records to publish so Home reflects NimiDay's current business state. */
export function planHomeSync(input: {
  readonly items: readonly LifeItem[];
  readonly runs: readonly SkillRun[];
  readonly own: readonly OwnRecord[];
  readonly now: Date;
  readonly copy: HomeCopy;
}): HomePut[] {
  const { items, runs, own, now, copy } = input;
  const byKey = new Map(own.map((record) => [record.key, record]));
  const puts: HomePut[] = [];
  const openKeys = new Set<string>();

  for (const item of items) {
    const reminded = parseInstant(item.remindedFor);
    if (item.state === 'open' && reminded) {
      // An open todo stays open for as long as this occurrence is unhandled.
      const key = reminderKey(item);
      openKeys.add(key);
      if (!byKey.has(key) && now.getTime() - reminded.getTime() < 24 * HOUR_MS) {
        puts.push({
          key,
          kind: 'todo',
          todoState: 'open',
          attention: item.importance !== 'gentle',
          title: item.title,
          summary: copy.reminderSummary(item),
          objectRef: `item:${item.id}`,
          type: HOME_TYPES.reminder,
          data: { itemId: item.id, date: item.date ?? '' },
          occurredAt: reminded.toISOString(),
          revision: nextRevision(undefined, now),
          agentAttributed: item.origin.by === 'agent',
        });
      }
    }
    if (item.state === 'waiting' && item.decision) {
      const key = decisionKey(item);
      openKeys.add(key);
      if (!byKey.has(key)) {
        puts.push({
          key,
          kind: 'todo',
          todoState: 'open',
          attention: true,
          title: item.decision.question,
          summary: copy.decisionSummary(item),
          objectRef: `item:${item.id}`,
          type: HOME_TYPES.decision,
          data: { itemId: item.id },
          occurredAt: item.createdAt,
          revision: nextRevision(undefined, now),
          agentAttributed: item.origin.by === 'agent',
        });
      }
    }
  }

  // Close open todos whose item was handled, moved to another date, or removed.
  for (const record of own) {
    if (record.kind !== 'todo' || record.todoState !== 'open' || openKeys.has(record.key)) continue;
    const itemId = record.key.split(':')[1] ?? '';
    const item = items.find((candidate) => candidate.id === itemId);
    const handled = item ? item.state === 'done' || (item.repeat !== null && item.state === 'open') || item.decision?.choice : false;
    puts.push({
      key: record.key,
      kind: 'todo',
      todoState: handled ? 'completed' : 'cancelled',
      attention: false,
      title: item?.decision?.question ?? item?.title ?? '—',
      summary: item ? copy.reminderSummary(item) : '',
      objectRef: `item:${itemId}`,
      type: record.key.startsWith('decision:') ? HOME_TYPES.decision : HOME_TYPES.reminder,
      data: { itemId },
      occurredAt: now.toISOString(),
      revision: nextRevision(record, now),
      agentAttributed: false,
    });
  }

  for (const run of runs) {
    // Conversation results are already in front of the user; only skill runs report to Home.
    if (run.trigger === 'chat' || run.state !== 'done' || run.undone || !run.finishedAt) continue;
    if (now.getTime() - Date.parse(run.finishedAt) > 24 * HOUR_MS) continue;
    const key = resultKey(run);
    if (byKey.has(key)) continue;
    puts.push({
      key,
      kind: 'activity',
      attention: false,
      title: copy.resultTitle(run),
      summary: copy.resultSummary(run),
      objectRef: `run:${run.id}`,
      type: HOME_TYPES.result,
      data: { runId: run.id, skillId: run.skillId },
      occurredAt: run.finishedAt,
      revision: nextRevision(undefined, now),
      agentAttributed: true,
    });
  }
  return puts;
}
