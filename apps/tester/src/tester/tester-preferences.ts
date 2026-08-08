import {
  readStorageJsonFrom,
  removeStorageKeyFrom,
  resolveBrowserStorage,
  writeStorageJsonTo,
} from '@nimiplatform/kit/core/storage-json';

export const TESTER_PREFERENCES_STORAGE_KEY = 'nimiapp-tester:workbench-preferences:v1';
export const TESTER_PREFERENCES_SCHEMA_VERSION = 1;
export const TESTER_PROMPT_DRAFTS_STORAGE_KEY = 'nimiapp-tester:prompt-drafts:v1';
export const TESTER_PROMPT_DRAFTS_SCHEMA_VERSION = 1;

export type TesterPromptDraftSurfaceId = 'app-lab' | 'ai-capabilities';

export type TesterHistoryPanelScope = 'capability' | 'all' | 'media';

export type TesterHistoryPanelPreferences = {
  collapsed: boolean;
  scope: TesterHistoryPanelScope;
  hideFailures: boolean;
};

export type TesterPreferences = {
  schemaVersion: typeof TESTER_PREFERENCES_SCHEMA_VERSION;
  draftPersistence: boolean;
  verboseConsole: boolean;
  historyPanel: TesterHistoryPanelPreferences;
  lastCapabilityId: string | null;
};

export type TesterPreferenceStoreState =
  | 'ready'
  | 'defaulted'
  | 'corrupt'
  | 'unavailable'
  | 'write-error'
  | 'reset';

export type TesterPreferenceStoreStatus = {
  state: TesterPreferenceStoreState;
  storageKey: typeof TESTER_PREFERENCES_STORAGE_KEY;
  message: string;
  error?: string;
};

type PreferenceLoadResult = {
  preferences: TesterPreferences;
  status: TesterPreferenceStoreStatus;
};

export type TesterPromptDraftKey = {
  surfaceId: TesterPromptDraftSurfaceId;
  capabilityId: string;
  scenarioId: string;
};

export type TesterPromptDraftStore = {
  schemaVersion: typeof TESTER_PROMPT_DRAFTS_SCHEMA_VERSION;
  drafts: Record<string, string>;
};

export type TesterPromptDraftStoreState =
  | 'ready'
  | 'defaulted'
  | 'corrupt'
  | 'unavailable'
  | 'write-error'
  | 'disabled';

export type TesterPromptDraftStoreStatus = {
  state: TesterPromptDraftStoreState;
  storageKey: typeof TESTER_PROMPT_DRAFTS_STORAGE_KEY;
  message: string;
  error?: string;
};

export type TesterPromptDraftLoadResult = {
  prompt: string | null;
  status: TesterPromptDraftStoreStatus;
};

export type TesterPromptDraftSaveResult = {
  status: TesterPromptDraftStoreStatus;
};

function defaultStatus(state: TesterPreferenceStoreState, message: string, error?: string): TesterPreferenceStoreStatus {
  return {
    state,
    storageKey: TESTER_PREFERENCES_STORAGE_KEY,
    message,
    error,
  };
}

function defaultDraftStatus(
  state: TesterPromptDraftStoreState,
  message: string,
  error?: string,
): TesterPromptDraftStoreStatus {
  return {
    state,
    storageKey: TESTER_PROMPT_DRAFTS_STORAGE_KEY,
    message,
    error,
  };
}

export function defaultTesterHistoryPanelPreferences(): TesterHistoryPanelPreferences {
  return {
    collapsed: true,
    scope: 'capability',
    hideFailures: false,
  };
}

export function defaultTesterPreferences(): TesterPreferences {
  return {
    schemaVersion: TESTER_PREFERENCES_SCHEMA_VERSION,
    draftPersistence: true,
    verboseConsole: false,
    historyPanel: defaultTesterHistoryPanelPreferences(),
    lastCapabilityId: null,
  };
}

function storageUnavailableResult(error?: string): PreferenceLoadResult {
  return {
    preferences: defaultTesterPreferences(),
    status: defaultStatus(
      'unavailable',
      'Local preference storage is unavailable; defaults are active and controls are read-only.',
      error,
    ),
  };
}

function draftStorageUnavailableResult(error?: string): TesterPromptDraftLoadResult {
  return {
    prompt: null,
    status: defaultDraftStatus(
      'unavailable',
      'Prompt draft storage is unavailable; preset prompt is active.',
      error,
    ),
  };
}

function getLocalPreferenceStorage(): Storage | null {
  return resolveBrowserStorage('local');
}

const TESTER_HISTORY_PANEL_SCOPES: readonly TesterHistoryPanelScope[] = ['capability', 'all', 'media'];

