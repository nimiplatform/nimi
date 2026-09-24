import { emptyState } from '../domain/defaults.js';
import type { DayState, Language, LifeItem, SkillRun } from '../domain/types.js';
import {
  documentPath,
  readCollection,
  writeCollection,
  type JsonDocumentStore,
} from './persistence.js';
import {
  normalizeCircle,
  normalizeCustomSkill,
  normalizeItem,
  normalizeList,
  normalizeNote,
  normalizeOverride,
  normalizeProfile,
  normalizeRhythm,
  normalizeRun,
} from './normalize.js';

export type DocKey = 'profile' | 'circles' | 'rhythms' | 'skills' | 'items' | 'notes' | 'runs';

export type StoreSnapshot = {
  /** `closed`: the session this data was loaded in is over; nothing more is saved or changed. */
  readonly status: 'loading' | 'ready' | 'failed' | 'closed';
  readonly state: DayState;
  readonly saving: 'idle' | 'saving' | 'error';
  /** Some change shown on screen has not reached storage yet. */
  readonly unsaved: boolean;
  readonly loadError: string | null;
  readonly saveError: string | null;
};

export type SaveOutcome = { readonly ok: true } | { readonly ok: false; readonly error: string };

export type DayStore = {
  readonly getSnapshot: () => StoreSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly load: () => Promise<void>;
  /** Apply a change now and persist the named documents shortly after. */
  readonly update: (mutate: (state: DayState) => DayState, dirty: readonly DocKey[]) => void;
  /**
   * Save now. Resolves ok only once every change made so far is in storage;
   * otherwise with the reason. A failed save stays queued for the usual retry.
   */
  readonly persist: () => Promise<SaveOutcome>;
  readonly flush: () => Promise<void>;
  /**
   * The App session (and so possibly the account) this data belongs to has
   * ended. Pending saves are dropped, never retried into whatever session
   * comes next; the App reloads its data from the new session instead.
   */
  readonly close: () => void;
};

/**
 * Carrier refusals meaning the session this data was loaded in has ended
 * (another account, a revoked or replaced session). A write refused this way
 * is never retried: the next session may belong to someone else.
 */
const SESSION_ENDED: ReadonlySet<string> = new Set([
  'account-changed',
  'runtime-unauthenticated',
  'process-replaced',
  'runtime-restarted',
  'revoked',
  'project-changed',
  'local-app-snapshot-unavailable',
]);

function sessionEnded(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { reasonCode?: unknown; code?: unknown };
  return SESSION_ENDED.has(String(record.reasonCode ?? record.code ?? ''));
}

const RUN_LIMIT = 300;
const CLOSED_ITEM_LIMIT = 800;
const SAVE_DELAY_MS = 350;
const RETRY_DELAYS_MS = [2_000, 8_000, 30_000];

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Keep every open item; keep the most recently closed ones. */
export function pruneItems(items: readonly LifeItem[]): LifeItem[] {
  const open = items.filter((item) => item.state === 'open' || item.state === 'waiting');
  const closed = items
    .filter((item) => item.state === 'done' || item.state === 'dropped')
    .sort((a, b) => ((a.completedAt ?? a.updatedAt) < (b.completedAt ?? b.updatedAt) ? 1 : -1))
    .slice(0, CLOSED_ITEM_LIMIT);
  return [...open, ...closed];
}

export function pruneRuns(runs: readonly SkillRun[]): SkillRun[] {
  return runs.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, RUN_LIMIT);
}

