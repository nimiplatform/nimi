import { createCircle } from '../domain/defaults.js';
import { newId } from '../domain/ids.js';
import {
  completeItem,
  createItem,
  decideItem,
  dropItem,
  editItem,
  reopenItem,
  skipOccurrence,
  snoozeItem,
  type ItemDraft,
  type ItemPatch,
} from '../domain/items.js';
import { handledMarkForEnable } from '../domain/rhythms.js';
import type {
  Appointment,
  CareCircle,
  CircleKind,
  CircleStatus,
  DayProfile,
  DayState,
  HandbookNote,
  Instant,
  LifeItem,
  Rhythm,
  RhythmSchedule,
  RhythmStart,
  SkillDefinition,
  SkillOverride,
  SkillRun,
  SourceGroupPreference,
  SourcePreference,
} from '../domain/types.js';
import type { DayStore } from './day-store.js';

function replaceById<T extends { readonly id: string }>(list: readonly T[], id: string, map: (entry: T) => T): T[] {
  return list.map((entry) => (entry.id === id ? map(entry) : entry));
}

export function dayActions(store: DayStore, now: () => Date = () => new Date()) {
  const items = (map: (list: readonly LifeItem[]) => readonly LifeItem[]) =>
    store.update((state) => ({ ...state, items: map(state.items) }), ['items']);
  const item = (id: string, map: (entry: LifeItem) => LifeItem) => items((list) => replaceById(list, id, map));
  const profile = (patch: Partial<DayProfile> | ((current: DayProfile) => DayProfile)) =>
    store.update((state) => ({
      ...state,
      profile: typeof patch === 'function' ? patch(state.profile) : { ...state.profile, ...patch },
    }), ['profile']);

  return {
    // Items -----------------------------------------------------------------
    addItem: (draft: ItemDraft): LifeItem => {
      const created = createItem(draft, { by: 'user' }, now());
      items((list) => [...list, created]);
      return created;
    },
    editItem: (id: string, patch: ItemPatch) => item(id, (entry) => editItem(entry, patch, 'user', now())),
    completeItem: (id: string) => item(id, (entry) => completeItem(entry, 'user', now())),
    skipOccurrence: (id: string) => item(id, (entry) => skipOccurrence(entry, 'user', now())),
    dropItem: (id: string) => item(id, (entry) => dropItem(entry, 'user', now())),
    reopenItem: (id: string) => item(id, (entry) => reopenItem(entry, 'user', now())),
    snoozeItem: (id: string, until: Instant) => item(id, (entry) => snoozeItem(entry, until, now())),
    decide: (id: string, choice: string) => item(id, (entry) => decideItem(entry, choice, now())),
    deleteItem: (id: string) => items((list) => list.filter((entry) => entry.id !== id)),

    // Care circles ----------------------------------------------------------
    addCircle: (input: { kind: CircleKind; name: string; watch?: string; focus?: readonly string[] }): CareCircle => {
      const circle = createCircle(input, now());
      store.update((state) => ({ ...state, circles: [...state.circles, circle] }), ['circles']);
      return circle;
    },
    editCircle: (id: string, patch: Partial<Pick<CareCircle, 'name' | 'kind' | 'watch' | 'focus'>>) =>
      store.update((state) => ({
        ...state,
        circles: replaceById(state.circles, id, (circle) => ({
          ...circle,
          ...patch,
          name: patch.name !== undefined ? patch.name.trim().slice(0, 60) || circle.name : circle.name,
          updatedAt: now().toISOString(),
        })),
      }), ['circles']),
    setCircleStatus: (id: string, status: CircleStatus) =>
      store.update((state) => ({
        ...state,
        circles: replaceById(state.circles, id, (circle) => ({ ...circle, status, updatedAt: now().toISOString() })),
      }), ['circles']),
    deleteCircle: (id: string) =>
      store.update((state) => ({
        ...state,
        circles: state.circles.filter((circle) => circle.id !== id),
        items: state.items.map((entry) => (entry.circleId === id ? { ...entry, circleId: null } : entry)),
        notes: state.notes.map((note) => (note.circleId === id ? { ...note, circleId: null } : note)),
        profile: {
          ...state.profile,
          sources: state.profile.sources.map((source) => (source.circleId === id ? { ...source, circleId: null } : source)),
        },
      }), ['circles', 'items', 'notes', 'profile']),

    // Handbook --------------------------------------------------------------
    saveNote: (input: { id?: string; circleId: string | null; title: string; body: string; pinned?: boolean }): HandbookNote => {
      const at = now().toISOString();
      let saved: HandbookNote | null = null;
      store.update((state) => {
        const existing = input.id ? state.notes.find((note) => note.id === input.id) : undefined;
        saved = existing
          ? { ...existing, circleId: input.circleId, title: input.title.trim().slice(0, 120), body: input.body.slice(0, 4000), pinned: input.pinned ?? existing.pinned, updatedAt: at }
          : {
            id: newId('note', now()),
            circleId: input.circleId,
            title: input.title.trim().slice(0, 120),
            body: input.body.slice(0, 4000),
            pinned: input.pinned ?? false,
            origin: { by: 'user' },
            createdAt: at,
            updatedAt: at,
          };
        const next = saved;
        return { ...state, notes: existing ? replaceById(state.notes, next.id, () => next) : [...state.notes, next] };
      }, ['notes']);
      return saved!;
    },
    deleteNote: (id: string) => store.update((state) => ({ ...state, notes: state.notes.filter((note) => note.id !== id) }), ['notes']),
    toggleNotePin: (id: string) =>
      store.update((state) => ({ ...state, notes: replaceById(state.notes, id, (note) => ({ ...note, pinned: !note.pinned })) }), ['notes']),

    // Rhythms ---------------------------------------------------------------
    setRhythmEnabled: (id: string, enabled: boolean) =>
      store.update((state) => ({
        ...state,
        rhythms: replaceById(state.rhythms, id, (rhythm) => ({
          ...rhythm,
          enabled,
          // Switching on never owes the occurrence that already passed today.
          handledFor: enabled ? handledMarkForEnable(rhythm.schedule, now()) : rhythm.handledFor,
          updatedAt: now().toISOString(),
        })),
      }), ['rhythms']),
    editRhythm: (id: string, patch: { name?: string; schedule?: RhythmSchedule; start?: RhythmStart; notify?: boolean }) =>
      store.update((state) => ({
        ...state,
        rhythms: replaceById(state.rhythms, id, (rhythm) => {
          const schedule = patch.schedule ?? rhythm.schedule;
          return {
            ...rhythm,
            name: patch.name?.trim() ? patch.name.trim().slice(0, 60) : rhythm.name,
            schedule,
            start: patch.start ?? rhythm.start,
            notify: patch.notify ?? rhythm.notify,
            handledFor: patch.schedule ? handledMarkForEnable(schedule, now()) : rhythm.handledFor,
            updatedAt: now().toISOString(),
          };
        }),
      }), ['rhythms']),
    addRhythm: (input: { skillId: string; name: string; schedule: RhythmSchedule }): Rhythm => {
      const at = now();
      const rhythm: Rhythm = {
        id: newId('rhythm', at),
        skillId: input.skillId,
        name: input.name.trim().slice(0, 60) || input.skillId,
        enabled: true,
        schedule: input.schedule,
        start: 'ask',
        notify: true,
        handledFor: handledMarkForEnable(input.schedule, at),
        createdAt: at.toISOString(),
        updatedAt: at.toISOString(),
      };
      store.update((state) => ({ ...state, rhythms: [...state.rhythms, rhythm] }), ['rhythms']);
      return rhythm;
    },
    deleteRhythm: (id: string) => store.update((state) => ({ ...state, rhythms: state.rhythms.filter((rhythm) => rhythm.id !== id) }), ['rhythms']),

    // Skills ----------------------------------------------------------------
    adjustSkill: (skillId: string, patch: Omit<SkillOverride, 'skillId' | 'updatedAt'>) =>
      store.update((state) => {
        const existing = state.skillOverrides.find((override) => override.skillId === skillId);
        const next: SkillOverride = { ...(existing ?? {}), ...patch, skillId, updatedAt: now().toISOString() };
        return {
          ...state,
          skillOverrides: existing
            ? state.skillOverrides.map((override) => (override.skillId === skillId ? next : override))
            : [...state.skillOverrides, next],
        };
      }, ['skills']),
    addLesson: (skillId: string, text: string) => {
      const lesson = { id: newId('lesson', now()), text: text.trim().slice(0, 300), addedAt: now().toISOString() };
      if (!lesson.text) return;
      store.update((state) => {
        const custom = state.customSkills.find((skill) => skill.id === skillId);
        if (custom) {
          return { ...state, customSkills: replaceById(state.customSkills, skillId, (skill) => ({ ...skill, lessons: [...skill.lessons, lesson].slice(-20), updatedAt: now().toISOString() })) };
        }
        const existing = state.skillOverrides.find((override) => override.skillId === skillId);
        const next: SkillOverride = { ...(existing ?? { skillId }), lessons: [...(existing?.lessons ?? []), lesson].slice(-20), updatedAt: now().toISOString() };
        return {
          ...state,
          skillOverrides: existing ? state.skillOverrides.map((override) => (override.skillId === skillId ? next : override)) : [...state.skillOverrides, next],
        };
      }, ['skills']);
    },
    removeLesson: (skillId: string, lessonId: string) =>
      store.update((state) => ({
        ...state,
        customSkills: state.customSkills.map((skill) => (skill.id === skillId ? { ...skill, lessons: skill.lessons.filter((lesson) => lesson.id !== lessonId) } : skill)),
        skillOverrides: state.skillOverrides.map((override) => (override.skillId === skillId && override.lessons
          ? { ...override, lessons: override.lessons.filter((lesson) => lesson.id !== lessonId), updatedAt: now().toISOString() }
          : override)),
      }), ['skills']),
    resetSkill: (skillId: string) =>
      store.update((state) => ({
        ...state,
        skillOverrides: state.skillOverrides
          .map((override) => (override.skillId === skillId
            ? { skillId, ...(override.enabled !== undefined ? { enabled: override.enabled } : {}), ...(override.lessons ? { lessons: override.lessons } : {}), updatedAt: now().toISOString() }
            : override)),
      }), ['skills']),
    saveCustomSkill: (skill: Omit<SkillDefinition, 'builtIn' | 'updatedAt' | 'id' | 'lessons'> & { id?: string; lessons?: SkillDefinition['lessons'] }): SkillDefinition => {
      const id = skill.id ?? newId('skill', now());
      // Editing the method keeps what this household has learned; lessons are
      // only removed through their own delete action.
      const kept = store.getSnapshot().state.customSkills.find((entry) => entry.id === id)?.lessons ?? [];
      const saved: SkillDefinition = { ...skill, lessons: skill.lessons ?? kept, id, builtIn: false, updatedAt: now().toISOString() };
      store.update((state) => ({
        ...state,
        customSkills: state.customSkills.some((entry) => entry.id === saved.id)
          ? replaceById(state.customSkills, saved.id, (current) => ({ ...saved, lessons: skill.lessons ?? current.lessons }))
          : [...state.customSkills, saved],
      }), ['skills']);
      return saved;
    },
    deleteCustomSkill: (id: string) =>
      store.update((state) => ({
        ...state,
        customSkills: state.customSkills.filter((skill) => skill.id !== id),
        rhythms: state.rhythms.filter((rhythm) => rhythm.skillId !== id),
      }), ['skills', 'rhythms']),

    // Runs ------------------------------------------------------------------
    putRun: (run: SkillRun) =>
      store.update((state) => ({
        ...state,
        runs: state.runs.some((entry) => entry.id === run.id) ? replaceById(state.runs, run.id, () => run) : [...state.runs, run],
      }), ['runs']),
    patchRun: (id: string, patch: Partial<SkillRun> | ((run: SkillRun) => SkillRun)) =>
      store.update((state) => ({
        ...state,
        runs: replaceById(state.runs, id, (run) => (typeof patch === 'function' ? patch(run) : { ...run, ...patch })),
      }), ['runs']),
    removeRun: (id: string) =>
      store.update((state) => ({ ...state, runs: state.runs.filter((run) => run.id !== id) }), ['runs']),

    // Profile ---------------------------------------------------------------
    updateProfile: profile,
    /**
     * Record who is on duty. Re-confirming the same agent after a restart keeps
     * the original start date; this only shapes the history the user reads.
     */
    appoint: (appointment: Appointment) =>
      profile((current) => {
        const previous = current.appointment;
        const continuing = previous !== null && (
          previous.binding !== null
            ? previous.binding === appointment.binding
            : previous.displayName === appointment.displayName
        );
        if (continuing) {
          return { ...current, appointment: { ...appointment, appointedAt: previous.appointedAt } };
        }
        const at = appointment.appointedAt;
        const closed = current.appointmentHistory.map((record) => (record.to === null ? { ...record, to: at } : record));
        return {
          ...current,
          appointment,
          appointmentHistory: [...closed, { displayName: appointment.displayName, from: at, to: null }].slice(-20),
        };
      }),
    dismissAppointment: () =>
      profile((current) => ({
        ...current,
        appointment: null,
        appointmentHistory: current.appointmentHistory.map((record) => (record.to === null ? { ...record, to: now().toISOString() } : record)),
      })),
    setSourcePreference: (preference: SourcePreference) =>
      profile((current) => ({
        ...current,
        sources: current.sources.some((entry) => entry.appId === preference.appId)
          ? current.sources.map((entry) => (entry.appId === preference.appId ? preference : entry))
          : [...current.sources, preference],
      })),
    setSourceGroup: (preference: SourceGroupPreference) =>
      profile((current) => ({
        ...current,
        sourceGroups: current.sourceGroups.some((entry) => entry.key === preference.key)
          ? current.sourceGroups.map((entry) => (entry.key === preference.key ? preference : entry))
          : [...current.sourceGroups, preference],
      })),
    hideSource: (activityId: string) =>
      profile((current) => ({ ...current, hiddenSourceIds: [...current.hiddenSourceIds, activityId].slice(-500) })),
  };
}

export type DayActions = ReturnType<typeof dayActions>;
