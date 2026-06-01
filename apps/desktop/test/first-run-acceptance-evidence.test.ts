import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  PLATFORM_AI_PROFILE_FACTORY_ROWS,
  type PlatformAIProfileFactoryRow,
} from '@nimiplatform/sdk/platform-catalog';
import { FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE } from '@nimiplatform/sdk/runtime';
import { ProductControlWorkflow } from '../src/shell/renderer/first-run/product-control-workflow.js';
import {
  resolveFirstRunMaterializationProjection,
  startFirstRunMaterialization,
  type FirstRunMaterializationInput,
} from '../src/shell/renderer/first-run/runtime-materialization.js';
import type { ProductControlRecord, ProductControlRecordProjection, ProductControlState } from '../src/shell/renderer/bridge/runtime-bridge/product-control.js';

const appRoutesSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/app-shell/routes/app-routes.tsx'),
  'utf8',
);
const firstRunGatePanelSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/nimi-home/first-run-gate-panel.tsx'),
  'utf8',
);
const productControlBridgeSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge/product-control.ts'),
  'utf8',
);
const runtimeBridgeSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge.ts'),
  'utf8',
);
const rendererBridgeSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/bridge.ts'),
  'utf8',
);
const desktopProductControlDir = resolve(
  import.meta.dirname,
  '../src-tauri/src/desktop_product_control',
);
const desktopProductControlSource = [
  readFileSync(
    resolve(import.meta.dirname, '../src-tauri/src/desktop_product_control.rs'),
    'utf8',
  ),
  ...readdirSync(desktopProductControlDir)
    .filter((name) => name.endsWith('.rs'))
    .sort()
    .map((name) => readFileSync(resolve(desktopProductControlDir, name), 'utf8')),
].join('\n');
const appBootstrapSource = readFileSync(
  resolve(import.meta.dirname, '../src-tauri/src/main_parts/app_bootstrap.rs'),
  'utf8',
);
const desktopMainSource = readFileSync(
  resolve(import.meta.dirname, '../src-tauri/src/main.rs'),
  'utf8',
);
const productControlWorkflowSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/first-run/product-control-workflow.tsx'),
  'utf8',
);
const runtimeMaterializationSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/first-run/runtime-materialization.ts'),
  'utf8',
);
const sdkRuntimeMaterializationSource = readFileSync(
  resolve(import.meta.dirname, '../../../sdk/src/runtime/first-run-materialization.ts'),
  'utf8',
);
const firstRunSetupChecklistSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/first-run/first-run-setup-checklist.ts'),
  'utf8',
);
const runtimeClientInterfaceSource = readFileSync(
  resolve(import.meta.dirname, '../../../sdk/src/runtime/types-client-interfaces.ts'),
  'utf8',
);
const aiProfilePolicySource = readFileSync(
  resolve(import.meta.dirname, '../../../.nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md'),
  'utf8',
);
const runtimeLocalEnvironmentContractSource = readFileSync(
  resolve(import.meta.dirname, '../../../.nimi/spec/runtime/kernel/local-engine-contract.md'),
  'utf8',
);

function projectionFor(
  state: ProductControlState,
  override: Partial<ProductControlRecord> = {},
): ProductControlRecordProjection {
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
      pointers: { runtimeConfigPath: '/tmp/home/.nimi/runtime/config.json' },
      repair: { required: state === 'repair_required', reason: null },
      ...override,
    },
  };
}

function renderWorkflow(state: ProductControlState, override: Partial<ProductControlRecord> = {}): string {
  return renderToStaticMarkup(React.createElement(ProductControlWorkflow, {
    projection: projectionFor(state, override),
    onProjectionChange: () => {},
  }));
}

function firstRunRows(): readonly PlatformAIProfileFactoryRow[] {
  return PLATFORM_AI_PROFILE_FACTORY_ROWS.filter((row) =>
    (row.applicableScopes as readonly string[]).includes('first-run'),
  );
}

test('fresh authenticated non-ready gate is first-run-only and excludes ordinary Home-adjacent surfaces', () => {
  assert.match(appRoutesSource, /features\/nimi-home\/first-run-gate-panel/);
  assert.match(appRoutesSource, /<FirstRunGatePanel onReadyForUse=\{props\.onReadyForUse\} \/>/);
  assert.match(firstRunGatePanelSource, /ProductControlWorkflow/);
  for (const forbidden of [
    /AgentChatReference/,
    /LibraryView/,
    /DiscoveryView/,
    /projectLibrary/,
    /projectDiscovery/,
    /createDesktopHomeLiveBridge/,
  ]) {
    assert.doesNotMatch(firstRunGatePanelSource, forbidden);
  }
});

