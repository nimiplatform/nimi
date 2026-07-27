import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  NIMI_APP_AI_PROFILE_FACTORY_ROWS,
  type NimiAppAIProfileFactoryRow,
} from '@nimiplatform/sdk/app';
import { NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE } from '@nimiplatform/sdk/runtime';
import { ProductControlWorkflow } from '../src/shell/renderer/first-run/product-control-workflow.js';
import type { DesktopRendererClockView } from '../src/shell/renderer/renderer/contract.js';
import { createUnavailableDesktopFirstRunPort } from '../src/shell/renderer/renderer/first-run-port.js';

const TEST_CLOCK: DesktopRendererClockView = {
  now: () => 0,
  schedule: () => () => undefined,
  animationFrame: () => () => undefined,
};
const TEST_FIRST_RUN = createUnavailableDesktopFirstRunPort('TEST_FIRST_RUN_UNADMITTED');
import {
  resolveDesktopNimiFirstRunMaterializationProjection,
  startDesktopNimiFirstRunMaterialization,
  type DesktopNimiFirstRunMaterializationInput,
} from '../src/shell/renderer/first-run/runtime-materialization.js';
import type {
  NimiProductControlRecord,
  NimiProductControlRecordProjection,
  NimiProductControlState,
} from '../src/shell/renderer/bridge/runtime-bridge/product-control.js';

function projectionFor(
  state: NimiProductControlState,
  override: Partial<NimiProductControlRecord> = {},
): NimiProductControlRecordProjection {
  const dataRoot = override.dataRoot ?? (
    state === 'config_missing' || state === 'data_root_missing'
      ? null
      : {
          path: '/tmp/nimi-data-explicit',
          status: 'selected' as const,
          selectedAt: '2026-05-20T00:00:00.000Z',
          verifiedAt: '2026-05-20T00:00:00.000Z',
          selectedAtUnixMs: 1,
          verifiedAtUnixMs: 1,
        }
  );
  return {
    path: '/tmp/home/.nimi/nimi.json',
    exists: state !== 'config_missing',
    state,
    error: null,
    record: {
      schemaVersion: 1,
      installId: 'install-1',
      productVersion: '0.1.0',
      state,
      dataRoot,
      firstRun: {
        installLevel: null,
        aiProfileAlias: null,
        completed: false,
        completedAt: null,
        initializationPlanId: null,
        baselineProfileRef: null,
        baselineCommitId: null,
        accountDefaultProfileRef: null,
        builtInAiConfigRefs: [],
        runtimeBaselineRef: null,
        executionEvidenceRef: null,
        ...override.firstRun,
      },
      pointers: {},
      repair: { required: state === 'repair_required', reason: null },
      ...override,
    },
  };
}

function renderWorkflow(state: NimiProductControlState, override: Partial<NimiProductControlRecord> = {}): string {
  return renderToStaticMarkup(React.createElement(ProductControlWorkflow, {
    clock: TEST_CLOCK,
    firstRun: TEST_FIRST_RUN,
    projection: projectionFor(state, override),
    onProjectionChange: () => {},
  }));
}

function firstRunRows(): readonly NimiAppAIProfileFactoryRow[] {
  return NIMI_APP_AI_PROFILE_FACTORY_ROWS.filter((row) =>
    (row.applicableScopes as readonly string[]).includes('first-run'),
  );
}

test('config_missing renders as a transient Storage phase', () => {
  // The 4-phase wizard folds the fast `config_missing` system state into the
  // Storage phase as a calm transient loading affordance — it never gets its
  // own boxed data-root screen. `data_root_missing` is the first user-action
  // data-root state and presents the native folder picker (no raw absolute
  // path text field).
  const configMissing = renderWorkflow('config_missing');
  assert.match(configMissing, /data-product-state="config_missing"/);
  assert.match(configMissing, /Preparing Nimi on this device/);
  assert.match(configMissing, /data-phase-transient="true"/);
  assert.doesNotMatch(configMissing, /Choose folder/);

  const dataRootMissing = renderWorkflow('data_root_missing');
  assert.match(dataRootMissing, /data-phase-transient="false"/);
  assert.match(dataRootMissing, /Where should Nimi keep your models and data/);
  assert.match(dataRootMissing, /Choose folder/);
});

