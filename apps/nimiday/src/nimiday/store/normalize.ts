import { DEFAULT_PROFILE } from '../domain/defaults.js';
import { normalizeRepeat } from '../domain/recurrence.js';
import { isLocalDate, isLocalTime } from '../domain/time.js';
import type {
  Appointment,
  CareCircle,
  CircleKind,
  DayProfile,
  HandbookNote,
  Importance,
  ItemEvent,
  ItemKind,
  ItemState,
  LifeItem,
  Origin,
  RemindRule,
  Repeat,
  Rhythm,
  RhythmDays,
  RunState,
  SkillDefinition,
  SkillLesson,
  SkillOverride,
  SkillRun,
} from '../domain/types.js';

type Raw = Record<string, unknown>;

function obj(value: unknown): Raw | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : null;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function list<T>(value: unknown, map: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const entry of value) {
    const mapped = map(entry);
    if (mapped !== null) out.push(mapped);
  }
  return out;
}

function stringList(value: unknown): string[] {
  return list(value, (entry) => (typeof entry === 'string' ? entry : null));
}

function origin(value: unknown): Origin {
  const raw = obj(value);
  if (raw?.by === 'agent') return { by: 'agent', agentName: str(raw.agentName, '?'), runId: strOrNull(raw.runId) };
  if (raw?.by === 'rhythm') return { by: 'rhythm', rhythmId: str(raw.rhythmId) };
  return { by: 'user' };
}

const CIRCLE_KINDS: readonly CircleKind[] = ['child', 'elder', 'partner', 'self', 'home', 'pet', 'health', 'money', 'other'];

export function normalizeCircle(value: unknown): CareCircle | null {
  const raw = obj(value);
  if (!raw || typeof raw.id !== 'string' || !str(raw.name).trim()) return null;
  return {
    id: raw.id,
    kind: oneOf(raw.kind, CIRCLE_KINDS, 'other'),
    name: str(raw.name).trim(),
    watch: str(raw.watch),
    focus: stringList(raw.focus),
    status: oneOf(raw.status, ['active', 'paused', 'ended'] as const, 'active'),
    createdAt: str(raw.createdAt, new Date(0).toISOString()),
    updatedAt: str(raw.updatedAt, new Date(0).toISOString()),
  };
}

function remindRule(value: unknown): RemindRule {
  const raw = obj(value);
  if (raw?.kind === 'at-time') return { kind: 'at-time' };
  if (raw?.kind === 'before' && typeof raw.minutes === 'number' && raw.minutes >= 0) return { kind: 'before', minutes: Math.floor(raw.minutes) };
  return { kind: 'none' };
}

function repeat(value: unknown): Repeat | null {
  const raw = obj(value);
  if (!raw || !isLocalDate(raw.anchor)) return null;
  const freq = oneOf(raw.freq, ['daily', 'weekly', 'monthly', 'yearly'] as const, 'weekly');
  return normalizeRepeat({
    freq,
    interval: typeof raw.interval === 'number' ? raw.interval : 1,
    weekdays: list(raw.weekdays, (entry) => (typeof entry === 'number' ? entry : null)),
    anchor: raw.anchor,
  });
}

function itemEvent(value: unknown): ItemEvent | null {
  const raw = obj(value);
  if (!raw || typeof raw.at !== 'string' || typeof raw.kind !== 'string') return null;
  const event = {
    at: raw.at,
    kind: raw.kind as ItemEvent['kind'],
    by: oneOf(raw.by, ['user', 'agent', 'system'] as const, 'system'),
  };
  return typeof raw.note === 'string' ? { ...event, note: raw.note } : event;
}

function sourceLink(value: unknown): { source?: LifeItem['source'] } {
  const link = obj(value);
  if (!link || typeof link.appId !== 'string' || typeof link.activityId !== 'string') return {};
  return {
    source: {
      appId: link.appId,
      appName: str(link.appName, link.appId),
      activityId: link.activityId,
      objectKey: strOrNull(link.objectKey),
      title: str(link.title),
    },
  };
}

