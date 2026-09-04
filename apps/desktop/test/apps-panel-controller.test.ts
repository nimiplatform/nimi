import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  applyAppsPanelAIConfigAcknowledgement,
  assertAppsAction,
} from '../src/shell/renderer/features/apps/apps-panel-controller.js';
import type {
  DesktopAppsEntry,
  DesktopAppsPanelProjection,
} from '../src/shell/renderer/features/apps/apps-panel-projection.js';
import type { NimiAIConfigOverwriteResult } from '@nimiplatform/kit/core/sdk-contract';
import {
  actionPlanForEntry,
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
    assert.throws(() => unsafe('install'), /Unsupported Apps action/);
    assert.throws(() => unsafe('update'), /Unsupported Apps action/);
    assert.throws(() => unsafe('repair'), /Unsupported Apps action/);
  });

  it('keeps non-development entries browse-only until installed lifecycle actions exist', () => {
    assert.deepEqual(actionPlanForEntry({ localDevelopment: null, packageJob: null, run: null }), {
      primary: null,
      secondary: [{ id: 'details' }],
    });
  });

  it('exposes cancel only for a Runtime-cancelable package job', () => {
    const cancelable = actionPlanForEntry({
      localDevelopment: null,
      packageJob: { cancelable: true },
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

  it('acknowledges AIConfig only on the exact source entry', () => {
    const entry = (entryKey: string, sourceClass: DesktopAppsEntry['identity']['sourceClass']): DesktopAppsEntry => ({
      identity: {
        entryKey,
        appId: 'example.shared',
        sourceClass,
        displayName: 'Example Shared',
        updatedAtUnixMs: 1,
      },
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