test('data_root_selected renders device scan before Local AI choices', () => {
  const scan = renderWorkflow('data_root_selected');
  assert.match(scan, /Check this device/);
  assert.match(scan, /Retry scan/);
  assert.match(scan, /Change folder/);
  assert.doesNotMatch(scan, /Set up your local AI/);

  const localAi = renderWorkflow('ai_environment_unconfigured');
  assert.match(localAi, /Set up your local AI/);
  assert.match(localAi, /Minimal/);
  assert.match(localAi, /Recommended/);
  assert.doesNotMatch(localAi, /cloud-first|hybrid-recommended/);
});

test('Local AI phase renders the selected install level and continuation action', () => {
  const markup = renderWorkflow('ai_environment_unconfigured', {
    firstRun: {
      installLevel: 'minimal',
      aiProfileAlias: 'local-speech-ready',
      completed: false,
      builtInAiConfigRefs: [],
    },
  });
  assert.match(markup, /data-product-state="ai_environment_unconfigured"/);
  assert.match(markup, /Set up your local AI/);
  assert.match(markup, /data-selected="true"/);
  assert.match(markup, />Continue</);
});

test('materialization progress states render one Setup checklist', () => {
  // The four product-progress states fold into the single Setup phase with
  // the materialization sub-step checklist.
  for (const state of [
    'local_ai_profile_selected_assets_missing',
    'local_ai_profile_selected_environment_not_ready',
    'local_ai_assets_downloaded_environment_not_ready',
  ] as const) {
    const markup = renderWorkflow(state, {
      firstRun: {
        installLevel: 'minimal',
        aiProfileAlias: 'local-speech-ready',
        completed: false,
        builtInAiConfigRefs: [],
      },
    });
    assert.match(markup, /Setting up Nimi/);
    assert.match(markup, /Downloading local models/);
  }
});

test('return-run verification downgrade renders reconciliation instead of setup', () => {
  const markup = renderWorkflow('local_ai_profile_selected_environment_not_ready', {
    state: 'ready_for_use',
    dataRoot: {
      path: '/tmp/nimi-data-explicit',
      status: 'ready',
      selectedAt: '2026-05-20T00:00:00.000Z',
      verifiedAt: '2026-05-20T00:00:00.000Z',
      selectedAtUnixMs: 1,
      verifiedAtUnixMs: 1,
    },
    firstRun: {
      installLevel: 'minimal',
      aiProfileAlias: 'local-speech-ready',
      completed: true,
      completedAt: '2026-05-20T00:00:00.000Z',
      initializationPlanId: 'first-run-plan:runtime-baseline:execution-evidence',
      baselineProfileRef: 'default',
      baselineCommitId: 'sha256:ready',
      accountDefaultProfileRef: 'account-default-profile:v1:ready',
      builtInAiConfigRefs: ['built-in-ai-config:v1:nimi', 'built-in-ai-config:v1:agent'],
      runtimeBaselineRef: 'runtime_baseline_ready',
      executionEvidenceRef: 'execution_evidence_ready',
    },
  });
  assert.match(markup, /data-product-state="local_ai_profile_selected_environment_not_ready"/);
  assert.match(markup, /Reconciling local readiness/);
  assert.doesNotMatch(markup, /Setting up Nimi/);
});

test('return-run repair downgrade renders the repair surface', () => {
  const markup = renderWorkflow('repair_required', {
    state: 'ready_for_use',
    dataRoot: {
      path: '/tmp/nimi-data-explicit',
      status: 'ready',
      selectedAt: '2026-05-20T00:00:00.000Z',
      verifiedAt: '2026-05-20T00:00:00.000Z',
      selectedAtUnixMs: 1,
      verifiedAtUnixMs: 1,
    },
    firstRun: {
      installLevel: 'minimal',
      aiProfileAlias: 'local-speech-ready',
      completed: true,
      completedAt: '2026-05-20T00:00:00.000Z',
      initializationPlanId: 'first-run-plan:runtime-baseline:execution-evidence',
      baselineProfileRef: 'default',
      baselineCommitId: 'sha256:ready',
      accountDefaultProfileRef: 'account-default-profile:v1:ready',
      builtInAiConfigRefs: ['built-in-ai-config:v1:nimi', 'built-in-ai-config:v1:agent'],
      runtimeBaselineRef: 'runtime_baseline_ready',
      executionEvidenceRef: 'execution_evidence_ready',
    },
    repair: {
      required: true,
      reason: 'runtime baseline repair required',
    },
  });
  assert.match(markup, /data-product-state="repair_required"/);
  assert.match(markup, /Nimi needs to repair a component/);
  assert.match(markup, />Retry</);
  assert.doesNotMatch(markup, /Reconciling local readiness/);
});

