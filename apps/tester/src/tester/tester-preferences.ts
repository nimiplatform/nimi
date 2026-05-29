export const TESTER_PREFERENCES_STORAGE_KEY = 'nimiapp-tester:workbench-preferences:v1';
export const TESTER_PREFERENCES_SCHEMA_VERSION = 1;
export const TESTER_PROMPT_DRAFTS_STORAGE_KEY = 'nimiapp-tester:prompt-drafts:v1';
export const TESTER_PROMPT_DRAFTS_SCHEMA_VERSION = 1;

export type TesterEvidenceCaptureMode = 'manual' | 'after-run';
export type TesterPromptDraftSurfaceId = 'app-lab' | 'ai-capabilities';

export type TesterPreferences = {
  schemaVersion: typeof TESTER_PREFERENCES_SCHEMA_VERSION;
  draftPersistence: boolean;
  verboseConsole: boolean;
  evidenceCaptureMode: TesterEvidenceCaptureMode;
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

export function defaultTesterPreferences(): TesterPreferences {
  return {
    schemaVersion: TESTER_PREFERENCES_SCHEMA_VERSION,
    draftPersistence: true,
    verboseConsole: false,
    evidenceCaptureMode: 'manual',
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
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

function isEvidenceCaptureMode(value: unknown): value is TesterEvidenceCaptureMode {
  return value === 'manual' || value === 'after-run';
}

function parseTesterPreferences(raw: string): TesterPreferences {
  const parsed = JSON.parse(raw) as Partial<TesterPreferences>;
  if (
    parsed.schemaVersion !== TESTER_PREFERENCES_SCHEMA_VERSION
    || typeof parsed.draftPersistence !== 'boolean'
    || typeof parsed.verboseConsole !== 'boolean'
    || !isEvidenceCaptureMode(parsed.evidenceCaptureMode)
  ) {
    throw new Error('Stored preference schema is invalid.');
  }
  return {
    schemaVersion: TESTER_PREFERENCES_SCHEMA_VERSION,
    draftPersistence: parsed.draftPersistence,
    verboseConsole: parsed.verboseConsole,
    evidenceCaptureMode: parsed.evidenceCaptureMode,
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

function parseTesterPromptDraftStore(raw: string): TesterPromptDraftStore {
  const parsed = JSON.parse(raw) as Partial<TesterPromptDraftStore>;
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
  const raw = storage.getItem(TESTER_PROMPT_DRAFTS_STORAGE_KEY);
  if (!raw) {
    return {
      store: defaultTesterPromptDraftStore(),
      status: defaultDraftStatus('defaulted', 'No saved prompt drafts found; preset prompt is active.'),
    };
  }
  return {
    store: parseTesterPromptDraftStore(raw),
    status: defaultDraftStatus('ready', 'Prompt draft store loaded.'),
  };
}

export function loadTesterPreferences(storage: Storage | null = getLocalPreferenceStorage()): PreferenceLoadResult {
  if (!storage) return storageUnavailableResult();

  try {
    const raw = storage.getItem(TESTER_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return {
        preferences: defaultTesterPreferences(),
        status: defaultStatus('defaulted', 'No saved preferences found; defaults are active.'),
      };
    }
    return {
      preferences: parseTesterPreferences(raw),
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
    evidenceCaptureMode: isEvidenceCaptureMode(preferences.evidenceCaptureMode)
      ? preferences.evidenceCaptureMode
      : 'manual',
  };

  try {
    storage.setItem(TESTER_PREFERENCES_STORAGE_KEY, JSON.stringify(normalized));
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
    storage.removeItem(TESTER_PREFERENCES_STORAGE_KEY);
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
    storage.setItem(TESTER_PROMPT_DRAFTS_STORAGE_KEY, JSON.stringify(next));
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