test('renderer evidence: config_missing is an internal transient inside the Storage phase, not its own data-root screen', () => {
  // The 3-phase wizard folds the fast `config_missing` system state into the
  // Storage phase as a calm transient loading affordance — it never gets its
  // own boxed data-root screen. `data_root_missing` is the first user-action
  // data-root state and presents the native folder picker (no raw absolute
  // path text field).
  const configMissing = renderWorkflow('config_missing');
  assert.match(configMissing, /data-product-state="config_missing"/);
  assert.match(configMissing, /data-testid="first-run-phase-storage"/);
  assert.match(configMissing, /data-phase-transient="true"/);
  // A fast system state must NOT expose the interactive folder-choose control.
  assert.doesNotMatch(configMissing, /first-run-storage-choose-folder/);

  const dataRootMissing = renderWorkflow('data_root_missing');
  assert.match(dataRootMissing, /data-phase-transient="false"/);
  assert.match(dataRootMissing, /Where should Nimi keep your models and data/);
  // The native folder picker, not a raw absolute-path text input.
  assert.match(dataRootMissing, /first-run-storage-choose-folder/);
  assert.doesNotMatch(dataRootMissing, /product-first-run-data-root-input/);
});

test('renderer evidence: data_root_selected opens the interactive Local AI phase with no blocking transient', () => {
  // `data_root_selected` and `ai_environment_unconfigured` both render the
  // interactive Minimal / Recommended install-level cards. The device scan is
  // a secondary inline affordance ("Detected" line) — it never blocks the
  // choice, so the phase is usable the moment it opens.
  for (const state of ['data_root_selected', 'ai_environment_unconfigured'] as const) {
    const markup = renderWorkflow(state);
    assert.match(markup, /data-testid="first-run-phase-local-ai"/);
    assert.match(markup, /data-testid="first-run-install-level-minimal"/);
    assert.match(markup, /data-testid="first-run-install-level-recommended"/);
  }
  // The cards are driven by the admitted install-level policy — no cloud /
  // hybrid first-run rows leak into the local-only baseline.
  const choice = renderWorkflow('ai_environment_unconfigured');
  assert.doesNotMatch(choice, /cloud-first/);
  assert.doesNotMatch(choice, /hybrid-recommended/);
});

test('renderer evidence: continuing from the Local AI phase records the install level and starts Runtime materialization', () => {
  // The redesigned wizard folds the explicit-confirmation step into the
  // Local AI phase Continue action: persisting the install level + starting
  // materialization happens through `setProductFirstRunInstallLevel` and
  // `startFirstRunMaterialization`. The renderer never writes ready_for_use.
  const markup = renderWorkflow('ai_environment_unconfigured', {
    firstRun: {
      installLevel: 'minimal',
      aiProfileAlias: 'local-speech-ready',
      completed: false,
      builtInAiConfigRefs: [],
    },
  });
  assert.match(markup, /data-product-state="ai_environment_unconfigured"/);
  assert.match(markup, /first-run-local-ai-continue/);
  // The step indicator marks Local AI active and never advertises a ready
  // shortcut step.
  assert.match(markup, /data-testid="first-run-step-local-ai" data-active="true"/);
  assert.match(productControlWorkflowSource, /setProductFirstRunInstallLevel/);
  assert.match(productControlWorkflowSource, /startFirstRunMaterialization/);
  assert.match(productControlWorkflowSource, /await projectMaterialization\(next, afterLevel\.state\)/);
  assert.doesNotMatch(productControlWorkflowSource, /next\.productState === 'local_ai_ready'[\s\S]*?prepareProductFirstRunLocalAiReady/);
  assert.match(productControlWorkflowSource, /materializationReadyForFinalization/);
  assert.doesNotMatch(productControlWorkflowSource, /markProductReadyForUse/);
});

test('renderer evidence: the Setup phase folds the four progress states into one calm checklist', () => {
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
    assert.match(markup, /data-testid="first-run-phase-setup"/);
    assert.match(markup, /data-testid="first-run-setup-checklist"/);
    assert.match(markup, /data-testid="first-run-step-setup" data-active="true"/);
  }
});

test('renderer evidence: repair and blocked states are explicit terminal failure surfaces', () => {
  const repair = renderWorkflow('repair_required');
  assert.match(repair, /data-testid="first-run-screen-repair"/);
  assert.match(repair, /Nimi needs to repair a component/);
  // The repair screen keeps Retry and a Support entry reachable.
  assert.match(repair, /first-run-repair-retry/);
  assert.match(repair, /first-run-repair-support/);

  const blocked = renderWorkflow('blocked');
  assert.match(blocked, /data-testid="first-run-screen-blocked"/);
  assert.match(blocked, /Nimi cannot continue safely/);
  assert.match(blocked, /first-run-blocked-support/);
  // The blocked terminal screen has no ready / continue shortcut.
  assert.doesNotMatch(blocked, /first-run-local-ai-continue/);
  assert.doesNotMatch(blocked, /first-run-storage-continue/);
});

