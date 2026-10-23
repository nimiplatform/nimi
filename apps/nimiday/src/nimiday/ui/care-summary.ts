import { isActive } from '../domain/reminders.js';
import { attentionOrder, PARENTOS_APP_ID, type SourceChange } from '../domain/sources.js';
import type { CareCircle, LifeItem } from '../domain/types.js';

export function careItems(items: readonly LifeItem[], circleId: string): LifeItem[] {
  return items.filter((item) => item.circleId === circleId && isActive(item))
    .sort((a, b) => `${a.date ?? '9999'}${a.time ?? ''}`.localeCompare(`${b.date ?? '9999'}${b.time ?? ''}`));
}

// @nimi-authority: rule.nimi.nimiday.assistant.child-source-association
export function careChanges(changes: readonly SourceChange[], circles: readonly CareCircle[]) {
  const byCircle = new Map<string, SourceChange[]>();
  const pending = new Map<string, SourceChange[]>();
  const unknown: SourceChange[] = [];
  const other: SourceChange[] = [];
  for (const change of attentionOrder(changes)) {
    if (change.circleId && circles.some((circle) => circle.id === change.circleId)) {
      const list = byCircle.get(change.circleId) ?? [];
      list.push(change);
      byCircle.set(change.circleId, list);
    } else if (change.appId === PARENTOS_APP_ID) {
      if (change.child && change.groupKey) {
        const list = pending.get(change.groupKey) ?? [];
        list.push(change);
        pending.set(change.groupKey, list);
      } else {
        unknown.push(change);
      }
    } else {
      other.push(change);
    }
  }
  return {
    grouped: circles.filter((circle) => byCircle.has(circle.id))
      .map((circle) => ({ circle, list: byCircle.get(circle.id)! })),
    pending: [...pending].map(([key, list]) => ({ key, list })),
    unknown,
    other,
  };
}
