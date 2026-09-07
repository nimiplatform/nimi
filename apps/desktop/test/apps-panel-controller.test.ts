import { createAppsInstallIntentController } from '../src/shell/renderer/features/apps/apps-install-intent.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  applyAppsPanelAIConfigAcknowledgement,
  createAppsPanelProjectionReloader,
  assertAppsAction,
  requestAppsInstallFromDetail,
} from '../src/shell/renderer/features/apps/apps-panel-controller.js';
import type {
  DesktopAppsEntry,
  DesktopAppsPanelProjection,
} from '../src/shell/renderer/features/apps/apps-panel-projection.js';
import type { NimiAIConfigOverwriteResult } from '@nimiplatform/kit/core/sdk-contract';
import {
  actionPlanForEntry,
  canRequestCatalogInstall,
  canRequestUninstall,
  actionPlanForLocalDevelopmentEntry,
} from '../src/shell/renderer/features/apps/apps-card-actions.js';
import {
  assertCanceledPackageJobResponse,
  dispatchAppsPanelCardAction,
} from '../src/shell/renderer/features/apps/apps-panel.js';
import {
  AppPackageJobKind,
  AppPackageJobPhase,
  AppPackageProgressBasis,
  AppPackageSourceClass,
  AppPackageTerminalResult,
  ReasonCode,
  type AppPackageJob,
  type ApprovedAppCatalogTarget,
} from '@nimiplatform/sdk/runtime/wire-types';

