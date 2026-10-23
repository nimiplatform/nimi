import { emptyState } from '../domain/defaults.js';
import type { DayState, Language, LifeItem, SkillRun } from '../domain/types.js';
import { builtInSkillIds } from '../domain/skills.js';
import {
  CollectionPersistenceError,
  documentPath,
  persistenceReason,
  type PersistenceFailureKind,
} from './json-documents.js';
import type { DayPersistence } from './persistence.js';
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
  readonly saveErrorKind: Exclude<PersistenceFailureKind, 'closed'> | null;
  readonly cleanupPending: boolean;
  readonly recoveryRequired: boolean;
  readonly recoveryPending: boolean;
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
   * otherwise with the reason. Only temporary failures retry automatically;
   * refused content stays dirty for an edit or an explicit retry.
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
  if (error instanceof CollectionPersistenceError && error.kind === 'closed') return true;
  if (!error || typeof error !== 'object') return false;
  const record = error as { reasonCode?: unknown; code?: unknown };
  const reason = String(record.reasonCode ?? record.code ?? '');
  return SESSION_ENDED.has(reason.toLowerCase().replaceAll('_', '-'))
    || ['SESSION_INVALID', 'LOCAL_APP_SESSION_REVOKED', 'LOCAL_APP_ACCOUNT_CHANGED'].includes(persistenceReason(error));
}

