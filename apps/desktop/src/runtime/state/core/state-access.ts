import type { StoreState } from '../store-types';
import { RuntimeStorage } from './storage';

export function loadPersistedState(state: StoreState) {
  RuntimeStorage.remove('auth');

  const settings = RuntimeStorage.get('settings');
  if (settings) {
    state.settings = { ...state.settings, ...settings };
  }

  const ui = RuntimeStorage.get('ui');
  if (ui) {
    state.ui = { ...state.ui, ...ui };
  }
}

export function persistState(state: StoreState) {
  RuntimeStorage.set('settings', state.settings);
  RuntimeStorage.set('ui', state.ui);
}

export function getStateAtPath<T = unknown>(state: StoreState, path?: string): T | undefined {
  if (!path) {
    return state as T;
  }
  const keys = path.split('.');
  let value: unknown = state;
  for (const key of keys) {
    if (value === null || value === undefined) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value as T;
}

export function setStateAtPath(state: StoreState, path: string, value: unknown) {
  const keys = path.split('.');
  if (keys.length === 0) {
    return { changed: false, oldValue: undefined, rootKey: '' };
  }

  let target: Record<string, unknown> = state as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!key) {
      continue;
    }
    const current = target[key];
    if (current === null || current === undefined || typeof current !== 'object') {
      target[key] = {};
    }
    target = target[key] as Record<string, unknown>;
  }

  const lastKey = keys[keys.length - 1];
  if (!lastKey) {
    return { changed: false, oldValue: undefined, rootKey: keys[0] || '' };
  }

  const oldValue = target[lastKey];
  target[lastKey] = value;
  return { changed: true, oldValue, rootKey: keys[0] || '' };
}

