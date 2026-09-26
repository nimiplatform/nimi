import { stillInCare } from './care.js';
import { agentCircleName } from './agent-labels.js';
import { newId } from './ids.js';
import { completeItem, createItem, editItem, type ItemPatch, type RepeatDraft } from './items.js';
import { isOverdue, isActive } from './reminders.js';
import { attentionOrder, coverageGaps, sourceLinkFor, type ActivityCoverage, type SourceChange } from './sources.js';
import { addDays, DAY_MS, isLocalDate, isLocalTime, toLocalDate } from './time.js';
import type {
  CareCircle,
  DayState,
  HandbookNote,
  Importance,
  ItemKind,
  LifeItem,
  Origin,
  RemindRule,
  RepeatFreq,
  RunChange,
} from './types.js';

/** A function skill offered to the on-duty agent for one piece of work. */
export type DayToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
};

export type ToolContext = {
  readonly state: DayState;
  readonly changes: readonly SourceChange[];
  readonly sourcesAvailable: boolean;
  /** What part of the shared activity `changes` was drawn from. */
  readonly sourceCoverage: ActivityCoverage;
  readonly now: Date;
  readonly runId: string;
  readonly agentName: string;
  /** App-owned selection captured when this run was accepted; never supplied by a tool. */
  readonly focusCircleId?: string | null;
};

export type ToolOutcome = {
  readonly result: unknown;
  readonly isError: boolean;
  /** Short, factual description for the run record. */
  readonly summary: string;
  readonly items?: readonly LifeItem[];
  readonly notes?: readonly HandbookNote[];
  readonly change?: RunChange;
  /** An existing item this request turned out to be; like a write, it is confirmed only once saved. */
  readonly confirms?: string;
};

const ITEM_KINDS: readonly ItemKind[] = ['todo', 'appointment', 'reminder', 'follow-up'];
const IMPORTANCE: readonly Importance[] = ['gentle', 'normal', 'important'];
const FREQS: readonly RepeatFreq[] = ['daily', 'weekly', 'monthly', 'yearly'];
const LIST_LIMIT = 40;

const itemFields = {
  title: { type: 'string', maxLength: 200 },
  kind: { type: 'string', enum: ITEM_KINDS },
  circleId: { type: 'string', description: 'Id from day_list_circles; omit when it belongs to no one in particular.' },
  date: { type: 'string', description: 'Local date YYYY-MM-DD.' },
  time: { type: 'string', description: 'Local time HH:MM (24h). Omit for an all-day item.' },
  place: { type: 'string', maxLength: 200 },
  notes: { type: 'string', maxLength: 4000 },
  remindMinutesBefore: {
    type: 'integer',
    minimum: 0,
    maximum: 10080,
    description: '0 reminds at the time itself. All-day items remind in the morning.',
  },
  noReminder: { type: 'boolean', description: 'true turns the reminder off.' },
  repeat: {
    type: 'object',
    properties: {
      freq: { type: 'string', enum: FREQS },
      interval: { type: 'integer', minimum: 1, maximum: 365 },
      weekdays: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, description: '0 = Sunday … 6 = Saturday (weekly only).' },
    },
    required: ['freq'],
    additionalProperties: false,
  },
  importance: {
    type: 'string',
    enum: IMPORTANCE,
    description: 'important may interrupt during quiet hours; gentle never sends a system notification.',
  },
} as const;

