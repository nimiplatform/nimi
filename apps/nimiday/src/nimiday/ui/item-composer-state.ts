import type { ItemDraft } from '../domain/items.js';
import { circleMentioned, parseQuickCapture } from '../domain/quick-capture.js';
import { alignToRepeat, normalizeRepeat } from '../domain/recurrence.js';
import { weekdayOf } from '../domain/time.js';
import type { CareCircle, Importance, ItemKind, LifeItem, RemindRule, RepeatFreq } from '../domain/types.js';

export type RemindChoice = 'none' | 'at-time' | '10' | '30' | '60' | '1440';
export type ItemForm = {
  title: string; kind: ItemKind; circleId: string; date: string; time: string; allDay: boolean;
  repeat: RepeatFreq | 'none'; interval: number; weekdays: number[]; remind: RemindChoice;
  importance: Importance; place: string; notes: string;
};
export type ParsedField = 'date' | 'time' | 'repeat' | 'circleId' | 'kind';
export type ItemComposerState = {
  form: ItemForm;
  text: string;
  locked: ParsedField[];
  detailsOpen: boolean;
  advancedOpen: boolean;
  pendingItemId?: string;
};

function remindChoice(rule: RemindRule | undefined): RemindChoice {
  if (!rule || rule.kind === 'at-time') return 'at-time';
  if (rule.kind === 'none') return 'none';
  return (['10', '30', '60', '1440'] as const).find(value => Number(value) === rule.minutes) ?? '60';
}

// @nimi-authority: definition.nimi.nimiday.assistant.business
export function initialItemComposer(item: LifeItem | null, draft: Partial<ItemDraft> = {}): ItemComposerState {
  const input = item ?? draft;
  return {
    form: {
      title: input.title ?? '', kind: input.kind ?? 'todo', circleId: input.circleId ?? 'none',
      date: input.date ?? '', time: input.time ?? '09:00', allDay: !input.time,
      repeat: input.repeat?.freq ?? 'none', interval: input.repeat?.interval ?? 1,
      weekdays: [...(input.repeat?.weekdays ?? [])], remind: remindChoice(input.remind),
      importance: input.importance ?? 'normal', place: input.place ?? '', notes: input.notes ?? '',
    },
    text: input.title ?? '',
    locked: (['date', 'time', 'repeat', 'circleId', 'kind'] as const).filter(key => input[key] !== undefined),
    detailsOpen: Boolean(item || input.place || input.notes || input.repeat || input.remind),
    advancedOpen: Boolean(item || (input.importance && input.importance !== 'normal')),
  };
}

/** Parsing fills untouched controls; a deliberate field edit always wins. */
export function captureItemText(current: ItemComposerState, text: string, circles: readonly CareCircle[], now: Date): ItemComposerState {
  const parsed = parseQuickCapture(text, now);
  const form = { ...current.form, title: parsed.title };
  const unlocked = (key: ParsedField) => !current.locked.includes(key);
  if (unlocked('date')) form.date = parsed.date ?? '';
  if (unlocked('time')) { form.time = parsed.time ?? '09:00'; form.allDay = !parsed.time; }
  if (unlocked('repeat')) {
    form.repeat = parsed.repeat?.freq ?? 'none'; form.interval = 1; form.weekdays = [...(parsed.repeat?.weekdays ?? [])];
  }
  if (unlocked('kind')) form.kind = parsed.kind;
  if (unlocked('circleId')) form.circleId = circleMentioned(parsed.title, circles) ?? 'none';
  if (unlocked('date') && form.date && form.repeat !== 'none') {
    form.date = alignToRepeat(normalizeRepeat({ freq: form.repeat, interval: form.interval, weekdays: form.weekdays, anchor: form.date }), form.date);
  }
  return { ...current, text, form };
}

/** Once controls are edited, keep the title free of stale natural-language dates. */
export function editItemFields(current: ItemComposerState, patch: Partial<ItemForm>): ItemComposerState {
  const locked = new Set(current.locked);
  if (current.form.date || 'date' in patch) locked.add('date');
  if (current.form.date || 'time' in patch || 'allDay' in patch) locked.add('time');
  if (current.form.repeat !== 'none' || 'repeat' in patch || 'weekdays' in patch || 'interval' in patch) locked.add('repeat');
  if (current.form.circleId !== 'none' || 'circleId' in patch) locked.add('circleId');
  if (current.form.kind !== 'todo' || 'kind' in patch) locked.add('kind');
  return { ...current, text: current.form.title, locked: [...locked], form: { ...current.form, ...patch } };
}

export function itemFormValues(form: ItemForm): ItemDraft {
  const date = form.date || null;
  const remind: RemindRule = !date || form.remind === 'none' ? { kind: 'none' }
    : form.remind === 'at-time' ? { kind: 'at-time' } : { kind: 'before', minutes: Number(form.remind) };
  return {
    title: form.title, kind: form.kind, circleId: form.circleId === 'none' ? null : form.circleId,
    date, time: date && !form.allDay ? form.time : null,
    repeat: date && form.repeat !== 'none' ? {
      freq: form.repeat, interval: Math.max(1, form.interval),
      weekdays: form.repeat === 'weekly' ? (form.weekdays.length ? form.weekdays : [weekdayOf(date)]) : [],
    } : null,
    remind, importance: form.importance, place: form.place, notes: form.notes,
  };
}