const RUN_LIMIT = 300;
const CLOSED_ITEM_LIMIT = 800;
const SAVE_DELAY_MS = 350;
const RETRY_DELAYS_MS = [2_000, 8_000, 30_000];

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function saveFailureKind(error: unknown): Exclude<StoreSnapshot['saveErrorKind'], null> {
  if (error instanceof CollectionPersistenceError) return error.kind === 'closed' ? 'uncertain' : error.kind;
  if (error && typeof error === 'object') {
    const reason = persistenceReason(error);
    if (reason === 'APP_STORAGE_QUOTA_EXCEEDED' || reason === 'RESOURCE_EXHAUSTED') return 'capacity';
    if (['INVALID_PATH', 'INVALID_PAYLOAD', 'APP_STORAGE_PATH_INVALID', 'PROTOCOL_ENVELOPE_INVALID'].includes(reason)) return 'invalid-data';
  }
  return 'temporary';
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

export function createDayStore(documents: DayPersistence, options: {
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
    saveErrorKind: null,
    cleanupPending: false,
    recoveryRequired: false,
    recoveryPending: false,
  };
  const listeners = new Set<() => void>();
  const dirty = new Set<DocKey>();
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> | null = null;
  let retryIndex = 0;
  // Every applied change bumps `version`; `savedVersion` is the newest one known to be stored.
  let version = 0;
  let savedVersion = 0;

  const requireOpen = () => {
    if (snapshot.status === 'closed') throw new Error('NimiDay storage session has ended.');
  };
  // A collection uses several calls. Fence each call, not only its outer save,
  // because the carrier can rebind while an earlier call is still completing.
  const scopedDocuments: DayPersistence = {
    read: async (path) => { requireOpen(); return documents.read(path); },
    write: async (path, value) => { requireOpen(); return documents.write(path, value); },
    remove: async (path) => { requireOpen(); return documents.remove(path); },
    readCollection: async name => { requireOpen(); return documents.readCollection(name); },
    writeCollection: async (name, records) => { requireOpen(); return documents.writeCollection(name, records); },
    maintain: async () => { requireOpen(); return documents.maintain(); },
    status: documents.status,
    close: documents.close,
  };

  const publish = (next: Omit<StoreSnapshot, 'unsaved'>) => {
    snapshot = { ...next, unsaved: savedVersion < version };
    listeners.forEach((listener) => listener());
  };

  const writeDocument = async (key: DocKey, state: DayState) => {
    switch (key) {
      case 'profile':
        return scopedDocuments.write(documentPath('profile'), state.profile);
      case 'circles':
        return scopedDocuments.write(documentPath('circles'), state.circles);
      case 'rhythms':
        return scopedDocuments.write(documentPath('rhythms'), state.rhythms);
      case 'skills':
        return scopedDocuments.write(documentPath('skills'), { overrides: state.skillOverrides, custom: state.customSkills, favorites: state.favoriteSkillIds });
      case 'items':
        return scopedDocuments.writeCollection('items', state.items);
      case 'notes':
        return scopedDocuments.writeCollection('notes', state.notes);
      case 'runs':
        return scopedDocuments.writeCollection('runs', state.runs);
    }
  };

  const runSave = async (): Promise<void> => {
    if (snapshot.status !== 'ready') return;
    if (documents.status().cleanupPending && !documents.status().recoveryRequired) {
      try { await scopedDocuments.maintain(); } catch { /* pending remains visible and prevents a new commit */ }
      if (isClosed()) return;
      publish({ ...snapshot, ...documents.status() });
    }
    if (dirty.size === 0) {
      // Nothing is waiting, and saves run one at a time: everything so far is stored.
      if (savedVersion < version) {
        savedVersion = version;
        publish(snapshot);
      }
      return;
    }
    const keys = [...dirty];
    const remaining = new Set(keys);
    dirty.clear();
    const state = snapshot.state;
    const target = version;
    publish({ ...snapshot, saving: 'saving' });
    try {
      for (const key of keys) {
        await writeDocument(key, state);
        if (isClosed()) return;
        remaining.delete(key);
      }
      retryIndex = 0;
      savedVersion = Math.max(savedVersion, target);
      publish({ ...snapshot, ...documents.status(), saving: dirty.size > 0 ? 'saving' : 'idle', saveError: null, saveErrorKind: null });
    } catch (error) {
      // A store whose session has ended never retries: the next attempt would go to whatever scope is bound now.
      if (isClosed() || sessionEnded(error)) {
        close();
        return;
      }
      remaining.forEach((key) => dirty.add(key));
      const kind = saveFailureKind(error);
      publish({ ...snapshot, ...documents.status(), saving: 'error', saveError: message(error, 'NimiDay could not save your changes.'), saveErrorKind: kind });
      if (kind !== 'temporary') return;
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
    documents.close();
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
      if (isClosed()) return;
      publish({ ...snapshot, status: 'loading', loadError: null });
      try {
        const [profile, circles, rhythms, skills, items, notes, runs] = await Promise.all([
          scopedDocuments.read(documentPath('profile')),
          scopedDocuments.read(documentPath('circles')),
          scopedDocuments.read(documentPath('rhythms')),
          scopedDocuments.read(documentPath('skills')),
          scopedDocuments.readCollection('items'),
          scopedDocuments.readCollection('notes'),
          scopedDocuments.readCollection('runs'),
        ]);
        if (isClosed()) return;
        const fresh = emptyState(options.language(), now());
        const skillsRecord = skills && typeof skills === 'object' ? (skills as Record<string, unknown>) : {};
        const customSkills = normalizeList(skillsRecord.custom, normalizeCustomSkill);
        const availableSkills = new Set([...builtInSkillIds(), ...customSkills.map(skill => skill.id)]);
        const state: DayState = {
          profile: profile === undefined ? fresh.profile : normalizeProfile(profile),
          circles: normalizeList(circles, normalizeCircle),
          rhythms: rhythms === undefined ? fresh.rhythms : normalizeList(rhythms, normalizeRhythm),
          skillOverrides: normalizeList(skillsRecord.overrides, normalizeOverride),
          customSkills,
          favoriteSkillIds: [...new Set(normalizeList(skillsRecord.favorites, value => typeof value === 'string' && availableSkills.has(value) ? value : null))],
          items: normalizeList(items.records, normalizeItem),
          notes: normalizeList(notes.records, normalizeNote),
          runs: normalizeList(runs.records, normalizeRun),
        };
        if (rhythms === undefined) {
          dirty.add('rhythms');
          // Initial defaults are also a pending write. Track their version so
          // an explicit retry cannot report success after their save was refused.
          version += 1;
        }
        publish({ status: 'ready', state, saving: 'idle', loadError: null, saveError: null, saveErrorKind: null, ...documents.status() });
        if (rhythms === undefined || documents.status().cleanupPending) {
          schedule(SAVE_DELAY_MS);
        }
      } catch (error) {
        if (isClosed() || sessionEnded(error)) {
          close();
          return;
        }
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
      if (savedVersion >= target && !documents.status().cleanupPending) return { ok: true };
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