export const DAY_TOOLS: readonly DayToolDefinition[] = [
  {
    name: 'day_list_items',
    description: "List the user's life items in NimiDay. Use scope to choose which ones; optionally filter by circleId.",
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['today', 'next7', 'overdue', 'waiting', 'open', 'recent_done'] },
        circleId: { type: 'string' },
      },
      required: ['scope'],
      additionalProperties: false,
    },
  },
  {
    name: 'day_create_item',
    description: 'Create a to-do, appointment, reminder or follow-up in NimiDay, optionally dated, repeating and with a reminder. Tell the user what you created.',
    inputSchema: {
      type: 'object',
      properties: {
        ...itemFields,
        forReminderId: {
          type: 'string',
          description: "Id of another app's reminder (from day_recent_changes or the material) that this item arranges. That reminder stays open in its own app; finishing this item does not finish it.",
        },
        separateFromExisting: {
          type: 'boolean',
          description: 'Create a separate item even though one with the same title, day, time and person already exists.',
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'day_update_item',
    description: "Change an existing item's title, timing, reminder, notes, place, importance or person. Only change what the user wants changed.",
    inputSchema: {
      type: 'object',
      properties: {
        itemId: { type: 'string' },
        ...itemFields,
        forReminderId: { type: 'string', description: "Id of another app's reminder this item arranges (from day_recent_changes or the material)." },
      },
      required: ['itemId'],
      additionalProperties: false,
    },
  },
  {
    name: 'day_complete_item',
    description: 'Mark an item done (a repeating item moves on to its next date). Use only when the user says it is done or asks you to.',
    inputSchema: {
      type: 'object',
      properties: { itemId: { type: 'string' }, note: { type: 'string', maxLength: 500 } },
      required: ['itemId'],
      additionalProperties: false,
    },
  },
  {
    name: 'day_ask_user',
    description: 'Leave a question for the user to decide later in NimiDay, with 2–4 short options. Use it instead of guessing what they want.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', maxLength: 200 },
        options: { type: 'array', items: { type: 'string', maxLength: 80 }, minItems: 2, maxItems: 4 },
        circleId: { type: 'string' },
      },
      required: ['question', 'options'],
      additionalProperties: false,
    },
  },
  {
    name: 'day_list_circles',
    description: 'List the people and areas of life the user asked NimiDay to look after, with what to watch for each.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'day_read_handbook',
    description: "Read the user's household handbook: lasting facts and preferences. Filter by circleId or a keyword.",
    inputSchema: {
      type: 'object',
      properties: { circleId: { type: 'string' }, query: { type: 'string', maxLength: 80 } },
      additionalProperties: false,
    },
  },
  {
    name: 'day_save_note',
    description: 'Add a lasting fact or preference to the household handbook, or update one by noteId. Only save what the user confirmed.',
    inputSchema: {
      type: 'object',
      properties: {
        noteId: { type: 'string' },
        title: { type: 'string', maxLength: 120 },
        body: { type: 'string', maxLength: 4000 },
        circleId: { type: 'string' },
      },
      required: ['title', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'day_recent_changes',
    description: "Read reminders still open and recent changes other Nimi apps shared with the user (reminders, records, an app's interpretations). NimiDay cannot complete them; tell the user where to act.",
    inputSchema: {
      type: 'object',
      properties: { circleId: { type: 'string' }, days: { type: 'integer', minimum: 1, maximum: 30 } },
      additionalProperties: false,
    },
  },
];

export function toolDefinitions(names: readonly string[]): DayToolDefinition[] {
  const wanted = new Set(names);
  return DAY_TOOLS.filter((tool) => wanted.has(tool.name));
}

class ToolInputError extends Error {}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ToolInputError('Arguments must be a JSON object.');
  return value as Record<string, unknown>;
}

function optionalString(args: Record<string, unknown>, key: string, max: number): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ToolInputError(`${key} must be a string.`);
  return value.trim().slice(0, max);
}

function requiredString(args: Record<string, unknown>, key: string, max: number): string {
  const value = optionalString(args, key, max);
  if (!value) throw new ToolInputError(`${key} is required.`);
  return value;
}

function circleName(circles: readonly CareCircle[], id: string | null): string | null {
  const circle = id ? circles.find((entry) => entry.id === id) : undefined;
  return circle ? agentCircleName(circle) : null;
}

function requireCircle(state: DayState, id: string | undefined): string | null | undefined {
  if (id === undefined) return undefined;
  if (!state.circles.some((circle) => circle.id === id)) throw new ToolInputError(`Unknown circleId ${id}. Use day_list_circles.`);
  return id;
}