describe('Desktop Apps controller action boundary', () => {
  it('maps stopped development apps to launch and running apps to stop', () => {
    assert.equal(actionPlanForLocalDevelopmentEntry(null).primary?.id, 'launch');
    assert.equal(actionPlanForLocalDevelopmentEntry('running').primary?.id, 'stop');
    assert.equal(actionPlanForLocalDevelopmentEntry('build-failed').primary?.id, 'stop');
    assert.equal(actionPlanForLocalDevelopmentEntry('cleanup-failed').primary?.id, 'stop');
    assert.equal(actionPlanForLocalDevelopmentEntry('launcher-disconnected').primary?.id, 'launch');
  });

  it('fails closed if an untyped lifecycle action reaches the controller', () => {
    const unsafe = assertAppsAction as unknown as (action: string) => void;
    assert.throws(() => unsafe('update'), /Unsupported Apps action/);
    assert.throws(() => unsafe('repair'), /Unsupported Apps action/);
  });

  it('keeps non-development entries browse-only until installed lifecycle actions exist', () => {
    assert.deepEqual(actionPlanForEntry({ catalogTarget: null, committedRelease: null, localDevelopment: null, packageJob: null, run: null }), {
      primary: null,
      secondary: [{ id: 'details' }],
    });
  });

  it('keeps Catalog cards browse-only and enables install only from eligible detail facts', () => {
    const installable = {
      catalogTarget: { policyBlocked: false }, committedRelease: null, localDevelopment: null, packageJob: null, run: null,
    };
    assert.equal(actionPlanForEntry(installable).primary, null);
    assert.equal(canRequestCatalogInstall(installable), true);
    assert.equal(canRequestCatalogInstall({
      catalogTarget: { policyBlocked: true }, committedRelease: null, localDevelopment: null, packageJob: null, run: null,
    }), false);
    assert.equal(canRequestCatalogInstall({
      catalogTarget: { policyBlocked: false }, committedRelease: null, localDevelopment: null,
      packageJob: { cancelable: false, phase: AppPackageJobPhase.COMMITTING }, run: null,
    }), false);
  });

  it('composes detail Install with the exact unsigned intent controller without a product SDK port', async () => {
    const target = {
      approvedTargetSelector: new Uint8Array([1, 2, 3]), observedRegistryRevision: 'a'.repeat(40),
      descriptorId: 'publisher.example@1.0.0', appId: 'publisher.example', displayName: 'Example App', version: '1.0.0',
      publisherGithubNamespace: 'publisher', targetId: 'windows-x86_64', os: 'windows', arch: 'x86_64',
      assetName: 'example.nimiapp', assetSize: '42', windowsCodeSigning: 'unsigned', policyBlocked: false, policyRevision: '0',
    } as ApprovedAppCatalogTarget;
    const entry: DesktopAppsEntry = {
      identity: { entryKey: 'verified:publisher.example', appId: target.appId, sourceClass: 'verified', displayName: target.displayName, updatedAtUnixMs: 0 },
      catalogTarget: target, localDevelopment: null, committedRelease: null, packageJob: null, run: null, aiConfigSummary: null, iconUrl: null, summary: null,
    };
    const starts: Uint8Array[] = [];
    const controller = createAppsInstallIntentController({
      startInstall: async (selector) => { starts.push(selector); return { kind: 'started' }; },
      refresh: () => undefined,
    });
    const requested = await requestAppsInstallFromDetail(entry, controller);
    assert.equal(requested.kind, 'confirmation-required');
    assert.equal(starts.length, 0);
    await controller.confirm();
    assert.deepEqual(starts.map((selector) => [...selector]), [[1, 2, 3]]);
  });

  it('exposes cancel only for a Runtime-cancelable package job', () => {
    const cancelable = actionPlanForEntry({
      catalogTarget: null,
      localDevelopment: null,
      committedRelease: null,
      packageJob: { cancelable: true, phase: AppPackageJobPhase.DOWNLOADING },
      run: null,
    });
    assert.deepEqual(cancelable.secondary.map((action) => action.id), ['details', 'cancel-job']);
  });

  it('cancels through the exact Runtime job carrier and user reason', () => {
    const source = readFileSync(new URL(
      '../src/shell/renderer/features/apps/apps-panel.tsx',
      import.meta.url,
    ), 'utf8');
    assert.match(source, /cancelAppPackageJob\(\{[\s\S]*jobId: job\.jobId,[\s\S]*expectedPhase: job\.phase,[\s\S]*reasonCode: 'user-canceled'/u);
  });

  it('accepts cancellation only for the same job after Runtime reaches CANCELED', () => {
    const requested = {
      jobId: new Uint8Array([1, 2]),
      appId: 'example.catalog-app',
      sourceClass: AppPackageSourceClass.VERIFIED,
      kind: AppPackageJobKind.INSTALL,
      targetRef: 'release:example',
      phase: AppPackageJobPhase.DOWNLOADING,
      progressBasis: AppPackageProgressBasis.INDETERMINATE,
      bytesCompleted: '0',
      stepsCompleted: '0',
      terminalResult: AppPackageTerminalResult.UNSPECIFIED,
      reasonCode: '',
      cancelable: true,
    } as AppPackageJob;
    const canceled = {
      ...requested,
      phase: AppPackageJobPhase.CANCELED,
      terminalResult: AppPackageTerminalResult.CANCELED,
      cancelable: false,
    };
    assert.doesNotThrow(() => assertCanceledPackageJobResponse(requested, {
      job: canceled,
      reasonCode: ReasonCode.ACTION_EXECUTED,
    }));
    assert.throws(() => assertCanceledPackageJobResponse(requested, {
      job: { ...canceled, jobId: new Uint8Array([9]) },
      reasonCode: ReasonCode.ACTION_EXECUTED,
    }), /Runtime rejected App package job cancellation/);
    assert.throws(() => assertCanceledPackageJobResponse(requested, {
      job: { ...canceled, phase: AppPackageJobPhase.DOWNLOADING },
      reasonCode: ReasonCode.ACTION_EXECUTED,
    }), /Runtime rejected App package job cancellation/);
  });

  it('replaces a stale external detail request when the user selects another App', () => {
    const events: string[] = [];
    dispatchAppsPanelCardAction({
      entryKey: 'local_development:nimi.parentos:dev-parentos',
      appId: 'nimi.parentos',
      action: 'details',
      setAppsDetailAppId: (appId) => events.push(`request:${String(appId)}`),
      runCardAction: (entryKey, action) => events.push(`controller:${entryKey}:${action}`),
    });

    assert.deepEqual(events, [
      'request:nimi.parentos',
      'controller:local_development:nimi.parentos:dev-parentos:details',
    ]);
  });

  it('requests the ai-models section when the AI config pill opens the detail', () => {
    const events: string[] = [];
    dispatchAppsPanelCardAction({
      entryKey: 'local_development:nimi.parentos:dev-parentos',
      appId: 'nimi.parentos',
      action: 'open-ai-config',
      setAppsDetailAppId: (appId, section) => {
        events.push(`request:${String(appId)}:${String(section ?? null)}`);
      },
      runCardAction: (entryKey, action) => events.push(`controller:${entryKey}:${action}`),
    });

    assert.deepEqual(events, [
      'request:nimi.parentos:ai-models',
      'controller:local_development:nimi.parentos:dev-parentos:open-ai-config',
    ]);
  });

  it('acknowledges AIConfig only on the exact source entry', () => {
    const entry = (entryKey: string, sourceClass: DesktopAppsEntry['identity']['sourceClass']): DesktopAppsEntry => ({
      identity: {
        entryKey,
        appId: 'example.shared',
        sourceClass,
        displayName: 'Example Shared',
        updatedAtUnixMs: 1,
      },
      catalogTarget: null,
      localDevelopment: null,
      committedRelease: null,
      packageJob: null,
      run: null,
      aiConfigSummary: null,
      iconUrl: null,
      summary: null,
    });
    const local = entry('local_development:example.shared:dev-example', 'local_development');
    const verified = entry('verified:example.shared', 'verified');
    const imported = entry('user_imported:example.shared', 'user_imported');
    const current: DesktopAppsPanelProjection = {
      status: 'loaded',
      entries: [local, verified, imported],
      catalogStatus: 'not-implemented',
      runtimeError: null,
    };
    const result: NimiAIConfigOverwriteResult = {
      outcome: 'committed',
      config: { capabilities: [] },
      revision: '2',
    };

    const acknowledged = applyAppsPanelAIConfigAcknowledgement(
      current,
      local.identity.entryKey,
      result,
    );

    assert.equal(acknowledged?.status, 'loaded');
    if (acknowledged?.status !== 'loaded') return;
    assert.notEqual(acknowledged.entries[0]?.aiConfigSummary, null);
    assert.equal(acknowledged.entries[1], verified);
    assert.equal(acknowledged.entries[2], imported);
  });
});

it('limits the current installed lifecycle to verified packages without promoting local imports', () => {
  const entry = { catalogTarget: null, committedRelease: { sourceClass: AppPackageSourceClass.USER_IMPORTED }, localDevelopment: null, packageJob: null, run: null };
  assert.equal(actionPlanForEntry(entry).primary, null);
  assert.equal(canRequestCatalogInstall(entry), false);
  assert.equal(canRequestUninstall(entry), false);
  const verified = { ...entry, committedRelease: { sourceClass: AppPackageSourceClass.VERIFIED } };
  assert.equal(actionPlanForEntry(verified).primary?.id, 'launch');
  assert.equal(canRequestUninstall(verified), true);
  assert.deepEqual(actionPlanForEntry({ ...verified, run: { state: 'running' } }).secondary.map((action) => action.id), ['details', 'stop']);
});

it('local lifecycle refresh completes while Catalog is pending and does not refetch it', async () => {
  let resolveCatalog!: (value: ApprovedAppCatalogTarget[]) => void;
  let catalogCalls = 0;
  let version = '1.0.0';
  let current: DesktopAppsPanelProjection | null = null;
  const observations: DesktopAppsPanelProjection[] = [];
  const reloader = createAppsPanelProjectionReloader({
    source: {
      listApprovedCatalogTargets: () => { catalogCalls += 1; return new Promise((resolve) => { resolveCatalog = resolve; }); },
      listCommittedReleases: async () => [{ appId: 'example.app', sourceClass: AppPackageSourceClass.VERIFIED, version, releaseRef: 'release', launchSelector: new Uint8Array([1]) }],
      listPackageJobs: async () => [], listRegistrations: async () => [], listRuns: async () => [],
    },
    getCurrent: () => current,
    commit: (next) => { current = next; observations.push(next); },
  });
  const catalog = reloader.refreshCatalog();
  await reloader.reload(false);
  const initial = observations.at(-1)!;
  assert.equal(initial.status, 'loaded');
  if (initial.status !== 'loaded') throw new Error('local projection failed');
  assert.equal(initial.catalogStatus, 'loading');
  assert.equal(initial.entries[0]?.committedRelease?.version, '1.0.0');
  version = '2.0.0';
  await reloader.reload(false);
  const updated = observations.at(-1)!;
  if (updated.status !== 'loaded') throw new Error('local projection failed');
  assert.equal(updated.entries[0]?.committedRelease?.version, '2.0.0');
  assert.equal(catalogCalls, 1);
  resolveCatalog([]);
  await catalog;
  const final = observations.at(-1)!;
  if (final.status !== 'loaded') throw new Error('local projection failed');
  assert.equal(final.catalogStatus, 'loaded');
  assert.equal(final.entries[0]?.committedRelease?.version, '2.0.0');
  reloader.dispose();
});
