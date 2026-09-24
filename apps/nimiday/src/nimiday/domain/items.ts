import { newId } from './ids.js';
import { alignToRepeat, nextOccurrence, normalizeRepeat } from './recurrence.js';
import { isLocalDate, isLocalTime } from './time.js';
import type {
  Decision,
  Importance,
  Instant,
  ItemEvent,
  ItemEventKind,
  ItemKind,
  ItemState,
  LifeItem,
  LocalDate,
  LocalTime,
  Origin,
  RemindRule,
  RepeatFreq,
  SourceLink,
} from './types.js';

const HISTORY_LIMIT = 40;
export const TITLE_LIMIT = 200;
export const NOTES_LIMIT = 4000;

export type RepeatDraft = {
  readonly freq: RepeatFreq;
  readonly interval?: number;
  readonly weekdays?: readonly number[];
} | null;

export type ItemDraft = {
  readonly title: string;
  readonly notes?: string;
  readonly kind?: ItemKind;
  readonly circleId?: string | null;
  readonly date?: LocalDate | null;
  readonly time?: LocalTime | null;
  readonly place?: string;
  readonly repeat?: RepeatDraft;
  readonly remind?: RemindRule;
  readonly importance?: Importance;
  readonly decision?: Decision | null;
  readonly state?: ItemState;
  readonly source?: SourceLink | null;
};

export type ItemPatch = Partial<Omit<ItemDraft, 'state' | 'decision' | 'source'>>;

type Actor = ItemEvent['by'];

function clip(value: string, limit: number): string {
  const trimmed = value.trim();
  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
}

function withEvent(item: LifeItem, kind: ItemEventKind, by: Actor, now: Date, note?: string): readonly ItemEvent[] {
  const event: ItemEvent = note ? { at: now.toISOString(), kind, by, note } : { at: now.toISOString(), kind, by };
  const history = [...item.history, event];
  return history.length > HISTORY_LIMIT ? history.slice(history.length - HISTORY_LIMIT) : history;
}

export function defaultRemind(kind: ItemKind, date: LocalDate | null, time: LocalTime | null): RemindRule {
  if (!date) return { kind: 'none' };
  if (kind === 'appointment' && time) return { kind: 'before', minutes: 60 };
  return { kind: 'at-time' };
}

function resolveTiming(draft: {
  date?: LocalDate | null;
  time?: LocalTime | null;
  repeat?: RepeatDraft;
}, fallbackAnchor: LocalDate | null) {
  const date = draft.date && isLocalDate(draft.date) ? draft.date : null;
  const time = date && draft.time && isLocalTime(draft.time) ? draft.time : null;
  const repeatDraft = draft.repeat ?? null;
  const anchor = date ?? fallbackAnchor;
  if (!repeatDraft || !anchor) return { date, time, repeat: null };
  const repeat = normalizeRepeat({ ...repeatDraft, anchor });
  return { date: alignToRepeat(repeat, anchor), time, repeat };
}

export function createItem(draft: ItemDraft, origin: Origin, now: Date): LifeItem {
  const title = clip(draft.title, TITLE_LIMIT);
  if (!title) throw new Error('item-title-required');
  const kind = draft.kind ?? 'todo';
  const timing = resolveTiming(draft, null);
  const createdBy: Actor = origin.by === 'user' ? 'user' : origin.by === 'agent' ? 'agent' : 'system';
  const base: LifeItem = {
    id: newId('item', now),
    title,
    notes: clip(draft.notes ?? '', NOTES_LIMIT),
    kind,
    circleId: draft.circleId ?? null,
    date: timing.date,
    time: timing.time,
    place: clip(draft.place ?? '', 200),
    repeat: timing.repeat,
    remind: draft.remind ?? defaultRemind(kind, timing.date, timing.time),
    importance: draft.importance ?? 'normal',
    state: draft.state ?? (draft.decision ? 'waiting' : 'open'),
    snoozedUntil: null,
    remindedFor: null,
    decision: draft.decision ?? null,
    ...(draft.source ? { source: draft.source } : {}),
    origin,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    completedAt: null,
    history: [],
  };
  return { ...base, history: withEvent(base, 'created', createdBy, now) };
}