export function normalizeItem(value: unknown): LifeItem | null {
  const raw = obj(value);
  if (!raw || typeof raw.id !== 'string' || !str(raw.title).trim()) return null;
  const date = isLocalDate(raw.date) ? raw.date : null;
  const decisionRaw = obj(raw.decision);
  return {
    id: raw.id,
    title: str(raw.title).trim(),
    notes: str(raw.notes),
    kind: oneOf<ItemKind>(raw.kind, ['todo', 'appointment', 'reminder', 'follow-up'], 'todo'),
    circleId: strOrNull(raw.circleId),
    date,
    time: date && isLocalTime(raw.time) ? raw.time : null,
    place: str(raw.place),
    repeat: date ? repeat(raw.repeat) : null,
    remind: remindRule(raw.remind),
    importance: oneOf<Importance>(raw.importance, ['gentle', 'normal', 'important'], 'normal'),
    state: oneOf<ItemState>(raw.state, ['open', 'waiting', 'done', 'dropped'], 'open'),
    snoozedUntil: strOrNull(raw.snoozedUntil),
    remindedFor: strOrNull(raw.remindedFor),
    decision: decisionRaw && typeof decisionRaw.question === 'string'
      ? { question: decisionRaw.question, options: stringList(decisionRaw.options), choice: strOrNull(decisionRaw.choice) }
      : null,
    ...sourceLink(raw.source),
    origin: origin(raw.origin),
    createdAt: str(raw.createdAt, new Date(0).toISOString()),
    updatedAt: str(raw.updatedAt, new Date(0).toISOString()),
    completedAt: strOrNull(raw.completedAt),
    history: list(raw.history, itemEvent),
  };
}

export function normalizeNote(value: unknown): HandbookNote | null {
  const raw = obj(value);
  if (!raw || typeof raw.id !== 'string' || !str(raw.title).trim()) return null;
  return {
    id: raw.id,
    circleId: strOrNull(raw.circleId),
    title: str(raw.title).trim(),
    body: str(raw.body),
    pinned: bool(raw.pinned, false),
    origin: origin(raw.origin),
    createdAt: str(raw.createdAt, new Date(0).toISOString()),
    updatedAt: str(raw.updatedAt, new Date(0).toISOString()),
  };
}

export function normalizeRhythm(value: unknown): Rhythm | null {
  const raw = obj(value);
  const schedule = obj(raw?.schedule);
  if (!raw || typeof raw.id !== 'string' || typeof raw.skillId !== 'string' || !schedule) return null;
  return {
    id: raw.id,
    skillId: raw.skillId,
    name: str(raw.name, raw.skillId),
    enabled: bool(raw.enabled, false),
    schedule: {
      days: oneOf<RhythmDays>(schedule.days, ['daily', 'weekdays', 'weekends', 'custom'], 'daily'),
      weekdays: list(schedule.weekdays, (entry) => (typeof entry === 'number' && entry >= 0 && entry <= 6 ? entry : null)),
      time: isLocalTime(schedule.time) ? schedule.time : '08:00',
    },
    start: oneOf(raw.start, ['ask', 'auto'] as const, 'ask'),
    notify: bool(raw.notify, true),
    handledFor: strOrNull(raw.handledFor),
    createdAt: str(raw.createdAt, new Date(0).toISOString()),
    updatedAt: str(raw.updatedAt, new Date(0).toISOString()),
  };
}

function lessons(value: unknown): SkillLesson[] {
  return list(value, (entry) => {
    const raw = obj(entry);
    return raw && typeof raw.id === 'string' && str(raw.text).trim()
      ? { id: raw.id, text: str(raw.text).trim(), addedAt: str(raw.addedAt, new Date(0).toISOString()) }
      : null;
  }).slice(-20);
}

export function normalizeOverride(value: unknown): SkillOverride | null {
  const raw = obj(value);
  if (!raw || typeof raw.skillId !== 'string') return null;
  return {
    skillId: raw.skillId,
    ...(typeof raw.instructions === 'string' ? { instructions: raw.instructions } : {}),
    ...(typeof raw.request === 'string' ? { request: raw.request } : {}),
    ...(typeof raw.enabled === 'boolean' ? { enabled: raw.enabled } : {}),
    ...(Array.isArray(raw.lessons) ? { lessons: lessons(raw.lessons) } : {}),
    updatedAt: str(raw.updatedAt, new Date(0).toISOString()),
  };
}

export function normalizeCustomSkill(value: unknown): SkillDefinition | null {
  const raw = obj(value);
  if (!raw || typeof raw.id !== 'string' || !str(raw.name).trim()) return null;
  return {
    id: raw.id,
    builtIn: false,
    icon: str(raw.icon, 'sparkles'),
    name: str(raw.name).trim(),
    purpose: str(raw.purpose),
    instructions: str(raw.instructions),
    request: str(raw.request),
    tools: stringList(raw.tools),
    materials: stringList(raw.materials) as SkillDefinition['materials'],
    enabled: bool(raw.enabled, true),
    updatedAt: strOrNull(raw.updatedAt),
    lessons: lessons(raw.lessons),
  };
}

const RUN_STATES: readonly RunState[] = ['waiting-start', 'queued', 'running', 'done', 'failed', 'interrupted', 'missed', 'dismissed'];