function describeRemind(rule: RemindRule): string {
  if (rule.kind === 'none') return 'none';
  if (rule.kind === 'at-time') return 'at the time';
  return `${rule.minutes} minutes before`;
}

function describeRepeat(item: LifeItem): string | null {
  if (!item.repeat) return null;
  const every = item.repeat.interval > 1 ? `every ${item.repeat.interval} ` : 'every ';
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[item.repeat.freq];
  const plural = item.repeat.interval > 1 ? `${unit}s` : unit;
  const days = item.repeat.freq === 'weekly' && item.repeat.weekdays.length > 0
    ? ` on ${item.repeat.weekdays.map((day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]).join(',')}`
    : '';
  return `${every}${plural}${days}`;
}

export function itemForAgent(item: LifeItem, circles: readonly CareCircle[], now: Date) {
  return {
    id: item.id,
    title: item.title,
    kind: item.kind,
    circle: circleName(circles, item.circleId),
    circleId: item.circleId,
    date: item.date,
    time: item.time,
    place: item.place || null,
    repeat: describeRepeat(item),
    remind: describeRemind(item.remind),
    importance: item.importance,
    state: item.state,
    overdue: isOverdue(item, now),
    notes: item.notes ? item.notes.slice(0, 500) : null,
    decision: item.decision,
    // NimiDay's own arrangement for another App's reminder; finishing it does not finish that App's business.
    arrangesReminderFrom: item.source ? { app: item.source.appName, reminder: item.source.title } : null,
    addedBy: item.origin.by,
  };
}

function remindFromArgs(args: Record<string, unknown>): RemindRule | undefined {
  if (args.noReminder === true) return { kind: 'none' };
  const minutes = args.remindMinutesBefore;
  if (minutes === undefined || minutes === null) return undefined;
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 0 || minutes > 10080) {
    throw new ToolInputError('remindMinutesBefore must be an integer between 0 and 10080.');
  }
  return minutes === 0 ? { kind: 'at-time' } : { kind: 'before', minutes };
}

function repeatFromArgs(value: unknown): RepeatDraft | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const repeat = record(value);
  if (!FREQS.includes(repeat.freq as RepeatFreq)) throw new ToolInputError('repeat.freq must be daily, weekly, monthly or yearly.');
  const interval = repeat.interval === undefined ? 1 : repeat.interval;
  if (typeof interval !== 'number' || !Number.isInteger(interval) || interval < 1) throw new ToolInputError('repeat.interval must be a positive integer.');
  const weekdays = repeat.weekdays === undefined ? [] : repeat.weekdays;
  if (!Array.isArray(weekdays) || weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new ToolInputError('repeat.weekdays must list integers 0-6.');
  }
  return { freq: repeat.freq as RepeatFreq, interval, weekdays: weekdays as number[] };
}

function itemPatchFromArgs(args: Record<string, unknown>, state: DayState): ItemPatch {
  const date = optionalString(args, 'date', 10);
  if (date !== undefined && !isLocalDate(date)) throw new ToolInputError('date must be YYYY-MM-DD.');
  const time = optionalString(args, 'time', 5);
  if (time !== undefined && !isLocalTime(time)) throw new ToolInputError('time must be HH:MM (24h).');
  const kind = args.kind;
  if (kind !== undefined && !ITEM_KINDS.includes(kind as ItemKind)) throw new ToolInputError('Unknown kind.');
  const importance = args.importance;
  if (importance !== undefined && !IMPORTANCE.includes(importance as Importance)) throw new ToolInputError('Unknown importance.');
  const patch: {
    -readonly [K in keyof ItemPatch]: ItemPatch[K];
  } = {};
  const title = optionalString(args, 'title', 200);
  if (title !== undefined) patch.title = title;
  if (kind !== undefined) patch.kind = kind as ItemKind;
  const circleId = requireCircle(state, optionalString(args, 'circleId', 80));
  if (circleId !== undefined) patch.circleId = circleId;
  if (date !== undefined) patch.date = date;
  if (time !== undefined) patch.time = time;
  const place = optionalString(args, 'place', 200);
  if (place !== undefined) patch.place = place;
  const notes = optionalString(args, 'notes', 4000);
  if (notes !== undefined) patch.notes = notes;
  const remind = remindFromArgs(args);
  if (remind !== undefined) patch.remind = remind;
  const repeat = repeatFromArgs(args.repeat);
  if (repeat !== undefined) patch.repeat = repeat;
  if (importance !== undefined) patch.importance = importance as Importance;
  return patch;
}

