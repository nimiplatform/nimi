import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LocalDevelopmentRegistration, LocalDevelopmentRun } from '../src/shell/renderer/features/local-development/local-development-types.js';
import { desktopAppsEntryKey, projectAppsPanel } from '../src/shell/renderer/features/apps/apps-panel-projection.js';
import {
  AppPackageJobKind,
  AppPackageJobPhase,
  AppPackageProgressBasis,
  AppPackageSourceClass,
  AppPackageTerminalResult,
  type AppPackageJob,
  type CommittedAppRelease,
} from '@nimiplatform/sdk/runtime/wire-types';

function registration(): LocalDevelopmentRegistration {
  return {
    selector: 'dev-example-shared', appId: 'example.shared', displayName: 'Example development App',
    canonicalProjectRoot: '/projects/example.shared', shell: 'electron', appAccess: ['runtime.consume'],
    aiConfigAllowedRoutes: ['local', 'cloud'], sourceGeneration: 1, declarationGeneration: 1,
    registeredAtUnixMs: 1_700_000_000_000, updatedAtUnixMs: 1_700_000_001_000,
  };
}

function run(): LocalDevelopmentRun {
  return {
    appId: 'example.shared', displayName: 'Example development App', canonicalProjectRoot: '/projects/example.shared',
    shell: 'electron', state: 'running', message: '', retryable: false, hostGeneration: 1,
  };
}

function release(sourceClass: AppPackageSourceClass, version: string): CommittedAppRelease {
  return {
    appId: 'example.shared', sourceClass, version, releaseRef: `release:${sourceClass}:${version}`,
    launchSelector: new Uint8Array([sourceClass]), committedAt: { seconds: '1788134400', nanos: 0 },
  };
}

function job(sourceClass: AppPackageSourceClass, phase = AppPackageJobPhase.DOWNLOADING): AppPackageJob {
  return {
    jobId: new Uint8Array([sourceClass, phase]), appId: 'example.shared', sourceClass,
    kind: AppPackageJobKind.UPDATE, targetRef: `target:${sourceClass}`, phase,
    progressBasis: AppPackageProgressBasis.INDETERMINATE, bytesCompleted: '0', stepsCompleted: '0',
    terminalResult: AppPackageTerminalResult.UNSPECIFIED, reasonCode: '', cancelable: true,
    startedAt: { seconds: '1788134401', nanos: 0 },
  };
}

const emptyLocal = {
  listRegistrations: async () => [] as LocalDevelopmentRegistration[],
  listRuns: async () => [] as LocalDevelopmentRun[],
};

describe('Desktop Apps source-qualified projection', () => {
  it('keeps local-development, verified, and user-imported rows distinct for one appId', async () => {
    const projection = await projectAppsPanel({
      listRegistrations: async () => [registration()], listRuns: async () => [run()],
      listCommittedReleases: async () => [
        release(AppPackageSourceClass.VERIFIED, '1.0.0'),
        release(AppPackageSourceClass.USER_IMPORTED, '2.0.0'),
      ],
      listPackageJobs: async () => [job(AppPackageSourceClass.VERIFIED), job(AppPackageSourceClass.USER_IMPORTED)],
    });
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;
    assert.equal(projection.catalogStatus, 'not-implemented');
    assert.deepEqual(projection.entries.map((entry) => entry.identity.sourceClass).sort(), ['local_development', 'user_imported', 'verified']);
    assert.equal(new Set(projection.entries.map((entry) => entry.identity.entryKey)).size, 3);
    assert.equal(projection.entries.find((entry) => entry.identity.sourceClass === 'local_development')?.run?.state, 'running');
    assert.equal(projection.entries.find((entry) => entry.identity.sourceClass === 'verified')?.committedRelease?.version, '1.0.0');
    assert.equal(projection.entries.find((entry) => entry.identity.sourceClass === 'user_imported')?.committedRelease?.version, '2.0.0');
  });

  it('permits one active job per source and rejects duplicates only within that source', async () => {
    const allowed = await projectAppsPanel({ ...emptyLocal, listCommittedReleases: async () => [], listPackageJobs: async () => [job(AppPackageSourceClass.VERIFIED), job(AppPackageSourceClass.USER_IMPORTED)] });
    assert.equal(allowed.status, 'loaded');
    const conflict = await projectAppsPanel({ ...emptyLocal, listCommittedReleases: async () => [], listPackageJobs: async () => [job(AppPackageSourceClass.VERIFIED), job(AppPackageSourceClass.VERIFIED, AppPackageJobPhase.VERIFYING)] });
    assert.equal(conflict.status, 'error');
    if (conflict.status === 'error') assert.match(conflict.detail, /verified:example\.shared/u);
  });

  it('projects installed rows without fabricating catalog or running truth', async () => {
    const projection = await projectAppsPanel({ ...emptyLocal, listCommittedReleases: async () => [release(AppPackageSourceClass.USER_IMPORTED, '2.0.0')], listPackageJobs: async () => [] });
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;
    assert.equal(projection.entries[0]?.identity.entryKey, desktopAppsEntryKey('example.shared', 'user_imported'));
    assert.equal(projection.entries[0]?.localDevelopment, null);
    assert.equal(projection.entries[0]?.run, null);
    assert.equal(projection.entries[0]?.aiConfigSummary, null);
  });

  it('marks catalog search unimplemented instead of calling Realm or returning fake rows', async () => {
    const projection = await projectAppsPanel({ ...emptyLocal, listCommittedReleases: async () => [], listPackageJobs: async () => [] });
    assert.deepEqual(projection, { status: 'loaded', entries: [], catalogStatus: 'not-implemented', runtimeError: null });
  });
});
