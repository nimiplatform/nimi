// Merged App identity across sources: primary selection, fallback naming,
// rail filtering/sorting/sectioning, and detail sibling sources.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterAppGroups,
  groupAppsEntries,
  siblingSourceEntries,
  sortAppGroups,
  splitRunningGroups,
} from '../src/shell/renderer/features/apps/apps-entry-groups';
import type { DesktopAppsEntry } from '../src/shell/renderer/features/apps/apps-panel-projection';
import type { LocalDevelopmentRegistration } from '../src/shell/renderer/features/local-development/local-development-types';
import {
  AppPackageSourceClass,
  type CommittedAppRelease,
} from '@nimiplatform/sdk/runtime/wire-types';

function devEntry(overrides: {
  readonly appId?: string;
  readonly selector?: string;
  readonly displayName?: string;
  readonly updatedAtUnixMs?: number;
  readonly runState?: string | null;
  readonly iconUrl?: string | null;
} = {}): DesktopAppsEntry {
  const appId = overrides.appId ?? 'nimi.lab';
  const selector = overrides.selector ?? `dev-${appId}`;
  const registration: LocalDevelopmentRegistration = {
    selector,
    appId,
    displayName: overrides.displayName ?? 'Nimi Lab',
    canonicalProjectRoot: `/projects/${appId}`,
    shell: 'electron',
    appAccess: ['runtime.consume'],
    aiConfigAllowedRoutes: ['local', 'cloud'],
    sourceGeneration: 1,
    declarationGeneration: 1,
    registeredAtUnixMs: 1_721_000_000_000,
    updatedAtUnixMs: overrides.updatedAtUnixMs ?? 1_722_000_000_000,
  };
  return {
    identity: {
      entryKey: `local_development:${appId}:${selector}`,
      appId,
      sourceClass: 'local_development',
      displayName: registration.displayName,
      updatedAtUnixMs: registration.updatedAtUnixMs,
    },
    catalogTarget: null,
    localDevelopment: registration,
    committedRelease: null,
    packageJob: null,
    run: overrides.runState
      ? {
        selector,
        appId,
        displayName: registration.displayName,
        canonicalProjectRoot: registration.canonicalProjectRoot,
        shell: 'electron',
        state: overrides.runState,
        message: '',
        retryable: false,
        hostGeneration: 1,
      }
      : null,
    aiConfigSummary: null,
    iconUrl: overrides.iconUrl ?? null,
    summary: null,
  };
}

function installedEntry(overrides: {
  readonly appId?: string;
  readonly sourceClass?: 'verified' | 'user_imported';
  readonly displayName?: string;
  readonly updatedAtUnixMs?: number;
  readonly runState?: 'running' | 'stopped' | 'crashed' | null;
} = {}): DesktopAppsEntry {
  const appId = overrides.appId ?? 'nimi.lab';
  const sourceClass = overrides.sourceClass ?? 'verified';
  const committedRelease = {
    appId,
    sourceClass: sourceClass === 'verified' ? AppPackageSourceClass.VERIFIED : AppPackageSourceClass.USER_IMPORTED,
    version: '1.0.0',
    releaseRef: `release:${appId}:1.0.0`,
    launchSelector: new Uint8Array([1]),
    committedAt: { seconds: '1788134400', nanos: 0 },
  } as CommittedAppRelease;
  return {
    identity: {
      entryKey: `${sourceClass}:${appId}`,
      appId,
      sourceClass,
      displayName: overrides.displayName ?? appId,
      updatedAtUnixMs: overrides.updatedAtUnixMs ?? 1_788_134_400_000,
    },
    catalogTarget: null,
    localDevelopment: null,
    committedRelease,
    packageJob: null,
    run: overrides.runState
      ? {
        launchSelector: [1],
        state: overrides.runState,
        accessAvailable: true,
        accessReasonCode: '',
        message: '',
      }
      : null,
    aiConfigSummary: null,
    iconUrl: null,
    summary: null,
  };
}

test('sources of one App merge into a single group with the live run as primary', () => {
  const dev = devEntry({ updatedAtUnixMs: 1_722_000_000_000 });
  const runningDev = devEntry({ selector: 'dev-nimi.lab-2', runState: 'running', updatedAtUnixMs: 1_721_000_000_000 });
  const installed = installedEntry({ displayName: 'Nimi Lab' });
  const groups = groupAppsEntries([dev, installed, runningDev]);
  assert.equal(groups.length, 1, 'three sources merge into one row');
  const group = groups[0]!;
  assert.equal(group.primary.identity.entryKey, runningDev.identity.entryKey, 'live run wins primary');
  assert.equal(group.running, true);
  assert.equal(group.active, true);
  assert.deepEqual(group.sourceClasses, ['local_development', 'verified'], 'distinct sources, primary first');
  assert.equal(group.displayName, 'Nimi Lab');
  assert.equal(group.updatedAtUnixMs, installed.identity.updatedAtUnixMs, 'group activity is the newest source update');
});