function findItem(state: DayState, args: Record<string, unknown>): LifeItem {
  const itemId = requiredString(args, 'itemId', 80);
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new ToolInputError(`No item ${itemId}. Use day_list_items to find current ids.`);
  return item;
}

function replaceItem(items: readonly LifeItem[], next: LifeItem): LifeItem[] {
  return items.map((item) => (item.id === next.id ? next : item));
}

function scopeItems(allState: DayState, scope: string, now: Date): LifeItem[] {
  const state: DayState = { ...allState, items: allState.items.filter(stillInCare(allState.circles)) };
  const today = toLocalDate(now);
  const weekEnd = addDays(today, 7);
  const byTime = (a: LifeItem, b: LifeItem) => `${a.date ?? '9999'}${a.time ?? ''}`.localeCompare(`${b.date ?? '9999'}${b.time ?? ''}`);
  switch (scope) {
    case 'today':
      return state.items.filter((item) => isActive(item) && item.date === today).sort(byTime);
    case 'next7':
      return state.items.filter((item) => isActive(item) && item.date !== null && item.date >= today && item.date <= weekEnd).sort(byTime);
    case 'overdue':
      return state.items.filter((item) => isOverdue(item, now)).sort(byTime);
    case 'waiting':
      return state.items.filter((item) => item.state === 'waiting');
    case 'open':
      return state.items.filter(isActive).sort(byTime);
    case 'recent_done': {
      const since = now.getTime() - 2 * DAY_MS;
      return state.items.filter((item) => (
        ((item.state === 'done' || item.state === 'dropped') && item.completedAt !== null && Date.parse(item.completedAt) >= since)
        || (item.repeat !== null && item.history.some((event) => event.kind === 'occurrence-done' && Date.parse(event.at) >= since))
      ));
    }
    default:
      throw new ToolInputError('scope must be today, next7, overdue, waiting, open or recent_done.');
  }
}

function agentOrigin(context: ToolContext): Origin {
  return { by: 'agent', agentName: context.agentName, runId: context.runId };
}

/** Execute one skill call against NimiDay business state; never throws. */
function comparableTitle(title: string): string {
  return title.trim().replace(/\s+/gu, ' ').toLowerCase();
}

/** Same title, day, time and person: possibly the same entry, to be checked in detail. */
function sameSlot(a: LifeItem, b: LifeItem): boolean {
  return comparableTitle(a.title) === comparableTitle(b.title)
    && a.date === b.date && a.time === b.time && a.circleId === b.circleId;
}

/**
 * How a requested item differs from one already in the same slot, in the
 * terms the agent used; empty when it asks for exactly what is there.
 */
function entryDifferences(existing: LifeItem, requested: LifeItem) {
  const details = (item: LifeItem) => ({
    kind: item.kind,
    repeat: describeRepeat(item),
    remind: describeRemind(item.remind),
    importance: item.importance,
    place: item.place || null,
    notes: item.notes || null,
    arrangesReminderFrom: item.source ? `${item.source.appName}: ${item.source.title}` : null,
  });
  const before = details(existing);
  const after = details(requested);
  const sameSource = (existing.source?.activityId ?? null) === (requested.source?.activityId ?? null);
  return (Object.keys(after) as (keyof typeof after)[])
    .filter((key) => (key === 'arrangesReminderFrom' ? !sameSource : before[key] !== after[key]))
    .map((key) => ({ field: key, existing: before[key], requested: after[key] }));
}

