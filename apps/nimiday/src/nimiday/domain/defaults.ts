import { newId } from './ids.js';
import { EVENING_WRAP_SKILL, MORNING_CARE_SKILL, WEEK_PLAN_SKILL } from './skills.js';
import type { CareCircle, CircleKind, DayProfile, DayState, Language, Rhythm } from './types.js';

export const DEFAULT_PROFILE: DayProfile = {
  appointment: null,
  appointmentHistory: [],
  quiet: { enabled: true, start: '22:00', end: '07:30' },
  systemNotifications: true,
  homeMessages: true,
  allDayRemindTime: '08:30',
  theme: 'system',
  language: 'auto',
  onboarded: false,
  sources: [],
  sourceGroups: [],
  hiddenSourceIds: [],
  lastActiveAt: null,
};

const RHYTHM_NAMES: Readonly<Record<Language, Readonly<Record<string, string>>>> = {
  zh: { [MORNING_CARE_SKILL]: '晨间照看', [EVENING_WRAP_SKILL]: '晚间收尾', [WEEK_PLAN_SKILL]: '周日看下周' },
  en: { [MORNING_CARE_SKILL]: 'Morning care', [EVENING_WRAP_SKILL]: 'Evening wrap-up', [WEEK_PLAN_SKILL]: 'Sunday week ahead' },
};

/** The three everyday rhythms NimiDay offers; each starts switched off. */
export function starterRhythms(language: Language, now: Date): Rhythm[] {
  const at = now.toISOString();
  const make = (skillId: string, schedule: Rhythm['schedule']): Rhythm => ({
    id: newId('rhythm', now),
    skillId,
    name: RHYTHM_NAMES[language][skillId] ?? skillId,
    enabled: false,
    schedule,
    start: 'ask',
    notify: true,
    handledFor: null,
    createdAt: at,
    updatedAt: at,
  });
  return [
    make(MORNING_CARE_SKILL, { days: 'daily', weekdays: [], time: '07:40' }),
    make(EVENING_WRAP_SKILL, { days: 'daily', weekdays: [], time: '21:30' }),
    make(WEEK_PLAN_SKILL, { days: 'custom', weekdays: [0], time: '19:30' }),
  ];
}

export function emptyState(language: Language, now: Date): DayState {
  return {
    profile: DEFAULT_PROFILE,
    circles: [],
    items: [],
    notes: [],
    rhythms: starterRhythms(language, now),
    skillOverrides: [],
    customSkills: [],
    runs: [],
  };
}

export type CircleTemplate = {
  readonly kind: CircleKind;
  readonly icon: string;
};

export const CIRCLE_TEMPLATES: readonly CircleTemplate[] = [
  { kind: 'child', icon: 'baby' },
  { kind: 'elder', icon: 'hand-heart' },
  { kind: 'partner', icon: 'heart' },
  { kind: 'self', icon: 'user-round' },
  { kind: 'home', icon: 'house' },
  { kind: 'health', icon: 'stethoscope' },
  { kind: 'pet', icon: 'paw-print' },
  { kind: 'money', icon: 'wallet' },
  { kind: 'other', icon: 'sparkles' },
];

export function createCircle(input: {
  kind: CircleKind;
  name: string;
  watch?: string;
  focus?: readonly string[];
}, now: Date): CareCircle {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new Error('circle-name-required');
  return {
    id: newId('circle', now),
    kind: input.kind,
    name,
    watch: (input.watch ?? '').trim().slice(0, 1000),
    focus: (input.focus ?? []).map((tag) => tag.trim().slice(0, 30)).filter(Boolean).slice(0, 8),
    status: 'active',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}
