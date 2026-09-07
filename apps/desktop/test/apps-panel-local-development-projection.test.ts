import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LocalDevelopmentRegistration, LocalDevelopmentRun } from '../src/shell/renderer/features/local-development/local-development-types.js';
import { deriveAppSummary, desktopAppsEntryKey, projectAppsPanel } from '../src/shell/renderer/features/apps/apps-panel-projection.js';
import {
  AppPackageJobKind,
  AppPackageJobPhase,
  AppPackageProgressBasis,
  AppPackageSourceClass,
  AppPackageTerminalResult,
  type ApprovedAppCatalogTarget,
  type AppPackageJob,
  type CommittedAppRelease,
} from '@nimiplatform/sdk/runtime/wire-types';

function registration(overrides: Partial<LocalDevelopmentRegistration> = {}): LocalDevelopmentRegistration {
  return {
    selector: 'dev-example-shared', appId: 'example.shared', displayName: 'Example development App',
    canonicalProjectRoot: '/projects/example.shared', shell: 'electron', appAccess: ['runtime.consume'],
    aiConfigAllowedRoutes: ['local', 'cloud'], sourceGeneration: 1, declarationGeneration: 1,
    registeredAtUnixMs: 1_700_000_000_000, updatedAtUnixMs: 1_700_000_001_000,
    ...overrides,
  };
}