/**
 * What the agent is told when a change it asked for could not be stored. The
 * change stays visible (and queued for the usual save retry), so the agent must
 * neither claim it is done nor ask for it again.
 */
export function notSavedResult(attempted: unknown, reason: string): unknown {
  return {
    error: 'not-saved',
    saved: false,
    message: 'NimiDay shows this change but could not save it, so it would be lost if NimiDay closed. Tell the user plainly that it is not saved yet. NimiDay keeps retrying and offers the user a way to retry saving. Do not make the same change again.',
    reason: reason.slice(0, 200),
    attempted,
  };
}

export function executeDayTool(name: string, rawArgs: unknown, context: ToolContext): ToolOutcome {
  try {
    const args = { ...record(rawArgs) };
    const { state, now } = context;
    // @nimi-authority: rule.nimi.nimiday.assistant.business-effects
    const focus = context.focusCircleId;
    if (focus) {
      if (!state.circles.some(circle => circle.id === focus && circle.status !== 'ended')) throw new ToolInputError('The person selected for this run is no longer available.');
      const selected = optionalString(args, 'circleId', 80);
      if (selected !== undefined && selected !== focus) throw new ToolInputError('This run is limited to the person the user selected.');
      if (['day_list_items', 'day_create_item', 'day_update_item', 'day_ask_user', 'day_read_handbook', 'day_save_note', 'day_recent_changes'].includes(name)) args.circleId = focus;
      if (name === 'day_update_item' || name === 'day_complete_item') {
        const item = findItem(state, args);
        if (item.circleId !== focus) throw new ToolInputError('The requested item is outside this run’s selected person.');
      }
      const noteId = name === 'day_save_note' ? optionalString(args, 'noteId', 80) : undefined;
      if (noteId && state.notes.find(note => note.id === noteId)?.circleId !== focus) throw new ToolInputError('The requested note is outside this run’s selected person.');
      const reminderId = optionalString(args, 'forReminderId', 200);
      if (reminderId && context.changes.find(change => change.id === reminderId)?.circleId !== focus) throw new ToolInputError('The source reminder is outside this run’s selected person.');
    }
    switch (name) {
      case 'day_list_items': {
        const scope = requiredString(args, 'scope', 20);
        const circleId = requireCircle(state, optionalString(args, 'circleId', 80));
        const items = scopeItems(state, scope, now).filter((item) => !circleId || item.circleId === circleId);
        return {
          isError: false,
          summary: `Listed ${items.length} items (${scope})`,
          result: {
            today: toLocalDate(now),
            count: items.length,
            items: items.slice(0, LIST_LIMIT).map((item) => itemForAgent(item, state.circles, now)),
            truncated: items.length > LIST_LIMIT,
          },
        };
      }
      case 'day_create_item': {
        const patch = itemPatchFromArgs(args, state);
        const reminderId = optionalString(args, 'forReminderId', 200);
        const reminder = reminderId ? context.changes.find((change) => change.id === reminderId && change.nature === 'reminder') ?? null : null;
        if (reminderId && !reminder) throw new ToolInputError(`No reminder ${reminderId} among the changes NimiDay has; use an id from day_recent_changes.`);
        const item = createItem({
          ...patch,
          title: requiredString(args, 'title', 200),
          ...(reminder ? { source: sourceLinkFor(reminder) } : {}),
        }, agentOrigin(context), now);
        const existing = args.separateFromExisting === true
          ? undefined
          : state.items.find((candidate) => isActive(candidate) && sameSlot(candidate, item));
        if (existing) {
          const differences = entryDifferences(existing, item);
          if (differences.length === 0) {
            // Exactly what is already there (for example asked again after a save
            // that did not go through): that same entry, confirmed only once saved.
            return {
              isError: false,
              summary: `Already listed “${existing.title}”`,
              result: {
                alreadyListed: itemForAgent(existing, state.circles, now),
                note: 'Exactly this item is already on the list, so nothing new was created.',
              },
              confirms: existing.id,
            };
          }
          // Different wishes for the same slot are never dropped quietly.
          return {
            isError: true,
            summary: `“${existing.title}” is already listed with other details`,
            result: {
              error: 'similar-item-exists',
              existing: itemForAgent(existing, state.circles, now),
              differences,
              message: "Nothing was created. An item with the same title, day, time and person already exists but differs as listed. To change it, call day_update_item with its id (forReminderId links it to another app's reminder). To keep both, call day_create_item again with separateFromExisting: true.",
            },
          };
        }
        return {
          isError: false,
          summary: `Created “${item.title}”`,
          result: { created: itemForAgent(item, state.circles, now) },
          items: [...state.items, item],
          change: { kind: 'item-created', itemId: item.id, title: item.title },
        };
      }
      case 'day_update_item': {
        const before = findItem(state, args);
        const patch = itemPatchFromArgs(args, state);
        const reminderId = optionalString(args, 'forReminderId', 200);
        const reminder = reminderId ? context.changes.find((change) => change.id === reminderId && change.nature === 'reminder') ?? null : null;
        if (reminderId && !reminder) throw new ToolInputError(`No reminder ${reminderId} among the changes NimiDay has; use an id from day_recent_changes.`);
        if (Object.keys(patch).length === 0 && !reminder) throw new ToolInputError('Nothing to change.');
        const edited = editItem(before, patch, 'agent', now);
        const next = reminder ? { ...edited, source: sourceLinkFor(reminder) } : edited;
        return {
          isError: false,
          summary: `Updated “${next.title}”`,
          result: { updated: itemForAgent(next, state.circles, now) },
          items: replaceItem(state.items, next),
          change: { kind: 'item-updated', itemId: next.id, title: next.title, before },
        };
      }
      case 'day_complete_item': {
        const before = findItem(state, args);
        if (!isActive(before)) throw new ToolInputError('That item is already closed.');
        const next = completeItem(before, 'agent', now, optionalString(args, 'note', 500));
        return {
          isError: false,
          summary: `Completed “${next.title}”`,
          result: { completed: itemForAgent(next, state.circles, now), nextDate: next.repeat ? next.date : null },
          items: replaceItem(state.items, next),
          change: { kind: 'item-completed', itemId: next.id, title: next.title, before },
        };
      }
      case 'day_ask_user': {
        const question = requiredString(args, 'question', 200);
        const options = args.options;
        if (!Array.isArray(options) || options.length < 2 || options.length > 4 || options.some((option) => typeof option !== 'string' || !option.trim())) {
          throw new ToolInputError('options must be 2-4 non-empty strings.');
        }
        const circleId = requireCircle(state, optionalString(args, 'circleId', 80)) ?? null;
        const item = createItem({
          title: question,
          kind: 'follow-up',
          circleId,
          decision: { question, options: options.map((option: string) => option.trim().slice(0, 80)), choice: null },
        }, agentOrigin(context), now);
        return {
          isError: false,
          summary: `Asked “${question}”`,
          result: { asked: true, itemId: item.id, status: 'waiting_for_user' },
          items: [...state.items, item],
          change: { kind: 'decision-asked', itemId: item.id, title: question },
        };
      }
      case 'day_list_circles': {
        const circles = state.circles.filter((circle) => circle.status !== 'ended' && (!focus || circle.id === focus));
        return {
          isError: false,
          summary: `Listed ${circles.length} circles`,
          result: {
            circles: circles.map((circle) => ({
              id: circle.id,
              name: agentCircleName(circle),
              kind: circle.kind,
              watch: circle.watch,
              focus: circle.focus,
              status: circle.status,
              openItems: state.items.filter((item) => item.circleId === circle.id && isActive(item)).length,
            })),
          },
        };
      }
      case 'day_read_handbook': {
        const circleId = requireCircle(state, optionalString(args, 'circleId', 80));
        const query = optionalString(args, 'query', 80)?.toLowerCase();
        const inCare = stillInCare(state.circles);
        const notes = state.notes.filter((note) => inCare(note) && (!circleId || note.circleId === circleId)
          && (!query || `${note.title}\n${note.body}`.toLowerCase().includes(query)));
        return {
          isError: false,
          summary: `Read ${notes.length} handbook notes`,
          result: {
            notes: notes.slice(0, 30).map((note) => ({
              id: note.id,
              title: note.title,
              body: note.body.slice(0, 1500),
              circle: circleName(state.circles, note.circleId),
              updatedAt: note.updatedAt,
            })),
          },
        };
      }
      case 'day_save_note': {
        const title = requiredString(args, 'title', 120);
        const body = requiredString(args, 'body', 4000);
        const circleId = requireCircle(state, optionalString(args, 'circleId', 80));
        const noteId = optionalString(args, 'noteId', 80);
        const before = noteId ? state.notes.find((note) => note.id === noteId) ?? null : null;
        if (noteId && !before) throw new ToolInputError(`No note ${noteId}.`);
        const note: HandbookNote = before
          ? { ...before, title, body, circleId: circleId === undefined ? before.circleId : circleId, updatedAt: now.toISOString() }
          : {
            id: newId('note', now),
            circleId: circleId ?? null,
            title,
            body,
            pinned: false,
            origin: agentOrigin(context),
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          };
        const notes = before ? state.notes.map((candidate) => (candidate.id === note.id ? note : candidate)) : [...state.notes, note];
        return {
          isError: false,
          summary: `${before ? 'Updated' : 'Saved'} note “${title}”`,
          result: { saved: { id: note.id, title: note.title } },
          notes,
          change: { kind: 'note-saved', noteId: note.id, title, before },
        };
      }
      case 'day_recent_changes': {
        if (!context.sourcesAvailable) {
          return {
            isError: false,
            summary: 'Recent changes unavailable',
            result: { available: false, reason: "NimiDay cannot read other apps' shared activity right now." },
          };
        }
        const circleId = requireCircle(state, optionalString(args, 'circleId', 80));
        const days = typeof args.days === 'number' && Number.isInteger(args.days) ? Math.min(30, Math.max(1, args.days)) : 7;
        const since = now.getTime() - days * DAY_MS;
        const inCare = stillInCare(state.circles);
        const changes = attentionOrder(context.changes.filter((change) => inCare(change) && ((change.nature === 'reminder' && change.todoState === 'open')
          || Date.parse(change.occurredAt) >= since) && (!circleId || change.circleId === circleId)));
        const listed = changes.slice(0, LIST_LIMIT);
        // Every layer that left something out is named: what was loaded, and what was cut here.
        const gaps = [
          ...coverageGaps(context.sourceCoverage, 'en'),
          ...(changes.length > listed.length ? [`Only the first ${listed.length} of ${changes.length} matching changes are listed, open reminders first.`] : []),
        ];
        return {
          isError: false,
          summary: `Read ${listed.length} of ${changes.length} recent changes`,
          result: {
            available: true,
            days,
            matched: changes.length,
            listed: listed.length,
            complete: gaps.length === 0,
            ...(gaps.length > 0 ? { gaps } : {}),
            changes: listed.map((change) => ({
              id: change.id,
              source: change.appName,
              nature: change.nature,
              title: change.title,
              summary: change.summary,
              occurredAt: change.occurredAt,
              todoState: change.todoState,
              circle: circleName(state.circles, change.circleId),
              completeIn: change.nature === 'reminder' ? change.appName : null,
            })),
          },
        };
      }
      default:
        return { isError: true, summary: `Unknown skill ${name}`, result: { error: `NimiDay has no skill named ${name}.` } };
    }
  } catch (error) {
    const message = error instanceof ToolInputError ? error.message : 'NimiDay could not carry out this request.';
    return { isError: true, summary: `${name}: ${message}`, result: { error: message } };
  }
}