test('repair and blocked states render explicit failure surfaces', () => {
  const repair = renderWorkflow('repair_required');
  assert.match(repair, /Nimi needs to repair a component/);
  assert.match(repair, />Retry</);

  const blocked = renderWorkflow('blocked');
  assert.match(blocked, /Nimi cannot continue safely/);
  assert.doesNotMatch(blocked, />Continue</);
});

test('every first-run state renders human copy instead of its raw enum', () => {
  const allStates: NimiProductControlState[] = [
    'config_missing',
    'data_root_missing',
    'data_root_selected',
    'ai_environment_unconfigured',
    'local_ai_profile_selected_assets_missing',
    'local_ai_profile_selected_environment_not_ready',
    'local_ai_assets_downloaded_environment_not_ready',
    'local_ai_ready',
    'repair_required',
    'blocked',
    'ready_for_use',
  ];
  for (const state of allStates) {
    const markup = renderWorkflow(state, {
      firstRun: {
        installLevel: 'minimal',
        aiProfileAlias: 'local-speech-ready',
        completed: false,
        builtInAiConfigRefs: [],
      },
    });
    // The state machine state is carried only on the data attribute, never
    // as the primary user copy.
    assert.match(markup, new RegExp(`data-product-state="${state}"`));
    // Strip every data-* / id attribute value, then assert the raw enum
    // identifier never appears as visible text.
    const visibleText = markup
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    assert.ok(visibleText.length > 0, `${state} must render visible copy`);
    assert.doesNotMatch(
      visibleText,
      new RegExp(`(^|\\s)${state}(\\s|$)`),
      `${state} must not show its raw enum name as user-facing copy`,
    );
  }
});

test('factory AIProfile first-run candidates are local-only and fail closed against cloud, hybrid, and video', () => {
  assert.ok(firstRunRows().length > 0);
  for (const row of firstRunRows()) {
    assert.notEqual(row.computePosture, 'cloud-only');
    assert.notEqual(row.routingPolicy, 'cloud-first');
    assert.notEqual(row.routingPolicy, 'hybrid-explicit');
    assert.equal(row.capabilitySet.includes('video.generate'), false);
    assert.ok(row.localComputePackRefs.length > 0);
    assert.ok(row.dependencyFamilyRefs.length > 0);
  }
});

test('first-run materialization derives Runtime job requests from selected AIProfile pack and dependency refs', async () => {
  const profile = NIMI_APP_AI_PROFILE_FACTORY_ROWS.find((row) => row.alias === 'local-speech-ready');
  assert.ok(profile);
  const calls: Array<{ dependencyFamily: string; dependencyId: string; environmentKey: string; sourceKind: string; confirmed: boolean }> = [];
  const planInstallLevels: Array<string | undefined> = [];
  const runtime: DesktopNimiFirstRunMaterializationInput['runtime'] = {
    async resolveEnvironmentPlan(payload) {
      planInstallLevels.push(payload.installLevel);
      const dependencies = payload.packId === 'local-text'
        ? [
            dependency('native-engine-package.llama', 'native-engine-package.llama:default'),
            dependency('model.asset', 'model.asset:default'),
          ]
        : [
            dependency('python.tool.uv', 'python.tool.uv:default'),
            dependency('python.runtime', 'python.runtime:3.11'),
            dependency('python.venv', 'python.venv:first-run'),
            dependency('python.package-set', 'python.package-set:speech'),
          ];
      return {
        planId: `plan:${payload.packId}`,
        packId: payload.packId,
        productLabel: payload.packId,
        hostProfileId: 'darwin-arm64-metal',
        platformTuple: 'darwin-arm64',
        runtimeDataRoot: payload.runtimeDataRoot ?? '',
        consumerScope: payload.consumerScope,
        cloudOnlyImpact: '',
        state: 'needs_confirmation',
        dependencies,
      };
    },
    async listEnvironmentDependencyJobs() {
      return [];
    },
    async startEnvironmentDependencyJob(payload) {
      calls.push(payload);
      return {
        jobId: `job:${payload.dependencyId}`,
        environmentKey: payload.environmentKey,
        dependencyFamily: payload.dependencyFamily,
        dependencyId: payload.dependencyId,
        consumerScope: payload.consumerScope,
        state: 'queued',
        sourceKind: payload.sourceKind,
        retryable: false,
        bytesReceived: 0,
        bytesTotal: 0,
        percent: 0,
        speedBytesPerSec: 0,
        etaSeconds: 0,
      };
    },
    async cancelEnvironmentDependencyJob() {
      throw new Error('not used');
    },
    async retryEnvironmentDependencyJob() {
      throw new Error('not used');
    },
    async repairEnvironmentDependency() {
      throw new Error('not used');
    },
  };

  const unconfirmed = await startDesktopNimiFirstRunMaterialization({
    profile,
    runtime,
    runtimeDataRoot: '/tmp/nimi-data-explicit',
    installLevel: 'minimal',
    confirmed: false,
  });
  assert.equal(unconfirmed.status, 'needs_confirmation');
  assert.equal(calls.length, 0);

  const projection = await startDesktopNimiFirstRunMaterialization({
    profile,
    runtime,
    runtimeDataRoot: '/tmp/nimi-data-explicit',
    installLevel: 'minimal',
    confirmed: true,
  });
  assert.equal(projection.reason, 'runtime_materialization_jobs_started');
  assert.deepEqual(
    calls.map((call) => call.dependencyFamily).sort(),
    [...profile.dependencyFamilyRefs].sort(),
  );
  assert.deepEqual(
    new Set(calls.map((call) => call.confirmed)),
    new Set([true]),
  );
  assert.deepEqual(new Set(planInstallLevels), new Set(['minimal']));
  assert.equal(NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE, 'first-run');
});

