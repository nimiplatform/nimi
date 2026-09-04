import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LocalDevelopmentRegistration } from '../src/shell/renderer/features/local-development/local-development-types.js';
import {
  appArtworkFor,
  appPackagePhaseLocaleKey,
  appRunVisualState,
  appSourceForEntry,
  deriveIconGlyph,
  filterAppsEntries,
  resolveDetailEntryKey,
  sortAppsEntries,
} from '../src/shell/renderer/features/apps/apps-card-fields.js';
import {
  AppPackageJobKind,
  AppPackageJobPhase,
  AppPackageProgressBasis,
  AppPackageSourceClass,
  AppPackageTerminalResult,
  type AppPackageJob,
  type CommittedAppRelease,
} from '@nimiplatform/sdk/runtime/wire-types';
import type { DesktopAppsEntry } from '../src/shell/renderer/features/apps/apps-panel-projection.js';
import { readmeExternalHref } from '../src/shell/renderer/features/apps/apps-readme-markdown.js';

function registration(
  overrides: Partial<LocalDevelopmentRegistration> = {},
): LocalDevelopmentRegistration {
  return {
    selector: 'dev-project-example',
    appId: 'example.local-app',
    displayName: 'Example Local App',
    canonicalProjectRoot: '/projects/example',
    shell: 'electron',
    appAccess: [],
    aiConfigAllowedRoutes: ['local', 'cloud'],
    sourceGeneration: 1,
    declarationGeneration: 2,
    registeredAtUnixMs: 1_721_000_000_000,
    updatedAtUnixMs: 1_722_000_000_000,
    ...overrides,
  };
}

function entry(
  overrides: Partial<LocalDevelopmentRegistration> = {},
  runState: string | null = null,
): DesktopAppsEntry {
  const row = registration(overrides);
  return {
    identity: {
      entryKey: `local_development:${row.appId}:${row.selector}`,
      appId: row.appId,
      sourceClass: 'local_development',
      displayName: row.displayName,
      updatedAtUnixMs: row.updatedAtUnixMs,
    },
    catalogTarget: null,
    localDevelopment: row,
    committedRelease: null,
    packageJob: null,
    run: runState === null
      ? null
      : {
        selector: row.selector,
        appId: row.appId,
        displayName: row.displayName,
        canonicalProjectRoot: row.canonicalProjectRoot,
        shell: row.shell,
        state: runState,
        message: '',
        retryable: false,
        hostGeneration: 1,
      },
    aiConfigSummary: null,
    iconUrl: null,
  };
}

describe('Apps identity glyph', () => {
  it('derives an uppercase first character and falls back closed', () => {
    assert.equal(deriveIconGlyph('Nimi Lab'), 'N');
    assert.equal(deriveIconGlyph('  时镜 ShiJing  '), '时');
    assert.equal(deriveIconGlyph(''), '?');
    assert.equal(deriveIconGlyph('   '), '?');
  });
});

describe('Apps artwork derivation', () => {
  it('is deterministic for the same appId', () => {
    assert.deepEqual(appArtworkFor('nimi.lab'), appArtworkFor('nimi.lab'));
    assert.deepEqual(appArtworkFor('nimi.zhiyu'), appArtworkFor('nimi.zhiyu'));
  });

  it('always returns a usable gradient pair', () => {
    for (const appId of ['nimi.lab', 'nimi.parentos', 'nimi.shijing', 'nimi.overtone', 'nimi.storybook', 'nimi.inscape']) {
      const artwork = appArtworkFor(appId);
      assert.ok(artwork.iconBackground.startsWith('linear-gradient('), `icon gradient for ${appId}`);
      assert.ok(artwork.coverBackground.startsWith('linear-gradient('), `cover gradient for ${appId}`);
    }
  });

  it('spreads distinct appIds across multiple palettes', () => {
    const seen = new Set(
      Array.from({ length: 24 }, (_, index) => appArtworkFor(`nimi.app-${index}`).iconBackground),
    );
    assert.ok(seen.size >= 3, `expected palette spread, got ${seen.size}`);
  });
});

describe('Apps run visual state', () => {
  it('maps host run states to presentation states', () => {
    assert.equal(appRunVisualState('running'), 'running');
    assert.equal(appRunVisualState('building'), 'starting');
    assert.equal(appRunVisualState('stopping'), 'starting');
    assert.equal(appRunVisualState('stopped'), 'stopped');
    assert.equal(appRunVisualState(null), 'stopped');
  });

  it('keeps terminal launch failures visually distinct from a clean stop', () => {
    assert.equal(appRunVisualState('failed'), 'failed');
    assert.equal(appRunVisualState('build-failed'), 'failed');
    assert.equal(appRunVisualState('cleanup-failed'), 'failed');
    assert.equal(appRunVisualState('registration-unavailable'), 'failed');
    assert.equal(appRunVisualState('launcher-disconnected'), 'stopped');
    assert.equal(appRunVisualState('registration-removed'), 'stopped');
  });
});