export function editItem(item: LifeItem, patch: ItemPatch, by: Actor, now: Date): LifeItem {
  const timingChanged = patch.date !== undefined || patch.time !== undefined || patch.repeat !== undefined;
  const timing = timingChanged
    ? resolveTiming({
      date: patch.date !== undefined ? patch.date : item.date,
      time: patch.time !== undefined ? patch.time : item.time,
      repeat: patch.repeat !== undefined
        ? patch.repeat
        : item.repeat ? { freq: item.repeat.freq, interval: item.repeat.interval, weekdays: item.repeat.weekdays } : null,
    }, item.date)
    : { date: item.date, time: item.time, repeat: item.repeat };
  const remindChanged = patch.remind !== undefined;
  const title = patch.title !== undefined ? clip(patch.title, TITLE_LIMIT) : item.title;
  const next: LifeItem = {
    ...item,
    title: title || item.title,
    notes: patch.notes !== undefined ? clip(patch.notes, NOTES_LIMIT) : item.notes,
    kind: patch.kind ?? item.kind,
    circleId: patch.circleId !== undefined ? patch.circleId : item.circleId,
    place: patch.place !== undefined ? clip(patch.place, 200) : item.place,
    importance: patch.importance ?? item.importance,
    date: timing.date,
    time: timing.time,
    repeat: timing.repeat,
    remind: patch.remind ?? (timing.date ? item.remind : { kind: 'none' }),
    // A new time or rule means a new reminder moment.
    snoozedUntil: timingChanged || remindChanged ? null : item.snoozedUntil,
    remindedFor: timingChanged || remindChanged ? null : item.remindedFor,
    updatedAt: now.toISOString(),
  };
  return { ...next, history: withEvent(item, 'edited', by, now) };
}

export function completeItem(item: LifeItem, by: Actor, now: Date, note?: string): LifeItem {
  if (item.repeat && item.date) {
    const nextDate = nextOccurrence(item.repeat, item.date);
    return {
      ...item,
      date: nextDate,
      snoozedUntil: null,
      remindedFor: null,
      updatedAt: now.toISOString(),
      history: withEvent(item, 'occurrence-done', by, now, note ?? item.date),
    };
  }
  return {
    ...item,
    state: 'done',
    snoozedUntil: null,
    completedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    history: withEvent(item, 'completed', by, now, note),
  };
}

export function skipOccurrence(item: LifeItem, by: Actor, now: Date): LifeItem {
  if (!item.repeat || !item.date) return dropItem(item, by, now);
  return {
    ...item,
    date: nextOccurrence(item.repeat, item.date),
    snoozedUntil: null,
    remindedFor: null,
    updatedAt: now.toISOString(),
    history: withEvent(item, 'occurrence-skipped', by, now, item.date),
  };
}

export function dropItem(item: LifeItem, by: Actor, now: Date): LifeItem {
  return {
    ...item,
    state: 'dropped',
    snoozedUntil: null,
    completedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    history: withEvent(item, 'dropped', by, now),
  };
}

export function reopenItem(item: LifeItem, by: Actor, now: Date): LifeItem {
  return {
    ...item,
    state: item.decision && item.decision.choice === null ? 'waiting' : 'open',
    completedAt: null,
    remindedFor: null,
    updatedAt: now.toISOString(),
    history: withEvent(item, 'reopened', by, now),
  };
}

export function snoozeItem(item: LifeItem, until: Instant, now: Date): LifeItem {
  return {
    ...item,
    snoozedUntil: until,
    updatedAt: now.toISOString(),
    history: withEvent(item, 'snoozed', 'user', now, until),
  };
}

/** Record that the reminder for `at` reached the user, or passed while NimiDay was closed. */
export function markReminder(item: LifeItem, at: Instant, outcome: 'reminded' | 'missed', now: Date): LifeItem {
  return {
    ...item,
    remindedFor: at,
    snoozedUntil: null,
    updatedAt: now.toISOString(),
    history: withEvent(item, outcome, 'system', now, at),
  };
}

export function decideItem(item: LifeItem, choice: string, now: Date): LifeItem {
  if (!item.decision) return item;
  return {
    ...item,
    decision: { ...item.decision, choice },
    state: 'done',
    completedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    history: withEvent(item, 'decided', 'user', now, choice),
  };
}