export function normalizeRun(value: unknown): SkillRun | null {
  const raw = obj(value);
  if (!raw || typeof raw.id !== 'string' || typeof raw.skillId !== 'string') return null;
  const errorRaw = obj(raw.error);
  let state = oneOf(raw.state, RUN_STATES, 'failed');
  // A run cannot still be executing after NimiDay restarts; its outcome is unknown.
  if (state === 'running' || state === 'queued') state = 'interrupted';
  return {
    id: raw.id,
    skillId: raw.skillId,
    skillName: str(raw.skillName, raw.skillId),
    trigger: oneOf(raw.trigger, ['user', 'rhythm', 'chat'] as const, 'user'),
    rhythmId: strOrNull(raw.rhythmId),
    scheduledFor: strOrNull(raw.scheduledFor),
    state,
    agentName: strOrNull(raw.agentName),
    requestText: str(raw.requestText),
    turnId: strOrNull(raw.turnId),
    createdAt: str(raw.createdAt, new Date(0).toISOString()),
    startedAt: strOrNull(raw.startedAt),
    finishedAt: strOrNull(raw.finishedAt),
    toolCalls: list(raw.toolCalls, (entry) => {
      const call = obj(entry);
      return call && typeof call.callId === 'string'
        ? { callId: call.callId, name: str(call.name), summary: str(call.summary), ok: bool(call.ok, false), at: str(call.at), ...(call.unsaved === true ? { unsaved: true } : {}) }
        : null;
    }),
    changes: Array.isArray(raw.changes) ? (raw.changes as SkillRun['changes']) : [],
    undone: bool(raw.undone, false),
    replyMessageId: strOrNull(raw.replyMessageId),
    replyText: strOrNull(raw.replyText),
    ...(typeof raw.focusCircleId === 'string' ? { focusCircleId: raw.focusCircleId } : {}),
    error: errorRaw ? { code: str(errorRaw.code, 'unknown'), message: str(errorRaw.message) } : null,
  };
}

function appointment(value: unknown): Appointment | null {
  const raw = obj(value);
  if (!raw || !str(raw.displayName).trim()) return null;
  return {
    displayName: str(raw.displayName).trim(),
    avatarUrl: strOrNull(raw.avatarUrl),
    binding: strOrNull(raw.binding),
    appointedAt: str(raw.appointedAt, new Date(0).toISOString()),
  };
}

export function normalizeProfile(value: unknown): DayProfile {
  const raw = obj(value);
  if (!raw) return DEFAULT_PROFILE;
  const quiet = obj(raw.quiet);
  return {
    appointment: appointment(raw.appointment),
    appointmentHistory: list(raw.appointmentHistory, (entry) => {
      const record = obj(entry);
      return record && typeof record.displayName === 'string'
        ? { displayName: record.displayName, from: str(record.from), to: strOrNull(record.to) }
        : null;
    }),
    quiet: {
      enabled: bool(quiet?.enabled, DEFAULT_PROFILE.quiet.enabled),
      start: isLocalTime(quiet?.start) ? quiet.start : DEFAULT_PROFILE.quiet.start,
      end: isLocalTime(quiet?.end) ? quiet.end : DEFAULT_PROFILE.quiet.end,
    },
    systemNotifications: bool(raw.systemNotifications, DEFAULT_PROFILE.systemNotifications),
    homeMessages: bool(raw.homeMessages, DEFAULT_PROFILE.homeMessages),
    allDayRemindTime: isLocalTime(raw.allDayRemindTime) ? raw.allDayRemindTime : DEFAULT_PROFILE.allDayRemindTime,
    theme: oneOf(raw.theme, ['system', 'light', 'dark'] as const, 'system'),
    language: oneOf(raw.language, ['auto', 'zh', 'en'] as const, 'auto'),
    onboarded: bool(raw.onboarded, false),
    sources: list(raw.sources, (entry) => {
      const record = obj(entry);
      return record && typeof record.appId === 'string'
        ? { appId: record.appId, enabled: bool(record.enabled, true), circleId: strOrNull(record.circleId) }
        : null;
    }),
    sourceGroups: list(raw.sourceGroups, (entry) => {
      const record = obj(entry);
      return record && typeof record.key === 'string' && record.key.length <= 512 && typeof record.appId === 'string'
        ? { key: record.key, appId: record.appId, circleId: strOrNull(record.circleId) }
        : null;
    }).slice(-200),
    hiddenSourceIds: stringList(raw.hiddenSourceIds).slice(-500),
    lastActiveAt: strOrNull(raw.lastActiveAt),
  };
}

export { list as normalizeList };
