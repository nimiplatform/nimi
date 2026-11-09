import {
  readStorageJsonFrom,
  removeStorageKeyFrom,
  resolveBrowserStorage,
  writeStorageJsonTo,
} from '@nimiplatform/kit/core/storage-json';
import type { StudioPromptDraftKey } from '../ai-studio-core/prompt-drafts.js';
import {
  DEFAULT_AI_STUDIO_HISTORY_PANEL_PREFERENCES,
  parseAIStudioHistoryPanelPreferences,
} from '../ai-studio-core/history-policy.js';

export const LAB_PREFERENCES_STORAGE_KEY = 'nimiapp-lab:workbench-preferences:v1';
export const LAB_PREFERENCES_SCHEMA_VERSION = 1;
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

export type LabPromptDraftKey = StudioPromptDraftKey;

export type LabPromptDraftLoadResult = { readonly prompt: string | null };
export type LabPromptDraftSaveResult = void;

function defaultStatus(state: LabPreferenceStoreState, message: string, error?: string): LabPreferenceStoreStatus {
  return {
    state,
    storageKey: LAB_PREFERENCES_STORAGE_KEY,
    message,
    error,
  };
}

export function defaultLabHistoryPanelPreferences(): LabHistoryPanelPreferences {
  return { ...DEFAULT_AI_STUDIO_HISTORY_PANEL_PREFERENCES };
}

export function defaultLabPreferences(): LabPreferences {
  return {
    schemaVersion: LAB_PREFERENCES_SCHEMA_VERSION,
    draftPersistence: true,
    verboseConsole: false,
    historyPanel: defaultLabHistoryPanelPreferences(),
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

function getLocalPreferenceStorage(): Storage | null {
  return resolveBrowserStorage('local');
}

function parseHistoryPanelPreferences(value: unknown): LabHistoryPanelPreferences {
  try {
    return parseAIStudioHistoryPanelPreferences(value);
  } catch {
    return defaultLabHistoryPanelPreferences();
  }
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