test('first-run materialization includes Runtime-required platform dependencies outside static profile refs', async () => {
  const profile = NIMI_APP_AI_PROFILE_FACTORY_ROWS.find((row) => row.alias === 'local-speech-ready');
  assert.ok(profile);
  assert.equal((profile.dependencyFamilyRefs as readonly string[]).includes('accelerator.cuda.runtime'), false);
  const calls: Array<{ dependencyFamily: string; dependencyId: string }> = [];
  const runtime: DesktopNimiFirstRunMaterializationInput['runtime'] = {
    async resolveEnvironmentPlan(payload) {
      const dependencies = profile.dependencyFamilyRefs.map((family, index) =>
        dependency(family, `${payload.packId}:${family}:${index}`),
      );
      if (payload.packId === 'local-text') {
        dependencies.push(dependency('accelerator.cuda.runtime', 'nvidia-cuda-user-space-runtime', {
          required: true,
          environmentKey: 'accelerator.cuda.runtime:nvidia-cuda-user-space-runtime',
        }));
      }
      return {
        planId: `plan:${payload.packId}`,
        packId: payload.packId,
        productLabel: payload.packId,
        hostProfileId: 'windows-amd64-nvidia-cuda',
        platformTuple: 'windows/amd64',
        runtimeDataRoot: payload.runtimeDataRoot ?? '',
        consumerScope: payload.consumerScope,
        cloudOnlyImpact: '',
        state: 'needs_confirmation',
        dependencies,
      };
    },
    async listEnvironmentDependencyJobs() {
      return [];
    },
    async startEnvironmentDependencyJob(payload) {
      calls.push(payload);
      return {
        jobId: `job:${payload.dependencyId}`,
        environmentKey: payload.environmentKey,
        dependencyFamily: payload.dependencyFamily,
        dependencyId: payload.dependencyId,
        consumerScope: payload.consumerScope,
        state: 'queued',
        sourceKind: payload.sourceKind,
        retryable: true,
        bytesReceived: 0,
        bytesTotal: 0,
        percent: 0,
        speedBytesPerSec: 0,
        etaSeconds: 0,
      };
    },
    async cancelEnvironmentDependencyJob() {
      throw new Error('not used');
    },
    async retryEnvironmentDependencyJob() {
      throw new Error('not used');
    },
    async repairEnvironmentDependency() {
      throw new Error('not used');
    },
  };

  await startDesktopNimiFirstRunMaterialization({
    profile,
    runtime,
    runtimeDataRoot: '/tmp/nimi-data-explicit',
    installLevel: 'minimal',
    confirmed: true,
  });

  assert.ok(calls.some((call) => call.dependencyFamily === 'accelerator.cuda.runtime'));
});