test('primary prefers installed releases over local development, dev over catalog-only', () => {
  const dev = devEntry();
  const verified = installedEntry({ displayName: 'Nimi Lab' });
  assert.equal(
    groupAppsEntries([dev, verified])[0]!.primary.identity.entryKey,
    verified.identity.entryKey,
    'verified install outranks the dev registration',
  );
  const imported = installedEntry({ sourceClass: 'user_imported', displayName: 'Nimi Lab' });
  assert.equal(
    groupAppsEntries([dev, imported])[0]!.primary.identity.entryKey,
    imported.identity.entryKey,
    'imported install outranks the dev registration',
  );
  const catalogOnly: DesktopAppsEntry = {
    ...verified,
    committedRelease: null,
  };
  assert.equal(
    groupAppsEntries([dev, catalogOnly])[0]!.primary.identity.entryKey,
    dev.identity.entryKey,
    'runnable dev registration outranks a not-installed catalog entry',
  );
});

test('group naming and artwork fall back to entries with real metadata', () => {
  const installed = installedEntry({ displayName: 'nimi.lab' });
  const dev = devEntry({ displayName: 'Nimi Lab', iconUrl: 'data:image/png;base64,xx' });
  const group = groupAppsEntries([installed, dev])[0]!;
  assert.equal(group.primary.identity.displayName, 'nimi.lab', 'installed stays primary without a run');
  assert.equal(group.displayName, 'Nimi Lab', 'bare appId names yield to a real source name');
  assert.equal(group.iconUrl, 'data:image/png;base64,xx', 'icon falls back to the entry that has one');
});

test('rail filtering matches any source name or App ID', () => {
  const groups = groupAppsEntries([
    devEntry({ appId: 'nimi.lab', displayName: 'Nimi Lab' }),
    installedEntry({ appId: 'example.other', displayName: 'Other App' }),
  ]);
  assert.equal(filterAppGroups(groups, '').length, 2, 'empty query keeps all groups');
  assert.equal(filterAppGroups(groups, 'lab')[0]!.appId, 'nimi.lab', 'name match');
  assert.equal(filterAppGroups(groups, 'EXAMPLE.OTHER')[0]!.appId, 'example.other', 'App ID match is case-insensitive');
  assert.equal(filterAppGroups(groups, 'missing').length, 0, 'no match filters out');
});

test('rail sorting and running sectioning stay stable', () => {
  const older = groupAppsEntries([devEntry({ appId: 'nimi.older', displayName: 'Older', updatedAtUnixMs: 1_700_000_000_000 })])[0]!;
  const newer = groupAppsEntries([devEntry({ appId: 'nimi.newer', displayName: 'Newer', updatedAtUnixMs: 1_800_000_000_000 })])[0]!;
  const running = groupAppsEntries([devEntry({ appId: 'nimi.running', displayName: 'Running', runState: 'running', updatedAtUnixMs: 1_600_000_000_000 })])[0]!;
  const byName = sortAppGroups([newer, running, older], 'name');
  assert.deepEqual(byName.map((group) => group.appId), ['nimi.newer', 'nimi.older', 'nimi.running']);
  const byUpdated = sortAppGroups([older, running, newer], 'updated');
  assert.deepEqual(byUpdated.map((group) => group.appId), ['nimi.newer', 'nimi.older', 'nimi.running']);
  const byActivity = sortAppGroups([older, newer, running], 'activity');
  assert.deepEqual(byActivity.map((group) => group.appId), ['nimi.running', 'nimi.newer', 'nimi.older']);
  const sections = splitRunningGroups(byUpdated);
  assert.deepEqual(sections.running.map((group) => group.appId), ['nimi.running']);
  assert.deepEqual(sections.rest.map((group) => group.appId), ['nimi.newer', 'nimi.older']);
});

test('detail sibling sources exclude the open entry and keep primary order', () => {
  const dev = devEntry();
  const installed = installedEntry({ displayName: 'Nimi Lab' });
  const entries = [dev, installed];
  const siblingsOfInstalled = siblingSourceEntries(entries, installed);
  assert.deepEqual(siblingsOfInstalled.map((entry) => entry.identity.entryKey), [dev.identity.entryKey]);
  const siblingsOfDev = siblingSourceEntries(entries, dev);
  assert.deepEqual(siblingsOfDev.map((entry) => entry.identity.entryKey), [installed.identity.entryKey]);
  assert.deepEqual(siblingSourceEntries(entries, devEntry({ appId: 'nimi.alone' })), [], 'unknown entry has no siblings');
});
