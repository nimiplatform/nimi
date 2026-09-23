import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HomeMessage } from './home-messages-model.js';

/**
 * Home message display preferences live in Desktop's formal App private JSON
 * storage, which Runtime partitions by account, subject and data root. They
 * only change the Home preview: nothing here marks read, completes, cancels
 * or stops an App from publishing.
 */
export const HOME_MESSAGE_PREFERENCES_PATH = 'home-messages/display-preferences.v1.json';

const DOCUMENT_VERSION = 1;
// Home only previews the newest Posts of one feed page; older hidden ids stop mattering.
const MAX_HIDDEN_REALM_POSTS = 500;

export type HomeMessagePreferencesStorage = Pick<NimiLocalAppClient['storage'], 'readJson' | 'writeJson'>;

export type HomeMessagePreferences = Readonly<{
  /** activityId → highest revision hidden from Home; a higher revision shows again. */
  hiddenActivities: Readonly<Record<string, number>>;
  /** Realm Post ids hidden from Home, oldest first. */
  hiddenRealmPosts: readonly string[];
  /** App sourceRefs whose messages stay off Home. */
  appSourcesOffHome: readonly string[];
  realmPostsOnHome: boolean;
}>;

export const DEFAULT_HOME_MESSAGE_PREFERENCES: HomeMessagePreferences = Object.freeze({
  hiddenActivities: Object.freeze({}),
  hiddenRealmPosts: Object.freeze([]),
  appSourcesOffHome: Object.freeze([]),
  realmPostsOnHome: true,
});

export type HomeMessagePreferenceChange =
  | Readonly<{
    kind: 'hide';
    activities: readonly Readonly<{ activityId: string; revision: number }>[];
    realmPostIds: readonly string[];
  }>
  | Readonly<{ kind: 'show'; activityId?: string; realmPostId?: string }>
  | Readonly<{ kind: 'app-source'; sourceRef: string; onHome: boolean }>
  | Readonly<{ kind: 'realm-posts'; onHome: boolean }>
  | Readonly<{ kind: 'restore-hidden' }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim() === value;
}

function invalidDocument(): never {
  throw new Error('Home message display preferences are invalid.');
}

export function parseHomeMessagePreferences(value: unknown): HomeMessagePreferences {
  if (!isRecord(value) || value.version !== DOCUMENT_VERSION) invalidDocument();
  const { hiddenActivities, hiddenRealmPosts, appSourcesOffHome, realmPostsOnHome } = value;
  if (!isRecord(hiddenActivities)
    || !Array.isArray(hiddenRealmPosts)
    || !Array.isArray(appSourcesOffHome)
    || typeof realmPostsOnHome !== 'boolean') invalidDocument();
  const activities: Record<string, number> = {};
  for (const [activityId, revision] of Object.entries(hiddenActivities)) {
    if (!isIdentifier(activityId) || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) {
      invalidDocument();
    }
    activities[activityId] = revision;
  }
  if (!hiddenRealmPosts.every(isIdentifier) || !appSourcesOffHome.every(isIdentifier)) invalidDocument();
  return {
    hiddenActivities: activities,
    hiddenRealmPosts: [...new Set(hiddenRealmPosts)],
    appSourcesOffHome: [...new Set(appSourcesOffHome)],
    realmPostsOnHome,
  };
}