describe('Apps Runtime package presentation', () => {
  const verifiedRelease = {
    appId: 'example.local-app',
    sourceClass: AppPackageSourceClass.VERIFIED,
    version: '1.0.0',
    releaseRef: 'release:verified',
    launchSelector: new Uint8Array([1]),
  } as CommittedAppRelease;
  const uninstallingJob = {
    jobId: new Uint8Array([1]),
    appId: verifiedRelease.appId,
    sourceClass: verifiedRelease.sourceClass,
    kind: AppPackageJobKind.UNINSTALL,
    targetRef: verifiedRelease.releaseRef,
    phase: AppPackageJobPhase.REMOVING_PACKAGE,
    progressBasis: AppPackageProgressBasis.INDETERMINATE,
    bytesCompleted: '0',
    stepsCompleted: '0',
    terminalResult: AppPackageTerminalResult.UNSPECIFIED,
    reasonCode: '',
    cancelable: false,
  } as AppPackageJob;

  it('preserves local-development and verified package sources', () => {
    const local = entry();
    assert.equal(appSourceForEntry(local), 'local_development');
    assert.equal(appSourceForEntry({
      ...local,
      identity: { ...local.identity, entryKey: 'verified:example.local-app', sourceClass: 'verified' },
      localDevelopment: null,
      committedRelease: verifiedRelease,
      run: null,
    }), 'verified');
  });

  it('keeps active uninstall phases distinct from terminal uninstalled', () => {
    assert.equal(appPackagePhaseLocaleKey(uninstallingJob), 'uninstalling');
    assert.equal(appPackagePhaseLocaleKey({
      ...uninstallingJob,
      phase: AppPackageJobPhase.COMPLETED,
      terminalResult: AppPackageTerminalResult.COMPLETED,
    }), 'uninstalled');
  });
});

describe('Apps library filtering', () => {
  const entries = [
    entry({ appId: 'nimi.lab', displayName: 'Nimi Lab' }),
    entry({ appId: 'example.mirror', displayName: 'Mirror App' }),
  ];

  it('returns all entries for a blank query', () => {
    assert.equal(filterAppsEntries(entries, '').length, 2);
    assert.equal(filterAppsEntries(entries, '   ').length, 2);
  });

  it('matches display name and appId case-insensitively', () => {
    assert.equal(filterAppsEntries(entries, 'LAB')[0]?.identity.appId, 'nimi.lab');
    assert.equal(filterAppsEntries(entries, 'MIRROR')[0]?.identity.appId, 'example.mirror');
    assert.equal(filterAppsEntries(entries, 'nothing').length, 0);
  });
});

describe('Apps library sorting', () => {
  const older = entry({ appId: 'b.older', displayName: 'Bravo', updatedAtUnixMs: 1_721_000_000_000 });
  const newer = entry({ appId: 'a.newer', displayName: 'Alpha', updatedAtUnixMs: 1_723_000_000_000 });
  const running = entry(
    { appId: 'c.running', displayName: 'Charlie', updatedAtUnixMs: 1_720_000_000_000 },
    'running',
  );

  it('sorts by recently updated by default', () => {
    assert.deepEqual(
      sortAppsEntries([older, running, newer], 'updated').map((row) => row.identity.appId),
      ['a.newer', 'b.older', 'c.running'],
    );
  });

  it('sorts by display name', () => {
    assert.deepEqual(
      sortAppsEntries([older, running, newer], 'name').map((row) => row.identity.appId),
      ['a.newer', 'b.older', 'c.running'],
    );
  });

  it('puts active runs first for activity sort', () => {
    assert.deepEqual(
      sortAppsEntries([older, newer, running], 'activity').map((row) => row.identity.appId),
      ['c.running', 'a.newer', 'b.older'],
    );
  });
});

describe('Apps detail selection resolution', () => {
  const entries = [entry({ appId: 'nimi.lab' }), entry({ appId: 'nimi.zhiyu' })];

  it('keeps a selection whose entry is still projected', () => {
    assert.equal(resolveDetailEntryKey(entries, entries[0]!.identity.entryKey), entries[0]!.identity.entryKey);
  });

  it('clears a selection whose entry disappeared instead of fabricating one', () => {
    assert.equal(resolveDetailEntryKey(entries, 'verified:nimi.gone'), null);
    assert.equal(resolveDetailEntryKey(entries, null), null);
    assert.equal(resolveDetailEntryKey([], 'local_development:nimi.lab:dev'), null);
  });
});

describe('Apps README external links', () => {
  it('admits only absolute HTTP links for the Desktop external-url bridge', () => {
    assert.equal(readmeExternalHref('https://example.com/docs'), 'https://example.com/docs');
    assert.equal(readmeExternalHref('http://127.0.0.1:3000/readme'), 'http://127.0.0.1:3000/readme');
    assert.equal(readmeExternalHref('./docs/setup.md'), null);
    assert.equal(readmeExternalHref('mailto:hello@example.com'), null);
    assert.equal(readmeExternalHref('javascript:alert(1)'), null);
  });
});