export function createDayStore(documents: JsonDocumentStore, options: {
  readonly language: () => Language;
  readonly now?: () => Date;
}): DayStore {
  const now = options.now ?? (() => new Date());
  let snapshot: StoreSnapshot = {
    status: 'loading',
    state: emptyState(options.language(), now()),
    saving: 'idle',
    unsaved: false,
    loadError: null,
    saveError: null,
  };
  const listeners = new Set<() => void>();
  const dirty = new Set<DocKey>();
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> | null = null;
  let retryIndex = 0;
  // Every applied change bumps `version`; `savedVersion` is the newest one known to be stored.
  let version = 0;
  let savedVersion = 0;

  const publish = (next: Omit<StoreSnapshot, 'unsaved'>) => {
    snapshot = { ...next, unsaved: savedVersion < version };
    listeners.forEach((listener) => listener());
  };

  const writeDocument = async (key: DocKey, state: DayState) => {
    switch (key) {
      case 'profile':
        return documents.write(documentPath('profile'), state.profile);
      case 'circles':
        return documents.write(documentPath('circles'), state.circles);
      case 'rhythms':
        return documents.write(documentPath('rhythms'), state.rhythms);
      case 'skills':
        return documents.write(documentPath('skills'), { overrides: state.skillOverrides, custom: state.customSkills });
      case 'items':
        return writeCollection(documents, 'items', state.items);
      case 'notes':
        return writeCollection(documents, 'notes', state.notes);
      case 'runs':
        return writeCollection(documents, 'runs', state.runs);
    }
  };

  const runSave = async (): Promise<void> => {
    if (snapshot.status !== 'ready') return;
    if (dirty.size === 0) {
      // Nothing is waiting, and saves run one at a time: everything so far is stored.
      if (savedVersion < version) {
        savedVersion = version;
        publish(snapshot);
      }
      return;
    }
    const keys = [...dirty];
    dirty.clear();
    const state = snapshot.state;
    const target = version;
    publish({ ...snapshot, saving: 'saving' });
    try {
      for (const key of keys) await writeDocument(key, state);
      retryIndex = 0;
      savedVersion = Math.max(savedVersion, target);
      publish({ ...snapshot, saving: dirty.size > 0 ? 'saving' : 'idle', saveError: null });
    } catch (error) {
      // A store whose session has ended never retries: the next attempt would go to whatever scope is bound now.
      if (isClosed() || sessionEnded(error)) {
        close();
        return;
      }
      keys.forEach((key) => dirty.add(key));
      publish({ ...snapshot, saving: 'error', saveError: message(error, 'NimiDay could not save your changes.') });
      const delay = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)] ?? 30_000;
      retryIndex += 1;
      schedule(delay);
      return;
    }
    if (dirty.size > 0) schedule(SAVE_DELAY_MS);
  };

  const isClosed = () => snapshot.status === 'closed';

  const close = () => {
    if (isClosed()) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    dirty.clear();
    publish({ ...snapshot, status: 'closed', saving: 'idle' });
  };

  /** Saves run strictly one after another. */
  const enqueueSave = (): Promise<void> => {
    const queued: Promise<void> = (saving ?? Promise.resolve()).then(runSave).finally(() => {
      if (saving === queued) saving = null;
    });
    saving = queued;
    return queued;
  };

  const schedule = (delay: number) => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void enqueueSave();
    }, delay);
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load: async () => {
      publish({ ...snapshot, status: 'loading', loadError: null });
      try {
        const [profile, circles, rhythms, skills, items, notes, runs] = await Promise.all([
          documents.read(documentPath('profile')),
          documents.read(documentPath('circles')),
          documents.read(documentPath('rhythms')),
          documents.read(documentPath('skills')),
          readCollection(documents, 'items'),
          readCollection(documents, 'notes'),
          readCollection(documents, 'runs'),
        ]);
        const fresh = emptyState(options.language(), now());
        const skillsRecord = skills && typeof skills === 'object' ? (skills as Record<string, unknown>) : {};
        const state: DayState = {
          profile: profile === undefined ? fresh.profile : normalizeProfile(profile),
          circles: normalizeList(circles, normalizeCircle),
          rhythms: rhythms === undefined ? fresh.rhythms : normalizeList(rhythms, normalizeRhythm),
          skillOverrides: normalizeList(skillsRecord.overrides, normalizeOverride),
          customSkills: normalizeList(skillsRecord.custom, normalizeCustomSkill),
          items: normalizeList(items, normalizeItem),
          notes: normalizeList(notes, normalizeNote),
          runs: normalizeList(runs, normalizeRun),
        };
        publish({ status: 'ready', state, saving: 'idle', loadError: null, saveError: null });
        if (rhythms === undefined) {
          dirty.add('rhythms');
          schedule(SAVE_DELAY_MS);
        }
      } catch (error) {
        publish({ ...snapshot, status: 'failed', loadError: message(error, 'NimiDay could not open your saved data.') });
      }
    },
    update: (mutate, keys) => {
      if (snapshot.status !== 'ready') return;
      const next = mutate(snapshot.state);
      if (next === snapshot.state) return;
      const pruned: DayState = {
        ...next,
        items: keys.includes('items') ? pruneItems(next.items) : next.items,
        runs: keys.includes('runs') ? pruneRuns(next.runs) : next.runs,
      };
      keys.forEach((key) => dirty.add(key));
      version += 1;
      publish({ ...snapshot, state: pruned });
      schedule(SAVE_DELAY_MS);
    },
    persist: async () => {
      if (snapshot.status === 'closed') return { ok: false, error: 'NimiDay is reloading for a new session.' };
      const target = version;
      if (savedVersion >= target) return { ok: true };
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      await enqueueSave();
      // Closing can happen while that save runs.
      if (isClosed()) return { ok: false, error: 'NimiDay is reloading for a new session.' };
      if (savedVersion >= target) return { ok: true };
      return { ok: false, error: snapshot.saveError ?? 'NimiDay could not save your changes.' };
    },
    close,
    flush: async () => {
      if (isClosed()) return;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      await enqueueSave();
    },
  };
}
