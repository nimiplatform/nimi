/**
 * Per-app update preference store and auto-prompt planning proof.
 *
 * Storage runs against an in-memory Storage stub so the failure and corruption
 * paths are covered without a DOM; planning uses minimal entry fixtures through
 * the real `canRequestCatalogUpdate` gate.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppPackageSourceClass, type ApprovedAppCatalogTarget, type CommittedAppRelease } from '@nimiplatform/sdk/runtime/wire-types';
import {
  APPS_UPDATE_PREFERENCES_STORAGE_KEY,
  DEFAULT_APP_UPDATE_PREFERENCE,
  markAppUpdateAutoPrompted,
  planAppUpdateAutoPrompt,
  readAppUpdatePreference,
  writeAppUpdatePolicy,
} from '../src/shell/renderer/features/apps/apps-update-preferences';
import type { DesktopAppsEntry } from '../src/shell/renderer/features/apps/apps-panel-projection';

function memoryStorage(initial?: Record<string, string>): Storage {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, String(value)); },
    removeItem: (key: string) => { map.delete(key); },
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() { return map.size; },
  } as Storage;
}

function installedEntry(overrides: {
  readonly appId?: string;
  readonly installedVersion?: string;
  readonly catalogVersion?: string | null;
  readonly policyBlocked?: boolean;
  readonly running?: boolean;
} = {}): DesktopAppsEntry {
  const appId = overrides.appId ?? 'nimi.lab';
  const catalogVersion = overrides.catalogVersion === undefined ? '0.2.0' : overrides.catalogVersion;
  return {
    identity: {
      entryKey: `verified:${appId}`,
      appId,
      sourceClass: 'verified',
      displayName: appId,
      updatedAtUnixMs: 0,
    },
    catalogTarget: catalogVersion === null ? null : {
      policyBlocked: overrides.policyBlocked ?? false,
      version: catalogVersion,
    } as unknown as ApprovedAppCatalogTarget,
    localDevelopment: null,
    committedRelease: {
      sourceClass: AppPackageSourceClass.VERIFIED,
      version: overrides.installedVersion ?? '0.1.6',
    } as unknown as CommittedAppRelease,
    packageJob: null,
    run: overrides.running ? ({ state: 'running' } as DesktopAppsEntry['run']) : null,
    aiConfigSummary: null,
    iconUrl: null,
    summary: null,
  };
}

test('update preference defaults to manual and survives storage corruption', () => {
  const storage = memoryStorage();
  assert.deepEqual(readAppUpdatePreference('nimi.lab', storage), DEFAULT_APP_UPDATE_PREFERENCE);
  storage.setItem(APPS_UPDATE_PREFERENCES_STORAGE_KEY, '{not json');
  assert.deepEqual(readAppUpdatePreference('nimi.lab', storage), DEFAULT_APP_UPDATE_PREFERENCE);
  storage.setItem(APPS_UPDATE_PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 1, apps: { 'nimi.lab': { policy: 'nightly' } } }));
  assert.equal(readAppUpdatePreference('nimi.lab', storage).policy, 'manual');
});

test('writing the policy persists per app and keeps the prompt record', () => {
  const storage = memoryStorage();
  writeAppUpdatePolicy('nimi.lab', 'auto', storage);
  markAppUpdateAutoPrompted('nimi.lab', '0.2.0', storage);
  assert.deepEqual(readAppUpdatePreference('nimi.lab', storage), { policy: 'auto', lastAutoPromptedVersion: '0.2.0' });
  writeAppUpdatePolicy('nimi.lab', 'manual', storage);
  assert.deepEqual(readAppUpdatePreference('nimi.lab', storage), { policy: 'manual', lastAutoPromptedVersion: '0.2.0' });
  assert.deepEqual(readAppUpdatePreference('nimi.other', storage), DEFAULT_APP_UPDATE_PREFERENCE);
});

test('auto-prompt planning only picks auto apps with an unprompted updatable version', () => {
  const entry = installedEntry();
  const read = (policy: 'manual' | 'auto', prompted: string | null = null) => () => ({ policy, lastAutoPromptedVersion: prompted });
  assert.equal(planAppUpdateAutoPrompt([entry], read('manual')), null);
  assert.deepEqual(planAppUpdateAutoPrompt([entry], read('auto')), {
    entryKey: 'verified:nimi.lab',
    appId: 'nimi.lab',
    version: '0.2.0',
  });
  assert.equal(planAppUpdateAutoPrompt([entry], read('auto', '0.2.0')), null);
  assert.equal(planAppUpdateAutoPrompt([installedEntry({ policyBlocked: true })], read('auto')), null);
  assert.equal(planAppUpdateAutoPrompt([installedEntry({ running: true })], read('auto')), null);
  assert.equal(planAppUpdateAutoPrompt([installedEntry({ catalogVersion: null })], read('auto')), null);
  const manualFirst = installedEntry({ appId: 'nimi.first' });
  const autoSecond = installedEntry({ appId: 'nimi.second' });
  const candidate = planAppUpdateAutoPrompt([manualFirst, autoSecond], (appId) => ({
    policy: appId === 'nimi.second' ? 'auto' : 'manual',
    lastAutoPromptedVersion: null,
  }));
  assert.equal(candidate?.entryKey, 'verified:nimi.second');
});