test('renderer copy-floor: every first-run state renders human copy and no raw enum primary copy', () => {
  // P-COLD-014 copy floor: the first-run UI must not collapse states into
  // generic `ready` / `done` and must not show raw enum names as the primary
  // user-facing copy. The redesigned wizard presents each state through a
  // phase or terminal screen; the fast `config_missing` system state folds
  // into the Storage phase as a transient rather than its own boxed screen.
  // Every state still renders human copy, never the raw enum identifier.
  const allStates: ProductControlState[] = [
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

test('ready_for_use has no production renderer/Tauri mark-ready shortcut and routes only admitted records to Chat', () => {
  assert.doesNotMatch(productControlBridgeSource, /markProductReadyForUse/);
  assert.doesNotMatch(productControlBridgeSource, /product_control_record_mark_ready_for_use/);
  assert.doesNotMatch(runtimeBridgeSource, /markProductReadyForUse/);
  assert.doesNotMatch(rendererBridgeSource, /markProductReadyForUse/);
  assert.doesNotMatch(desktopProductControlSource, /ProductReadyForUsePayload/);
  assert.doesNotMatch(desktopProductControlSource, /product_control_record_mark_ready_for_use/);
  assert.match(desktopProductControlSource, /ready_for_use failed owner admission verification/);
  // the admission keystone command/module is the only entry point that writes ready_for_use.
  assert.match(desktopMainSource, /mod desktop_product_control_admission;/);
  assert.match(appBootstrapSource, /product_control_record_admit_ready_for_use/);
  for (const required of [
    /account_default_profile_ref/,
    /built_in_ai_config_refs/,
    /runtime_baseline_ref/,
    /execution_evidence_ref/,
    /baseline_profile_ref/,
    /baseline_commit_id/,
  ]) {
    assert.match(desktopProductControlSource, required);
  }
  assert.match(appRoutesSource, /projection\.state === 'ready_for_use'/);
  assert.match(appRoutesSource, /setActiveTab\('chat'\)/);
});

test('Runtime materialization orchestration is wired through SDK/localRuntime and no renderer mark-ready shortcut exists', () => {
  for (const method of [
    /startLocalEnvironmentDependencyJob/,
    /cancelLocalEnvironmentDependencyJob/,
    /retryLocalEnvironmentDependencyJob/,
    /repairLocalEnvironmentDependency/,
  ]) {
    assert.match(runtimeClientInterfaceSource, method);
  }
  assert.match(aiProfilePolicySource, /StartLocalEnvironmentDependencyJob/);
  assert.match(runtimeLocalEnvironmentContractSource, /Dependency materialization and repair run as Runtime-owned jobs/);
  assert.match(runtimeMaterializationSource, /localRuntime/);
  assert.match(runtimeMaterializationSource, /@nimiplatform\/sdk\/runtime/);
  assert.match(sdkRuntimeMaterializationSource, /resolveEnvironmentPlan/);
  assert.match(sdkRuntimeMaterializationSource, /listEnvironmentDependencyJobs/);
  assert.match(sdkRuntimeMaterializationSource, /startEnvironmentDependencyJob/);
  assert.match(sdkRuntimeMaterializationSource, /cancelEnvironmentDependencyJob/);
  assert.match(sdkRuntimeMaterializationSource, /retryEnvironmentDependencyJob/);
  assert.match(sdkRuntimeMaterializationSource, /repairEnvironmentDependency/);
  assert.match(sdkRuntimeMaterializationSource, /isLocalRuntimeEnvironmentDependencyReadyState/);
  assert.match(sdkRuntimeMaterializationSource, /isLocalRuntimeEnvironmentDependencyJobTransferringState/);
  assert.match(sdkRuntimeMaterializationSource, /isLocalRuntimeEnvironmentDependencyRepairRequiredState/);
  assert.match(firstRunSetupChecklistSource, /isLocalRuntimeEnvironmentDependencyReadyState/);
  assert.match(firstRunSetupChecklistSource, /isLocalRuntimeEnvironmentDependencyJobActiveState/);
  assert.match(firstRunSetupChecklistSource, /isLocalRuntimeEnvironmentDependencyJobFailedState/);
  assert.doesNotMatch(sdkRuntimeMaterializationSource, /JOB_TRANSFERRING_STATES/);
  assert.doesNotMatch(firstRunSetupChecklistSource, /JOB_ACTIVE_STATES|JOB_FAILED_STATES/);
  assert.doesNotMatch(firstRunSetupChecklistSource, /'starting'|'running'|'in_progress'/);
  assert.match(productControlWorkflowSource, /setProductFirstRunSetupState/);
  assert.match(productControlWorkflowSource, /startFirstRunMaterialization/);
  assert.doesNotMatch(productControlWorkflowSource, /markProductReadyForUse/);
  assert.match(productControlWorkflowSource, /canPersistSetupState/);
  assert.match(productControlWorkflowSource, /'local_ai_ready'/);
});

test('first-run materialization derives Runtime job requests from selected AIProfile pack and dependency refs', async () => {
  const profile = PLATFORM_AI_PROFILE_FACTORY_ROWS.find((row) => row.alias === 'local-speech-ready');
  assert.ok(profile);
  const calls: Array<{ dependencyFamily: string; dependencyId: string; environmentKey: string; sourceKind: string; confirmed: boolean }> = [];
  const planInstallLevels: Array<string | undefined> = [];
  const runtime: FirstRunMaterializationInput['runtime'] = {
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
        runtimeDataRoot: payload.runtimeDataRoot,
        consumerScope: payload.consumerScope,
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

  const unconfirmed = await startFirstRunMaterialization({
    profile,
    runtime,
    runtimeDataRoot: '/tmp/nimi-data-explicit',
    installLevel: 'minimal',
    confirmed: false,
  });
  assert.equal(unconfirmed.status, 'needs_confirmation');
  assert.equal(calls.length, 0);

  const projection = await startFirstRunMaterialization({
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
  assert.equal(FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE, 'first-run');
});

test('first-run materialization includes Runtime-required platform dependencies outside static profile refs', async () => {
  const profile = PLATFORM_AI_PROFILE_FACTORY_ROWS.find((row) => row.alias === 'local-speech-ready');
  assert.ok(profile);
  assert.equal((profile.dependencyFamilyRefs as readonly string[]).includes('accelerator.cuda.runtime'), false);
  const calls: Array<{ dependencyFamily: string; dependencyId: string }> = [];
  const runtime: FirstRunMaterializationInput['runtime'] = {
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
        runtimeDataRoot: payload.runtimeDataRoot,
        consumerScope: payload.consumerScope,
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

  await startFirstRunMaterialization({
    profile,
    runtime,
    runtimeDataRoot: '/tmp/nimi-data-explicit',
    installLevel: 'minimal',
    confirmed: true,
  });

  assert.ok(calls.some((call) => call.dependencyFamily === 'accelerator.cuda.runtime'));
});

test('first-run materialization does not treat selected or candidate dependency states as ready', async () => {
  const profile = PLATFORM_AI_PROFILE_FACTORY_ROWS.find((row) => row.alias === 'local-speech-ready');
  assert.ok(profile);
  const calls: Array<{ dependencyFamily: string; dependencyId: string }> = [];
  const runtime: FirstRunMaterializationInput['runtime'] = {
    async resolveEnvironmentPlan(payload) {
      return {
        planId: `plan:${payload.packId}`,
        packId: payload.packId,
        productLabel: payload.packId,
        hostProfileId: 'darwin-arm64-metal',
        platformTuple: 'darwin-arm64',
        runtimeDataRoot: payload.runtimeDataRoot,
        consumerScope: payload.consumerScope,
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

  const projectionBeforeStart = await resolveFirstRunMaterializationProjection({
    profile,
    runtime,
    runtimeDataRoot: '/tmp/nimi-data-explicit',
  });
  assert.equal(projectionBeforeStart.status, 'activation_pending');
  assert.notEqual(projectionBeforeStart.productState, 'local_ai_ready');

  const projectionAfterStart = await startFirstRunMaterialization({
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
  const profile = PLATFORM_AI_PROFILE_FACTORY_ROWS.find((row) => row.alias === 'local-speech-ready');
  assert.ok(profile);
  const runtime: FirstRunMaterializationInput['runtime'] = {
    async resolveEnvironmentPlan(payload) {
      return {
        planId: `plan:${payload.packId}`,
        packId: payload.packId,
        productLabel: payload.packId,
        hostProfileId: 'darwin-arm64-metal',
        platformTuple: 'darwin-arm64',
        runtimeDataRoot: payload.runtimeDataRoot,
        consumerScope: payload.consumerScope,
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

  const projection = await resolveFirstRunMaterializationProjection({
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
  }> = {},
) {
  return {
    dependencyFamily,
    dependencyId,
    required: true,
    state: 'needs_confirmation',
    sourceKind: 'runtime-managed',
    confirmationRequired: true,
    environmentKey: `${dependencyFamily}:${dependencyId}`,
    ...override,
  };
}