function parseHistoryPanelPreferences(value: unknown): TesterHistoryPanelPreferences {
  const defaults = defaultTesterHistoryPanelPreferences();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const parsed = value as Partial<TesterHistoryPanelPreferences>;
  return {
    collapsed: typeof parsed.collapsed === 'boolean' ? parsed.collapsed : defaults.collapsed,
    scope: TESTER_HISTORY_PANEL_SCOPES.includes(parsed.scope as TesterHistoryPanelScope)
      ? parsed.scope as TesterHistoryPanelScope
      : defaults.scope,
    hideFailures: typeof parsed.hideFailures === 'boolean' ? parsed.hideFailures : defaults.hideFailures,
  };
}

function parseTesterPreferences(value: unknown): TesterPreferences {
  const parsed = value as Partial<TesterPreferences>;
  if (
    parsed.schemaVersion !== TESTER_PREFERENCES_SCHEMA_VERSION
    || typeof parsed.draftPersistence !== 'boolean'
    || typeof parsed.verboseConsole !== 'boolean'
  ) {
    throw new Error('Stored preference schema is invalid.');
  }
  return {
    schemaVersion: TESTER_PREFERENCES_SCHEMA_VERSION,
    draftPersistence: parsed.draftPersistence,
    verboseConsole: parsed.verboseConsole,
    historyPanel: parseHistoryPanelPreferences(parsed.historyPanel),
    lastCapabilityId: typeof parsed.lastCapabilityId === 'string' && parsed.lastCapabilityId.trim()
      ? parsed.lastCapabilityId
      : null,
  };
}

function makePromptDraftId(key: TesterPromptDraftKey): string {
  return `${key.surfaceId}:${key.capabilityId}:${key.scenarioId}`;
}

function defaultTesterPromptDraftStore(): TesterPromptDraftStore {
  return {
    schemaVersion: TESTER_PROMPT_DRAFTS_SCHEMA_VERSION,
    drafts: {},
  };
}

function parseTesterPromptDraftStore(value: unknown): TesterPromptDraftStore {
  const parsed = value as Partial<TesterPromptDraftStore>;
  if (
    parsed.schemaVersion !== TESTER_PROMPT_DRAFTS_SCHEMA_VERSION
    || !parsed.drafts
    || typeof parsed.drafts !== 'object'
    || Array.isArray(parsed.drafts)
  ) {
    throw new Error('Stored prompt draft schema is invalid.');
  }
  for (const [draftId, prompt] of Object.entries(parsed.drafts)) {
    if (typeof draftId !== 'string' || typeof prompt !== 'string') {
      throw new Error('Stored prompt draft entry is invalid.');
    }
  }
  return {
    schemaVersion: TESTER_PROMPT_DRAFTS_SCHEMA_VERSION,
    drafts: { ...parsed.drafts },
  };
}

function loadTesterPromptDraftStore(storage: Storage): {
  store: TesterPromptDraftStore;
  status: TesterPromptDraftStoreStatus;
} {
  const loaded = readStorageJsonFrom(storage, TESTER_PROMPT_DRAFTS_STORAGE_KEY, parseTesterPromptDraftStore);
  if (loaded.state === 'missing') {
    return {
      store: defaultTesterPromptDraftStore(),
      status: defaultDraftStatus('defaulted', 'No saved prompt drafts found; preset prompt is active.'),
    };
  }
  if (loaded.state !== 'ready') {
    throw new Error(loaded.error || `Prompt draft storage ${loaded.state}.`);
  }
  return {
    store: loaded.value,
    status: defaultDraftStatus('ready', 'Prompt draft store loaded.'),
  };
}

export function loadTesterPreferences(storage: Storage | null = getLocalPreferenceStorage()): PreferenceLoadResult {
  if (!storage) return storageUnavailableResult();

  try {
    const loaded = readStorageJsonFrom(storage, TESTER_PREFERENCES_STORAGE_KEY, parseTesterPreferences);
    if (loaded.state === 'missing') {
      return {
        preferences: defaultTesterPreferences(),
        status: defaultStatus('defaulted', 'No saved preferences found; defaults are active.'),
      };
    }
    if (loaded.state !== 'ready') {
      throw new Error(loaded.error || `Preference storage ${loaded.state}.`);
    }
    return {
      preferences: loaded.value,
      status: defaultStatus('ready', 'Local preference store loaded.'),
    };
  } catch (error) {
    return {
      preferences: defaultTesterPreferences(),
      status: defaultStatus(
        'corrupt',
        'Saved preferences could not be trusted; defaults are active until a valid write succeeds.',
        error instanceof Error ? error.message : String(error || 'Unknown preference load error.'),
      ),
    };
  }
}

