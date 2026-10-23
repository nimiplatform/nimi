import { stillInCare } from './care.js';
import { isActive } from './reminders.js';
import { linkedSource, PARENTOS_APP_ID, sourceContentSignature, sourceGroupFor, sourcePreferenceFor, sourceViewKey, type SourceChange } from './sources.js';
import type { DayState, LifeItem, SourceView } from './types.js';
import { DAY_MS } from './time.js';

export type SourceListMode = 'pending' | 'association' | 'dynamics' | 'all' | 'hidden' | 'snoozed' | 'arranged';
export type SourceListTarget = { readonly mode: SourceListMode; readonly unitKey?: string };
export type SourceReason = 'open' | 'changed' | 'terminal' | 'check';
export type SourceEntry = {
  readonly change: SourceChange;
  readonly view: SourceView | undefined;
  readonly arrangement: LifeItem | null;
  readonly reason: SourceReason | null;
  readonly reviewSignature: string | null;
  readonly association: boolean;
  readonly hidden: boolean;
  readonly snoozed: boolean;
  readonly inCare: boolean;
  readonly recent: boolean;
};
export type SourceUnit = { readonly key: string; readonly entries: readonly SourceEntry[]; readonly tier: number };

// @nimi-authority: rule.nimi.nimiday.assistant.source-attention-lifecycle
export function sourceEntries(state: DayState, changes: readonly SourceChange[], now: Date): SourceEntry[] {
  const inCare = stillInCare(state.circles);
  return changes.map(change => {
    // Projection excludes ended associations from active child attribution, but
    // ending care must still suppress the previously associated source on Today.
    const group = sourceGroupFor(state.profile, change.groupKey);
    const assignedCircleId = (group?.appId === change.appId ? group.circleId : null)
      ?? (change.appId !== PARENTOS_APP_ID ? sourcePreferenceFor(state.profile, change.appId).circleId : null);
    const view = state.profile.sourceViews.find(entry => entry.key === sourceViewKey(change));
    const linked = state.items.filter(item => item.source && linkedSource(item.source, [change]));
    const arrangement = linked.find(isActive) ?? null;
    const open = change.nature === 'reminder' && change.todoState === 'open';
    let reason: SourceReason | null = null;
    if (arrangement) {
      if (change.todoState === 'completed' || change.todoState === 'cancelled') reason = 'terminal';
      else if (arrangement.source?.contentSignature
        ? arrangement.source.contentSignature !== sourceContentSignature(change)
        : arrangement.source?.title !== change.title) reason = 'changed';
    } else if (open) {
      reason = linked.some(item => item.state === 'done') ? 'check' : 'open';
    }
    const reviewSignature = reason && reason !== 'open'
      ? JSON.stringify([reason, sourceContentSignature(change), arrangement?.id ?? null,
        reason === 'check' ? linked.filter(item => item.state === 'done').map(item => item.id).sort() : null]) : null;
    if (reviewSignature && view?.reviewedSignature === reviewSignature) reason = null;
    const age = now.getTime() - Date.parse(change.occurredAt);
    return { change, view, arrangement, reason, reviewSignature,
      association: open && change.appId === PARENTOS_APP_ID && !change.circleId,
      hidden: view?.hidden === true,
      snoozed: Boolean(view?.snoozedUntil && Date.parse(view.snoozedUntil) > now.getTime()),
      inCare: inCare(change) && inCare({ circleId: assignedCircleId }), recent: change.unread && age >= 0 && age < 7 * DAY_MS };
  });
}

export function sourceUnitKey(entry: SourceEntry): string {
  const { change } = entry;
  // A local circle or a display name alone does not prove a publisher group.
  return change.groupKey
    ? JSON.stringify([change.appId, change.groupKey, change.circleId, change.needsAttention, entry.reason])
    : sourceViewKey(change);
}

const eligible = (entry: SourceEntry) => entry.inCare && !entry.hidden && !entry.snoozed;
const pending = (entry: SourceEntry) => entry.change.nature === 'reminder' && entry.change.todoState === 'open' || entry.reason !== null;

// @nimi-authority: rule.nimi.nimiday.assistant.source-attention-summary
export function buildSourceAttention(state: DayState, changes: readonly SourceChange[], now: Date) {
  const entries = sourceEntries(state, changes, now);
  const actionable = entries.filter(entry => eligible(entry) && !entry.association && entry.reason);
  const groups = new Map<string, SourceEntry[]>();
  for (const entry of actionable) {
    const key = sourceUnitKey(entry);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  const ordered: SourceUnit[] = [];
  const units = [...groups].map(([key, list]) => ({ key,
    entries: list.sort((a, b) => sourceViewKey(a.change).localeCompare(sourceViewKey(b.change))),
    tier: list[0]!.change.needsAttention || list[0]!.reason !== 'open' ? 0 : 1,
  }));
  for (const tier of [0, 1]) {
    const candidates = units.filter(unit => unit.tier === tier).sort((a, b) => a.key.localeCompare(b.key));
    const byApp = new Map<string, SourceUnit[]>();
    for (const unit of candidates) {
      const app = unit.entries[0]!.change.appId;
      const list = byApp.get(app) ?? [];
      list.push(unit); byApp.set(app, list);
    }
    const queues = [...byApp.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, list]) => list);
    while (queues.some(queue => queue.length)) for (const queue of queues) {
      const unit = queue.shift(); if (unit) ordered.push(unit);
    }
  }
  const association = entries.filter(entry => eligible(entry) && entry.association);
  const dynamics = entries.filter(entry => eligible(entry) && entry.recent && !pending(entry));
  const open = entries.filter(entry => entry.inCare && entry.change.todoState === 'open' && entry.change.nature === 'reminder');
  return { entries, units: ordered.slice(0, 3), allUnits: ordered, association, dynamics,
    attentionCount: actionable.length, openCount: open.length,
    appCount: new Set(open.map(entry => entry.change.appId)).size };
}

export function selectSourceEntries(entries: readonly SourceEntry[], target: SourceListTarget): SourceEntry[] {
  return entries.filter(entry => {
    if (target.unitKey && sourceUnitKey(entry) !== target.unitKey) return false;
    switch (target.mode) {
      case 'all': return true;
      case 'hidden': return entry.hidden;
      case 'snoozed': return entry.snoozed && !entry.hidden;
      case 'arranged': return Boolean(entry.arrangement) && !entry.hidden;
      case 'association': return entry.association && !entry.hidden;
      case 'dynamics': return entry.recent && !pending(entry) && !entry.hidden;
      case 'pending': return pending(entry) && !entry.hidden;
    }
  });
}