test('first-run materialization does not treat selected or candidate dependency states as ready', async () => {
  const profile = NIMI_APP_AI_PROFILE_FACTORY_ROWS.find((row) => row.alias === 'local-speech-ready');
  assert.ok(profile);
  const calls: Array<{ dependencyFamily: string; dependencyId: string }> = [];
  const runtime: DesktopNimiFirstRunMaterializationInput['runtime'] = {
    async resolveEnvironmentPlan(payload) {
      return {
        planId: `plan:${payload.packId}`,
        packId: payload.packId,
        productLabel: payload.packId,
        hostProfileId: 'darwin-arm64-metal',
        platformTuple: 'darwin-arm64',
        runtimeDataRoot: payload.runtimeDataRoot ?? '',
        consumerScope: payload.consumerScope,
        cloudOnlyImpact: '',
        state: 'ready',
        dependencies: profile.dependencyFamilyRefs.map((family, index) =>
          dependency(family, `${family}:${index}`, {
            state: index % 2 === 0 ? 'available' : 'installed',
            selectedSourceRecordId: `selected-source:${index}`,
          }),
        ),
      };
    },
    async listEnvironmentDependencyJobs() {
      return [];
    },
    async startEnvironmentDependencyJob(payload) {
      calls.push(payload);
      return {
        jobId: `job:${payload.dependencyId}`,
        environmentKey: payload.environmentKey,
        dependencyFamily: payload.dependencyFamily,
        dependencyId: payload.dependencyId,
        consumerScope: payload.consumerScope,
        state: 'queued',
        sourceKind: payload.sourceKind,
        retryable: false,
        bytesReceived: 0,
        bytesTotal: 0,
        percent: 0,
        speedBytesPerSec: 0,
        etaSeconds: 0,
      };
    },
    async cancelEnvironmentDependencyJob() {
      throw new Error('not used');
    },
    async retryEnvironmentDependencyJob() {
      throw new Error('not used');
    },
    async repairEnvironmentDependency() {
      throw new Error('not used');
    },
  };

  const projectionBeforeStart = await resolveDesktopNimiFirstRunMaterializationProjection({
    profile,
    runtime,
    runtimeDataRoot: '/tmp/nimi-data-explicit',
  });
  assert.equal(projectionBeforeStart.status, 'activation_pending');
  assert.notEqual(projectionBeforeStart.productState, 'local_ai_ready');

  const projectionAfterStart = await startDesktopNimiFirstRunMaterialization({
    profile,
    runtime,
    runtimeDataRoot: '/tmp/nimi-data-explicit',
    confirmed: true,
  });
  assert.equal(projectionAfterStart.status, 'activation_pending');
  assert.equal(calls.length, 0);
  assert.notEqual(projectionAfterStart.productState, 'local_ai_ready');
});

test('first-run materialization asks backend finalization only after ready_system or ready_managed dependencies', async () => {
  const profile = NIMI_APP_AI_PROFILE_FACTORY_ROWS.find((row) => row.alias === 'local-speech-ready');
  assert.ok(profile);
  const runtime: DesktopNimiFirstRunMaterializationInput['runtime'] = {
    async resolveEnvironmentPlan(payload) {
      return {
        planId: `plan:${payload.packId}`,
        packId: payload.packId,
        productLabel: payload.packId,
        hostProfileId: 'darwin-arm64-metal',
        platformTuple: 'darwin-arm64',
        runtimeDataRoot: payload.runtimeDataRoot ?? '',
        consumerScope: payload.consumerScope,
        cloudOnlyImpact: '',
        state: 'ready',
        dependencies: profile.dependencyFamilyRefs.map((family, index) =>
          dependency(family, `${family}:${index}`, {
            state: index % 2 === 0 ? 'ready_system' : 'ready_managed',
            selectedSourceRecordId: `selected-source:${index}`,
          }),
        ),
      };
    },
    async listEnvironmentDependencyJobs() {
      return [];
    },
    async startEnvironmentDependencyJob() {
      throw new Error('not used');
    },
    async cancelEnvironmentDependencyJob() {
      throw new Error('not used');
    },
    async retryEnvironmentDependencyJob() {
      throw new Error('not used');
    },
    async repairEnvironmentDependency() {
      throw new Error('not used');
    },
  };

  const projection = await resolveDesktopNimiFirstRunMaterializationProjection({
    profile,
    runtime,
    runtimeDataRoot: '/tmp/nimi-data-explicit',
  });
  assert.equal(projection.status, 'local_ai_ready');
  assert.equal(projection.productState, 'local_ai_ready');
});

function dependency(
  dependencyFamily: string,
  dependencyId: string,
  override: Partial<{
    required: boolean;
    state: string;
    sourceKind: string;
    confirmationRequired: boolean;
    selectedSourceRecordId: string;
    environmentKey: string;
    consumerScope: string;
  }> = {},
) {
  return {
    dependencyFamily,
    dependencyId,
    consumerScope: NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
    required: true,
    state: 'needs_confirmation',
    sourceKind: 'runtime-managed',
    confirmationRequired: true,
    environmentKey: `${dependencyFamily}:${dependencyId}`,
    ...override,
  };
}
