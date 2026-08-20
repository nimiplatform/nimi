import {
  readStorageJsonFrom,
  removeStorageKeyFrom,
  resolveBrowserStorage,
  writeStorageJsonTo,
} from '@nimiplatform/kit/core/storage-json';

export const LAB_PREFERENCES_STORAGE_KEY = 'nimiapp-lab:workbench-preferences:v1';
export const LAB_PREFERENCES_SCHEMA_VERSION = 1;
export const LAB_PROMPT_DRAFTS_STORAGE_KEY = 'nimiapp-lab:prompt-drafts:v1';
export const LAB_PROMPT_DRAFTS_SCHEMA_VERSION = 1;

export type LabPromptDraftSurfaceId = 'app-lab' | 'ai-capabilities';

export type LabHistoryPanelScope = 'capability' | 'all' | 'media';

export type LabHistoryPanelPreferences = {
  collapsed: boolean;
  scope: LabHistoryPanelScope;
  hideFailures: boolean;
};

export type LabPreferences = {
  schemaVersion: typeof LAB_PREFERENCES_SCHEMA_VERSION;
  draftPersistence: boolean;
  verboseConsole: boolean;
  historyPanel: LabHistoryPanelPreferences;
  lastCapabilityId: string | null;
};

export type LabPreferenceStoreState =
  | 'ready'
  | 'defaulted'
  | 'corrupt'
  | 'unavailable'
  | 'write-error'
  | 'reset';

export type LabPreferenceStoreStatus = {
  state: LabPreferenceStoreState;
  storageKey: typeof LAB_PREFERENCES_STORAGE_KEY;
  message: string;
  error?: string;
};

type PreferenceLoadResult = {
  preferences: LabPreferences;
  status: LabPreferenceStoreStatus;
};

export type LabPromptDraftKey = {
  surfaceId: LabPromptDraftSurfaceId;
  capabilityId: string;
  scenarioId: string;
};

export type LabPromptDraftStore = {
  schemaVersion: typeof LAB_PROMPT_DRAFTS_SCHEMA_VERSION;
  drafts: Record<string, string>;
};

export type LabPromptDraftStoreState =
  | 'ready'
  | 'defaulted'
  | 'corrupt'
  | 'unavailable'
  | 'write-error'
  | 'disabled';

export type LabPromptDraftStoreStatus = {
  state: LabPromptDraftStoreState;
  storageKey: typeof LAB_PROMPT_DRAFTS_STORAGE_KEY;
  message: string;
  error?: string;
};

export type LabPromptDraftLoadResult = {
  prompt: string | null;
  status: LabPromptDraftStoreStatus;
};

export type LabPromptDraftSaveResult = {
  status: LabPromptDraftStoreStatus;
};

function defaultStatus(state: LabPreferenceStoreState, message: string, error?: string): LabPreferenceStoreStatus {
  return {
    state,
    storageKey: LAB_PREFERENCES_STORAGE_KEY,
    message,
    error,
  };
}

function defaultDraftStatus(
  state: LabPromptDraftStoreState,
  message: string,
  error?: string,
): LabPromptDraftStoreStatus {
  return {
    state,
    storageKey: LAB_PROMPT_DRAFTS_STORAGE_KEY,
    message,
    error,
  };
}

export function defaultLabHistoryPanelPreferences(): LabHistoryPanelPreferences {
  return {
    collapsed: true,
    scope: 'capability',
    hideFailures: false,
  };
}

export function defaultLabPreferences(): LabPreferences {
  return {
    schemaVersion: LAB_PREFERENCES_SCHEMA_VERSION,
    draftPersistence: true,
    verboseConsole: false,
    historyPanel: defaultLabHistoryPanelPreferences(),
    lastCapabilityId: null,
  };
}

function storageUnavailableResult(error?: string): PreferenceLoadResult {
  return {
    preferences: defaultLabPreferences(),
    status: defaultStatus(
      'unavailable',
      'Local preference storage is unavailable; defaults are active and controls are read-only.',
      error,
    ),
  };
}

