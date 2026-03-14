import assert from 'node:assert/strict';
import test from 'node:test';

{
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const existingWindow = (globalThis as Record<string, unknown>).window as Record<string, unknown> | undefined;
  const windowShim = existingWindow || {};
  windowShim.addEventListener = (type: string, listener: (event: Event) => void) => {
    const bucket = listeners.get(type) || new Set<(event: Event) => void>();
    bucket.add(listener);
    listeners.set(type, bucket);
  };
  windowShim.removeEventListener = (type: string, listener: (event: Event) => void) => {
    listeners.get(type)?.delete(listener);
  };
  windowShim.dispatchEvent = (event: Event) => {
    for (const listener of listeners.get(event.type) || []) {
      listener(event);
    }
    return true;
  };
  (globalThis as Record<string, unknown>).window = windowShim;
}

if (typeof globalThis.document === 'undefined') {
  (globalThis as Record<string, unknown>).document = {
    visibilityState: 'visible',
  };
}

{
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
}

if (typeof globalThis.CustomEvent === 'undefined') {
  class CustomEventShim<T> extends Event {
    detail: T;

    constructor(type: string, init?: CustomEventInit<T>) {
      super(type, init);
      this.detail = init?.detail as T;
    }
  }
  (globalThis as Record<string, unknown>).CustomEvent = CustomEventShim;
}

import { shouldRunAutomaticUpdateCheck } from '../src/shell/renderer/infra/bootstrap/desktop-updates';
import {
  persistStoredPerformancePreferences,
  subscribeStoredPerformancePreferences,
  type PerformancePreferences,
} from '../src/shell/renderer/features/settings/settings-storage';

test('automatic update checks require autoUpdate to be enabled', () => {
  const preferences: PerformancePreferences = {
    hardwareAcceleration: true,
    reduceAnimations: false,
    autoUpdate: false,
    developerMode: false,
  };

  assert.equal(shouldRunAutomaticUpdateCheck(preferences, 'visible'), false);
});

test('automatic update checks do not run while document is hidden', () => {
  const preferences: PerformancePreferences = {
    hardwareAcceleration: true,
    reduceAnimations: false,
    autoUpdate: true,
    developerMode: false,
  };

  assert.equal(shouldRunAutomaticUpdateCheck(preferences, 'hidden'), false);
  assert.equal(shouldRunAutomaticUpdateCheck(preferences, 'visible'), true);
});

test('performance preference subscribers receive persisted autoUpdate changes', async () => {
  const events: PerformancePreferences[] = [];
  const unsubscribe = subscribeStoredPerformancePreferences((prefs) => {
    events.push(prefs);
  });

  persistStoredPerformancePreferences({
    hardwareAcceleration: true,
    reduceAnimations: false,
    autoUpdate: false,
    developerMode: true,
  });

  unsubscribe();

  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    hardwareAcceleration: true,
    reduceAnimations: false,
    autoUpdate: false,
    developerMode: true,
  });
});