function run(): LocalDevelopmentRun {
  return {
    selector: 'dev-example-shared', appId: 'example.shared', displayName: 'Example development App', canonicalProjectRoot: '/projects/example.shared',
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

function catalogTarget(overrides: Partial<ApprovedAppCatalogTarget> = {}): ApprovedAppCatalogTarget {
  return {
    approvedTargetSelector: new Uint8Array([1, 2, 3]), observedRegistryRevision: 'a'.repeat(40),
    descriptorId: 'example.shared@2.0.0', appId: 'example.shared', displayName: 'Example Catalog App', version: '2.0.0',
    publisherGithubNamespace: 'publisher', sourceRepository: 'https://github.com/publisher/example.shared', sourceLicenseSpdxExpression: 'MIT', appAccess: ['runtime.consume'],
    capabilityContractRefs: [], requiredStandardizedFeatureRefs: [], storagePolicyKind: 'nimi-mediated-default', osStorageDisclosures: [],
    targetId: 'windows-x86_64', os: 'windows', arch: 'x86_64', assetName: 'example.shared-2.0.0-windows-x86_64.nimiapp',
    assetSize: '42', executionProfileRef: 'windows-user-mode-as-invoker-v1', windowsCodeSigning: 'unsigned', policyBlocked: false, policyRevision: '0',
    ...overrides,
  };
}

const emptyLocal = {
  listRegistrations: async () => [] as LocalDevelopmentRegistration[],
  listRuns: async () => [] as LocalDevelopmentRun[],
};

describe('Desktop Apps source-qualified projection', () => {
  it('keeps local-development and verified rows distinct for one appId', async () => {
    const projection = await projectAppsPanel({
      listRegistrations: async () => [registration()], listRuns: async () => [run()],
      listCommittedReleases: async () => [release(AppPackageSourceClass.VERIFIED, '1.0.0')],
      listPackageJobs: async () => [job(AppPackageSourceClass.VERIFIED)],
    });
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;
    assert.equal(projection.catalogStatus, 'not-implemented');
    assert.deepEqual(projection.entries.map((entry) => entry.identity.sourceClass).sort(), ['local_development', 'verified']);
    assert.equal(new Set(projection.entries.map((entry) => entry.identity.entryKey)).size, 2);
    assert.equal(projection.entries.find((entry) => entry.identity.sourceClass === 'local_development')?.run?.state, 'running');
    assert.equal(projection.entries.find((entry) => entry.identity.sourceClass === 'verified')?.committedRelease?.version, '1.0.0');
  });

  it('merges one Catalog target with the same verified lifecycle row without collapsing Developer Mode', async () => {
    const target = catalogTarget();
    const projection = await projectAppsPanel({
      listApprovedCatalogTargets: async () => [target],
      listRegistrations: async () => [registration()], listRuns: async () => [run()],
      listCommittedReleases: async () => [release(AppPackageSourceClass.VERIFIED, '2.0.0')],
      listPackageJobs: async () => [],
    }, { catalog: { status: 'loaded', targets: [target] } });
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;
    assert.equal(projection.catalogStatus, 'loaded');
    assert.equal(projection.entries.length, 2);
    const verified = projection.entries.find((entry) => entry.identity.sourceClass === 'verified');
    assert.equal(verified?.identity.displayName, 'Example Catalog App');
    assert.equal(verified?.catalogTarget?.descriptorId, 'example.shared@2.0.0');
    assert.equal(verified?.committedRelease?.version, '2.0.0');
    target.approvedTargetSelector[0] = 9;
    assert.deepEqual([...(verified?.catalogTarget?.approvedTargetSelector ?? [])], [1, 2, 3]);
  });

  it('joins same-app local-development runs only by exact selector', async () => {
    const second = registration({
      selector: 'dev-example-shared-second',
      displayName: 'Second development App',
      canonicalProjectRoot: '/projects/example.shared.second',
      updatedAtUnixMs: 1_700_000_002_000,
    });
    const projection = await projectAppsPanel({
      listRegistrations: async () => [registration(), second],
      listRuns: async () => [run()],
      listCommittedReleases: async () => [],
      listPackageJobs: async () => [],
    });
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;
    const first = projection.entries.find((entry) => entry.localDevelopment?.selector === 'dev-example-shared');
    const other = projection.entries.find((entry) => entry.localDevelopment?.selector === 'dev-example-shared-second');
    assert.equal(first?.run && 'selector' in first.run ? first.run.selector : undefined, 'dev-example-shared');
    assert.equal(other?.run, null);
  });

  it('permits one verified active job and rejects duplicates', async () => {
    const allowed = await projectAppsPanel({ ...emptyLocal, listCommittedReleases: async () => [], listPackageJobs: async () => [job(AppPackageSourceClass.VERIFIED)] });
    assert.equal(allowed.status, 'loaded');
    const conflict = await projectAppsPanel({ ...emptyLocal, listCommittedReleases: async () => [], listPackageJobs: async () => [job(AppPackageSourceClass.VERIFIED), job(AppPackageSourceClass.VERIFIED, AppPackageJobPhase.VERIFYING)] });
    assert.equal(conflict.status, 'error');
    if (conflict.status === 'error') assert.match(conflict.detail, /verified:example\.shared/u);
  });

  it('projects installed rows without fabricating catalog or running truth', async () => {
    const projection = await projectAppsPanel({ ...emptyLocal, listCommittedReleases: async () => [release(AppPackageSourceClass.VERIFIED, '2.0.0')], listPackageJobs: async () => [] });
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;
    assert.equal(projection.entries[0]?.identity.entryKey, desktopAppsEntryKey('example.shared', 'verified'));
    assert.equal(projection.entries[0]?.localDevelopment, null);
    assert.equal(projection.entries[0]?.run, null);
    assert.equal(projection.entries[0]?.aiConfigSummary, null);
  });

  it('keeps imported, verified and development sources independent for the same app', async () => {
    const projection = await projectAppsPanel({
      ...emptyLocal,
      listRegistrations: async () => [registration()],
      listApprovedCatalogTargets: async () => [catalogTarget()],
      listCommittedReleases: async () => [release(AppPackageSourceClass.VERIFIED, '2.0.0'), release(AppPackageSourceClass.USER_IMPORTED, '1.0.0')],
      listPackageJobs: async () => [],
    }, { catalog: { status: 'loaded', targets: [catalogTarget()] } });
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;
    assert.deepEqual(projection.entries.map((entry) => entry.identity.sourceClass).sort(), ['local_development', 'user_imported', 'verified']);
    const imported = projection.entries.find((entry) => entry.identity.sourceClass === 'user_imported');
    assert.equal(imported?.catalogTarget, null);
    assert.equal(imported?.committedRelease?.version, '1.0.0');
  });

  it('fails closed on the unknown package source wire value', async () => {
    const projection = await projectAppsPanel({
      ...emptyLocal,
      listCommittedReleases: async () => [release(99 as AppPackageSourceClass, '2.0.0')],
      listPackageJobs: async () => [],
    });
    assert.equal(projection.status, 'error');
    if (projection.status === 'error') assert.match(projection.detail, /unsupported Runtime App package source: 99/iu);
  });

  it('marks catalog search unimplemented instead of calling Realm or returning fake rows', async () => {
    const projection = await projectAppsPanel({ ...emptyLocal, listCommittedReleases: async () => [], listPackageJobs: async () => [] });
    assert.deepEqual(projection, { status: 'loaded', entries: [], catalogStatus: 'not-implemented', runtimeError: null });
  });
});

describe('Desktop Apps project summary projection', () => {
  it('derives the card summary from the host-read project README', async () => {
    const projection = await projectAppsPanel({
      ...emptyLocal,
      listRegistrations: async () => [registration()],
      listCommittedReleases: async () => [],
      listPackageJobs: async () => [],
      readProjectReadme: async (selector: string) => {
        assert.equal(selector, 'dev-example-shared');
        return { content: '# Example App\n\n[![badge](img)](link)\n\n本地示例 App，用来演示平台能力。\n\n## Usage\n' };
      },
    });
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;
    assert.equal(projection.entries[0]?.summary, '本地示例 App，用来演示平台能力。');
  });

  it('keeps the summary null when the README bridge or prose is absent', async () => {
    const withoutBridge = await projectAppsPanel({
      ...emptyLocal,
      listRegistrations: async () => [registration()],
      listCommittedReleases: async () => [],
      listPackageJobs: async () => [],
    });
    assert.equal(withoutBridge.status, 'loaded');
    if (withoutBridge.status !== 'loaded') return;
    assert.equal(withoutBridge.entries[0]?.summary, null);

    const emptyReadme = await projectAppsPanel({
      ...emptyLocal,
      listRegistrations: async () => [registration()],
      listCommittedReleases: async () => [],
      listPackageJobs: async () => [],
      readProjectReadme: async () => ({ content: '# Only a title\n\n- bullet list is not an intro\n' }),
    });
    assert.equal(emptyReadme.status, 'loaded');
    if (emptyReadme.status !== 'loaded') return;
    assert.equal(emptyReadme.entries[0]?.summary, null);
  });

  it('reuses the previous summary while the registration is unchanged', async () => {
    let reads = 0;
    const source = {
      ...emptyLocal,
      listRegistrations: async () => [registration()],
      listCommittedReleases: async () => [],
      listPackageJobs: async () => [],
      readProjectReadme: async () => {
        reads += 1;
        return { content: '第一段简介。' };
      },
    };
    const first = await projectAppsPanel(source);
    assert.equal(first.status, 'loaded');
    if (first.status !== 'loaded') return;
    assert.equal(first.entries[0]?.summary, '第一段简介。');
    const second = await projectAppsPanel(source, { previous: first });
    assert.equal(second.status, 'loaded');
    if (second.status !== 'loaded') return;
    assert.equal(second.entries[0]?.summary, '第一段简介。');
    assert.equal(reads, 1, 'unchanged registration must not re-read the README');
  });
});

describe('deriveAppSummary', () => {
  it('skips headings, badges, HTML, and fences to reach the first prose paragraph', () => {
    const readme = [
      '# Title',
      '',
      '<p align="center"><img src="x.png" /></p>',
      '',
      '[![ci](badge.svg)](ci)',
      '',
      '```sh',
      'npm install',
      '```',
      '',
      '第一行简介。',
      '第二行继续。',
      '',
      '## 安装',
    ].join('\n');
    assert.equal(deriveAppSummary(readme), '第一行简介。 第二行继续。');
  });

  it('strips inline markdown and bounds the excerpt', () => {
    assert.equal(
      deriveAppSummary('使用 [Nimi SDK](https://example.com) 和 `nimi-app` 构建 **本地** App。'),
      '使用 Nimi SDK 和 nimi-app 构建 本地 App。',
    );
    const long = deriveAppSummary(`开头${'很长的介绍'.repeat(40)}`);
    assert.ok(long !== null && long.length <= 161 && long.endsWith('…'), 'expected a bounded excerpt');
  });

  it('returns null for empty or non-prose content', () => {
    assert.equal(deriveAppSummary(null), null);
    assert.equal(deriveAppSummary(''), null);
    assert.equal(deriveAppSummary('# 只有标题\n\n- 只有列表\n'), null);
  });
});