function draftStorageUnavailableResult(error?: string): LabPromptDraftLoadResult {
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

const LAB_HISTORY_PANEL_SCOPES: readonly LabHistoryPanelScope[] = ['capability', 'all', 'media'];

function parseHistoryPanelPreferences(value: unknown): LabHistoryPanelPreferences {
  const defaults = defaultLabHistoryPanelPreferences();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const parsed = value as Partial<LabHistoryPanelPreferences>;
  return {
    collapsed: typeof parsed.collapsed === 'boolean' ? parsed.collapsed : defaults.collapsed,
    scope: LAB_HISTORY_PANEL_SCOPES.includes(parsed.scope as LabHistoryPanelScope)
      ? parsed.scope as LabHistoryPanelScope
      : defaults.scope,
    hideFailures: typeof parsed.hideFailures === 'boolean' ? parsed.hideFailures : defaults.hideFailures,
  };
}

function parseLabPreferences(value: unknown): LabPreferences {
  const parsed = value as Partial<LabPreferences>;
  if (
    parsed.schemaVersion !== LAB_PREFERENCES_SCHEMA_VERSION
    || typeof parsed.draftPersistence !== 'boolean'
    || typeof parsed.verboseConsole !== 'boolean'
  ) {
    throw new Error('Stored preference schema is invalid.');
  }
  return {
    schemaVersion: LAB_PREFERENCES_SCHEMA_VERSION,
    draftPersistence: parsed.draftPersistence,
    verboseConsole: parsed.verboseConsole,
    historyPanel: parseHistoryPanelPreferences(parsed.historyPanel),
    lastCapabilityId: typeof parsed.lastCapabilityId === 'string' && parsed.lastCapabilityId.trim()
      ? parsed.lastCapabilityId
      : null,
  };
}

function makePromptDraftId(key: LabPromptDraftKey): string {
  return `${key.surfaceId}:${key.capabilityId}:${key.scenarioId}`;
}

function defaultLabPromptDraftStore(): LabPromptDraftStore {
  return {
    schemaVersion: LAB_PROMPT_DRAFTS_SCHEMA_VERSION,
    drafts: {},
  };
}

function parseLabPromptDraftStore(value: unknown): LabPromptDraftStore {
  const parsed = value as Partial<LabPromptDraftStore>;
  if (
    parsed.schemaVersion !== LAB_PROMPT_DRAFTS_SCHEMA_VERSION
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
    schemaVersion: LAB_PROMPT_DRAFTS_SCHEMA_VERSION,
    drafts: { ...parsed.drafts },
  };
}

function loadLabPromptDraftStore(storage: Storage): {
  store: LabPromptDraftStore;
  status: LabPromptDraftStoreStatus;
} {
  const loaded = readStorageJsonFrom(storage, LAB_PROMPT_DRAFTS_STORAGE_KEY, parseLabPromptDraftStore);
  if (loaded.state === 'missing') {
    return {
      store: defaultLabPromptDraftStore(),
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

export function loadLabPreferences(storage: Storage | null = getLocalPreferenceStorage()): PreferenceLoadResult {
  if (!storage) return storageUnavailableResult();

  try {
    const loaded = readStorageJsonFrom(storage, LAB_PREFERENCES_STORAGE_KEY, parseLabPreferences);
    if (loaded.state === 'missing') {
      return {
        preferences: defaultLabPreferences(),
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
      preferences: defaultLabPreferences(),
      status: defaultStatus(
        'corrupt',
        'Saved preferences could not be trusted; defaults are active until a valid write succeeds.',
        error instanceof Error ? error.message : String(error || 'Unknown preference load error.'),
      ),
    };
  }
}

export function saveLabPreferences(
  preferences: LabPreferences,
  storage: Storage | null = getLocalPreferenceStorage(),
): PreferenceLoadResult {
  if (!storage) return storageUnavailableResult();

  const normalized: LabPreferences = {
    schemaVersion: LAB_PREFERENCES_SCHEMA_VERSION,
    draftPersistence: Boolean(preferences.draftPersistence),
    verboseConsole: Boolean(preferences.verboseConsole),
    historyPanel: parseHistoryPanelPreferences(preferences.historyPanel),
    lastCapabilityId: typeof preferences.lastCapabilityId === 'string' && preferences.lastCapabilityId.trim()
      ? preferences.lastCapabilityId
      : null,
  };

  try {
    const write = writeStorageJsonTo(storage, LAB_PREFERENCES_STORAGE_KEY, normalized);
    if (write.state !== 'saved') {
      throw new Error(write.error || `Preference storage ${write.state}.`);
    }
    return {
      preferences: normalized,
      status: defaultStatus('ready', 'Local preference store saved.'),
    };
  } catch (error) {
    return {
      preferences: defaultLabPreferences(),
      status: defaultStatus(
        'write-error',
        'Preference write failed; defaults are active until storage accepts a valid write.',
        error instanceof Error ? error.message : String(error || 'Unknown preference write error.'),
      ),
    };
  }
}

export function resetLabPreferences(storage: Storage | null = getLocalPreferenceStorage()): PreferenceLoadResult {
  if (!storage) return storageUnavailableResult();

  try {
    const removed = removeStorageKeyFrom(storage, LAB_PREFERENCES_STORAGE_KEY);
    if (removed.state !== 'removed') {
      throw new Error(removed.error || `Preference storage ${removed.state}.`);
    }
    return {
      preferences: defaultLabPreferences(),
      status: defaultStatus('reset', 'Local preferences reset. Run and artifact evidence was not changed.'),
    };
  } catch (error) {
    return {
      preferences: defaultLabPreferences(),
      status: defaultStatus(
        'write-error',
        'Preference reset failed; run and artifact evidence was not changed.',
        error instanceof Error ? error.message : String(error || 'Unknown preference reset error.'),
      ),
    };
  }
}

export function loadLabPromptDraft(
  key: LabPromptDraftKey,
  enabled: boolean,
  storage: Storage | null = getLocalPreferenceStorage(),
): LabPromptDraftLoadResult {
  if (!enabled) {
    return {
      prompt: null,
      status: defaultDraftStatus('disabled', 'Prompt draft persistence is disabled; preset prompt is active.'),
    };
  }
  if (!storage) return draftStorageUnavailableResult();

  try {
    const { store, status } = loadLabPromptDraftStore(storage);
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

export function saveLabPromptDraft(
  key: LabPromptDraftKey,
  prompt: string,
  enabled: boolean,
  storage: Storage | null = getLocalPreferenceStorage(),
): LabPromptDraftSaveResult {
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
    const { store } = loadLabPromptDraftStore(storage);
    const next: LabPromptDraftStore = {
      schemaVersion: LAB_PROMPT_DRAFTS_SCHEMA_VERSION,
      drafts: {
        ...store.drafts,
        [makePromptDraftId(key)]: prompt,
      },
    };
    const write = writeStorageJsonTo(storage, LAB_PROMPT_DRAFTS_STORAGE_KEY, next);
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