function storageReasonCode(error: unknown): string {
  return isRecord(error) && typeof error.reasonCode === 'string' ? error.reasonCode : '';
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r037
/**
 * Only an explicit missing document means "no preferences yet"; every other
 * failure stays visible so it is never mistaken for the defaults.
 */
export async function readHomeMessagePreferences(storage: HomeMessagePreferencesStorage): Promise<HomeMessagePreferences> {
  try {
    const document = await storage.readJson(HOME_MESSAGE_PREFERENCES_PATH);
    return parseHomeMessagePreferences(document.value);
  } catch (error) {
    if (storageReasonCode(error) === 'APP_STORAGE_ENTRY_NOT_FOUND') return DEFAULT_HOME_MESSAGE_PREFERENCES;
    throw error;
  }
}

export async function writeHomeMessagePreferences(
  storage: HomeMessagePreferencesStorage,
  preferences: HomeMessagePreferences,
): Promise<void> {
  await storage.writeJson(HOME_MESSAGE_PREFERENCES_PATH, {
    version: DOCUMENT_VERSION,
    hiddenActivities: { ...preferences.hiddenActivities },
    hiddenRealmPosts: [...preferences.hiddenRealmPosts],
    appSourcesOffHome: [...preferences.appSourcesOffHome],
    realmPostsOnHome: preferences.realmPostsOnHome,
  });
}

export function applyHomeMessagePreferenceChange(
  preferences: HomeMessagePreferences,
  change: HomeMessagePreferenceChange,
): HomeMessagePreferences {
  switch (change.kind) {
    case 'hide': {
      const hiddenActivities = { ...preferences.hiddenActivities };
      for (const { activityId, revision } of change.activities) {
        hiddenActivities[activityId] = Math.max(hiddenActivities[activityId] ?? 0, revision);
      }
      const known = new Set(preferences.hiddenRealmPosts);
      const hiddenRealmPosts = [...preferences.hiddenRealmPosts, ...change.realmPostIds.filter((id) => !known.has(id))]
        .slice(-MAX_HIDDEN_REALM_POSTS);
      return { ...preferences, hiddenActivities, hiddenRealmPosts };
    }
    case 'show': {
      const hiddenActivities = { ...preferences.hiddenActivities };
      if (change.activityId) delete hiddenActivities[change.activityId];
      return {
        ...preferences,
        hiddenActivities,
        hiddenRealmPosts: preferences.hiddenRealmPosts.filter((id) => id !== change.realmPostId),
      };
    }
    case 'app-source': {
      const others = preferences.appSourcesOffHome.filter((sourceRef) => sourceRef !== change.sourceRef);
      return { ...preferences, appSourcesOffHome: change.onHome ? others : [...others, change.sourceRef] };
    }
    case 'realm-posts':
      return { ...preferences, realmPostsOnHome: change.onHome };
    case 'restore-hidden':
      return { ...preferences, hiddenActivities: {}, hiddenRealmPosts: [] };
  }
}

/** Hidden by an explicit Home hide of this or a later revision. System items are never hidden. */
export function isHiddenFromHome(message: HomeMessage, preferences: HomeMessagePreferences): boolean {
  if (message.sourceKind === 'realm-post') return preferences.hiddenRealmPosts.includes(message.post.id);
  if (message.sourceKind === 'system') return false;
  const hiddenRevision = preferences.hiddenActivities[message.record.activityId];
  return hiddenRevision !== undefined && hiddenRevision >= message.record.revision;
}

/** Kept off Home by a source display choice; Runtime Agent summaries have none. */
export function isSourceOffHome(message: HomeMessage, preferences: HomeMessagePreferences): boolean {
  if (message.sourceKind === 'realm-post') return !preferences.realmPostsOnHome;
  if (message.sourceKind === 'app') return preferences.appSourcesOffHome.includes(message.record.source.sourceRef);
  return false;
}

export function hasHiddenMessages(preferences: HomeMessagePreferences): boolean {
  return Object.keys(preferences.hiddenActivities).length > 0 || preferences.hiddenRealmPosts.length > 0;
}

export type HomeMessagePreferencesState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'ready'; preferences: HomeMessagePreferences }>
  | Readonly<{ status: 'unavailable' }>;

export type HomeMessagePreferencesController = Readonly<{
  state: HomeMessagePreferencesState;
  saving: boolean;
  /** The last change was not saved; the display kept its previous state. */
  saveFailed: boolean;
  apply: (change: HomeMessagePreferenceChange) => Promise<boolean>;
  retrySave: () => void;
  reload: () => void;
}>;

/**
 * Loads the preferences once per mounted boundary (callers key it by
 * account) and saves one explicit change at a time; the display changes only
 * after the write succeeded. Late results of an ended boundary are ignored.
 */
export function useHomeMessagePreferences(storage: HomeMessagePreferencesStorage): HomeMessagePreferencesController {
  const [state, setState] = useState<HomeMessagePreferencesState>({ status: 'loading' });
  const [saving, setSaving] = useState(false);
  const [failedChange, setFailedChange] = useState<HomeMessagePreferenceChange | null>(null);
  const latest = useRef<HomeMessagePreferencesState>(state);
  const generation = useRef(0);
  const writing = useRef(false);

  const publish = useCallback((next: HomeMessagePreferencesState) => {
    latest.current = next;
    setState(next);
  }, []);

  const reload = useCallback(() => {
    const load = ++generation.current;
    publish({ status: 'loading' });
    setFailedChange(null);
    readHomeMessagePreferences(storage).then(
      (preferences) => {
        if (load === generation.current) publish({ status: 'ready', preferences });
      },
      () => {
        if (load === generation.current) publish({ status: 'unavailable' });
      },
    );
  }, [publish, storage]);

  useEffect(() => {
    reload();
    return () => {
      generation.current += 1;
    };
  }, [reload]);

  const apply = useCallback(async (change: HomeMessagePreferenceChange) => {
    const current = latest.current;
    if (current.status !== 'ready' || writing.current) return false;
    const load = generation.current;
    const next = applyHomeMessagePreferenceChange(current.preferences, change);
    writing.current = true;
    setSaving(true);
    setFailedChange(null);
    try {
      await writeHomeMessagePreferences(storage, next);
      if (load !== generation.current) return false;
      publish({ status: 'ready', preferences: next });
      return true;
    } catch {
      if (load === generation.current) setFailedChange(change);
      return false;
    } finally {
      writing.current = false;
      setSaving(false);
    }
  }, [publish, storage]);

  return {
    state,
    saving,
    saveFailed: failedChange !== null,
    apply,
    retrySave: () => {
      if (failedChange) void apply(failedChange);
    },
    reload,
  };
}
