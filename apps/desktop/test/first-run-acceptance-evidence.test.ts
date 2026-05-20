import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  PLATFORM_AI_PROFILE_FACTORY_ROWS,
  type PlatformAIProfileFactoryRow,
} from '../src/runtime/platform-catalog/index.js';
import { ProductControlWorkflow } from '../src/shell/renderer/first-run/product-control-workflow.js';
import {
  FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
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
const nimiHomePanelSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/nimi-home/nimi-home-panel.tsx'),
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
const desktopProductControlSource = readFileSync(
  resolve(import.meta.dirname, '../src-tauri/src/desktop_product_control.rs'),
  'utf8',
);
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
  assert.match(appRoutesSource, /<FirstRunGatePanel \/>/);
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

test('ordinary Nimi Home excludes mutable first-run product-control workflow', () => {
  assert.doesNotMatch(nimiHomePanelSource, /ProductControlWorkflow/);
  assert.doesNotMatch(nimiHomePanelSource, /setProductFirstRunSetupState/);
  assert.match(nimiHomePanelSource, /FirstRunReadinessView/);
});

test('renderer evidence: config_missing is internal and data_root_missing is the first user data-root state', () => {
  const configMissing = renderWorkflow('config_missing');
  assert.match(configMissing, /Nimi is creating its local product record/);
  assert.doesNotMatch(configMissing, /product-first-run-data-root-input/);

  const dataRootMissing = renderWorkflow('data_root_missing');
  assert.match(dataRootMissing, /Choose where Nimi stores models, apps, and large local data/);
  assert.match(dataRootMissing, /product-first-run-data-root-input/);
});

test('renderer evidence: explicit data root precedes Minimal and Recommended local install choices', () => {
  const markup = renderWorkflow('data_root_selected');
  assert.match(markup, /product-first-run-install-level-minimal/);
  assert.match(markup, /product-first-run-install-level-recommended/);
  assert.match(markup, /local chat/);
  assert.match(markup, /basic STT/);
  assert.match(markup, /basic TTS/);
  assert.doesNotMatch(markup, /cloud-first/);
  assert.doesNotMatch(markup, /hybrid-recommended/);
});

test('renderer evidence: install-level selection exposes explicit Runtime materialization confirmation', () => {
  const markup = renderWorkflow('ai_environment_unconfigured', {
    firstRun: {
      installLevel: 'minimal',
      aiProfileAlias: 'local-speech-ready',
      completed: false,
      builtInAiConfigRefs: [],
    },
  });
  assert.match(markup, /Runtime requires explicit confirmation/);
  assert.match(markup, /product-first-run-materialization-start/);
  assert.match(markup, /data-product-state="ai_environment_unconfigured"/);
  assert.match(markup, /data-testid="product-first-run-state-ready_for_use" data-active="false"/);
  assert.doesNotMatch(productControlWorkflowSource, /markProductReadyForUse/);
});

test('renderer evidence: repair and blocked states are explicit failure surfaces', () => {
  assert.match(renderWorkflow('repair_required'), /repair a required local component/);
  assert.match(renderWorkflow('blocked'), /cannot continue safely yet/);
});

test('renderer copy-floor: every first-run state incl. repair_required and blocked has copy-floor markup and no raw enum primary copy', () => {
  // Each first-run product-control state renders a human copy-floor: a
  // non-empty <h2> title and a <p> body. The raw enum identifier may appear
  // only in data-testid / data-product-state attributes — never as the
  // primary user-facing copy (no enum-name collapse).
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
    const markup = renderWorkflow(state);
    // Copy-floor markup: a primary heading exists and is non-empty.
    const heading = markup.match(/<h2[^>]*>([^<]+)<\/h2>/);
    assert.ok(heading?.[1], `${state} must render a copy-floor <h2> title`);
    const title = heading[1].trim();
    assert.ok(title.length > 0, `${state} title must not be empty`);
    // The primary copy must not be the raw enum identifier.
    assert.notEqual(title, state, `${state} must not use its raw enum name as the title`);
    assert.doesNotMatch(
      title,
      /^[a-z][a-z0-9_]*$/,
      `${state} title "${title}" looks like a raw enum identifier, not user copy`,
    );
    // A copy-floor body paragraph is rendered alongside the heading.
    assert.match(
      markup,
      /<p class="text-sm leading-6[^>]*>[^<]+<\/p>/,
      `${state} must render a copy-floor body paragraph`,
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
  assert.match(runtimeMaterializationSource, /resolveEnvironmentPlan/);
  assert.match(runtimeMaterializationSource, /listEnvironmentDependencyJobs/);
  assert.match(runtimeMaterializationSource, /startEnvironmentDependencyJob/);
  assert.match(runtimeMaterializationSource, /cancelEnvironmentDependencyJob/);
  assert.match(runtimeMaterializationSource, /retryEnvironmentDependencyJob/);
  assert.match(runtimeMaterializationSource, /repairEnvironmentDependency/);
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
  const runtime: FirstRunMaterializationInput['runtime'] = {
    async resolveEnvironmentPlan(payload) {
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
    async resolveEnvironmentActivationGate(payload) {
      return {
        consumerId: payload.consumerId,
        packId: payload.packId,
        state: 'blocked',
        blockingDependencies: [],
        dependencies: [],
      };
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
    confirmed: false,
  });
  assert.equal(unconfirmed.status, 'needs_confirmation');
  assert.equal(calls.length, 0);

  const projection = await startFirstRunMaterialization({
    profile,
    runtime,
    runtimeDataRoot: '/tmp/nimi-data-explicit',
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
  assert.equal(FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE, 'desktop.first-run');
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
    async resolveEnvironmentActivationGate(payload) {
      return {
        consumerId: payload.consumerId,
        packId: payload.packId,
        state: 'ready',
        blockingDependencies: [],
        dependencies: [],
      };
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
  assert.equal(projectionBeforeStart.status, 'needs_confirmation');
  assert.notEqual(projectionBeforeStart.productState, 'local_ai_ready');

  const projectionAfterStart = await startFirstRunMaterialization({
    profile,
    runtime,
    runtimeDataRoot: '/tmp/nimi-data-explicit',
    confirmed: true,
  });
  assert.equal(projectionAfterStart.reason, 'runtime_materialization_jobs_started');
  assert.equal(calls.length, profile.dependencyFamilyRefs.length);
  assert.notEqual(projectionAfterStart.productState, 'local_ai_ready');
});

test('first-run materialization projects local_ai_ready only for ready_system or ready_managed plus ready activation gate', async () => {
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
    async resolveEnvironmentActivationGate(payload) {
      return {
        consumerId: payload.consumerId,
        packId: payload.packId,
        state: 'ready',
        blockingDependencies: [],
        dependencies: [],
      };
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