export function saveTesterPreferences(
  preferences: TesterPreferences,
  storage: Storage | null = getLocalPreferenceStorage(),
): PreferenceLoadResult {
  if (!storage) return storageUnavailableResult();

  const normalized: TesterPreferences = {
    schemaVersion: TESTER_PREFERENCES_SCHEMA_VERSION,
    draftPersistence: Boolean(preferences.draftPersistence),
    verboseConsole: Boolean(preferences.verboseConsole),
    historyPanel: parseHistoryPanelPreferences(preferences.historyPanel),
    lastCapabilityId: typeof preferences.lastCapabilityId === 'string' && preferences.lastCapabilityId.trim()
      ? preferences.lastCapabilityId
      : null,
  };

  try {
    const write = writeStorageJsonTo(storage, TESTER_PREFERENCES_STORAGE_KEY, normalized);
    if (write.state !== 'saved') {
      throw new Error(write.error || `Preference storage ${write.state}.`);
    }
    return {
      preferences: normalized,
      status: defaultStatus('ready', 'Local preference store saved.'),
    };
  } catch (error) {
    return {
      preferences: defaultTesterPreferences(),
      status: defaultStatus(
        'write-error',
        'Preference write failed; defaults are active until storage accepts a valid write.',
        error instanceof Error ? error.message : String(error || 'Unknown preference write error.'),
      ),
    };
  }
}

export function resetTesterPreferences(storage: Storage | null = getLocalPreferenceStorage()): PreferenceLoadResult {
  if (!storage) return storageUnavailableResult();

  try {
    const removed = removeStorageKeyFrom(storage, TESTER_PREFERENCES_STORAGE_KEY);
    if (removed.state !== 'removed') {
      throw new Error(removed.error || `Preference storage ${removed.state}.`);
    }
    return {
      preferences: defaultTesterPreferences(),
      status: defaultStatus('reset', 'Local preferences reset. Run and artifact evidence was not changed.'),
    };
  } catch (error) {
    return {
      preferences: defaultTesterPreferences(),
      status: defaultStatus(
        'write-error',
        'Preference reset failed; run and artifact evidence was not changed.',
        error instanceof Error ? error.message : String(error || 'Unknown preference reset error.'),
      ),
    };
  }
}

export function loadTesterPromptDraft(
  key: TesterPromptDraftKey,
  enabled: boolean,
  storage: Storage | null = getLocalPreferenceStorage(),
): TesterPromptDraftLoadResult {
  if (!enabled) {
    return {
      prompt: null,
      status: defaultDraftStatus('disabled', 'Prompt draft persistence is disabled; preset prompt is active.'),
    };
  }
  if (!storage) return draftStorageUnavailableResult();

  try {
    const { store, status } = loadTesterPromptDraftStore(storage);
    return {
      prompt: store.drafts[makePromptDraftId(key)] ?? null,
      status,
    };
  } catch (error) {
    return {
      prompt: null,
      status: defaultDraftStatus(
        'corrupt',
        'Saved prompt drafts could not be trusted; preset prompt is active.',
        error instanceof Error ? error.message : String(error || 'Unknown prompt draft load error.'),
      ),
    };
  }
}

export function saveTesterPromptDraft(
  key: TesterPromptDraftKey,
  prompt: string,
  enabled: boolean,
  storage: Storage | null = getLocalPreferenceStorage(),
): TesterPromptDraftSaveResult {
  if (!enabled) {
    return {
      status: defaultDraftStatus('disabled', 'Prompt draft persistence is disabled; edit was not saved.'),
    };
  }
  if (!storage) {
    return {
      status: draftStorageUnavailableResult().status,
    };
  }

  try {
    const { store } = loadTesterPromptDraftStore(storage);
    const next: TesterPromptDraftStore = {
      schemaVersion: TESTER_PROMPT_DRAFTS_SCHEMA_VERSION,
      drafts: {
        ...store.drafts,
        [makePromptDraftId(key)]: prompt,
      },
    };
    const write = writeStorageJsonTo(storage, TESTER_PROMPT_DRAFTS_STORAGE_KEY, next);
    if (write.state !== 'saved') {
      throw new Error(write.error || `Prompt draft storage ${write.state}.`);
    }
    return {
      status: defaultDraftStatus('ready', 'Prompt draft saved.'),
    };
  } catch (error) {
    return {
      status: defaultDraftStatus(
        'write-error',
        'Prompt draft write failed; edit remains local to this view.',
        error instanceof Error ? error.message : String(error || 'Unknown prompt draft write error.'),
      ),
    };
  }
}
