import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  ProductControlWorkflow,
  resolveProjectedDataRootPick,
  resolveProductControlWorkflowError,
} from '../src/shell/renderer/first-run/product-control-workflow.js';
import {
  NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
  NIMI_FIRST_RUN_PHASES,
  isNimiProductControlPhaseTransient as isPhaseTransient,
  isNimiProductControlTransientState as isTransientSystemState,
  projectNimiProductControlFirstRunScreen as firstRunScreenForState,
} from '@nimiplatform/sdk/runtime';
import {
  FIRST_RUN_SETUP_STEP_IDS,
  projectSetupChecklist,
} from '../src/shell/renderer/first-run/first-run-setup-checklist.js';
import { PhaseSetup } from '../src/shell/renderer/first-run/phase-setup.js';
import { projectInstallLevelCard } from '../src/shell/renderer/first-run/first-run-install-level-cards.js';
import { projectDeviceSummary } from '../src/shell/renderer/first-run/first-run-device-summary.js';
import {
  NIMI_APP_AI_PROFILE_FACTORY_ROWS,
  selectNimiAppFactoryAIProfileForFirstRun,
  type NimiAppAIProfileFactoryRow,
} from '@nimiplatform/sdk/app';
import type {
  NimiProductControlRecord,
  NimiProductControlRecordProjection,
  NimiProductControlState,
} from '../src/shell/renderer/bridge/runtime-bridge/product-control.js';
import type { NimiFirstRunMaterializationProjection } from '../src/shell/renderer/first-run/runtime-materialization.js';
import {
  productStateForNimiFirstRunMaterializationStatus,
} from '../src/shell/renderer/first-run/runtime-materialization.js';

// --- Fixtures -------------------------------------------------------------

test('a local first-run action error survives a clean projection refresh', () => {
  assert.equal(
    resolveProductControlWorkflowError('RUNTIME_BRIDGE_CONNECT_FAILED', null, null),
    'RUNTIME_BRIDGE_CONNECT_FAILED',
  );
  assert.equal(
    resolveProductControlWorkflowError(null, 'Materialization observer failed', null),
    'Materialization observer failed',
  );
  assert.equal(
    resolveProductControlWorkflowError(null, null, 'Runtime-owned projection failed'),
    'Runtime-owned projection failed',
  );
  assert.equal(resolveProductControlWorkflowError(null, null, null), null);
});

test('a successful observer refresh cannot erase an unresolved action failure', () => {
  let actionError: string | null = 'RUNTIME_ACTION_FAILED';
  let observerError: string | null = 'RUNTIME_OBSERVER_FAILED';

  assert.equal(
    resolveProductControlWorkflowError(null, observerError, null),
    'RUNTIME_OBSERVER_FAILED',
  );

  // This is the state transition performed after any later 3-second observer
  // sample succeeds: only the observer-owned failure is cleared.
  observerError = null;

  assert.equal(
    resolveProductControlWorkflowError(actionError, observerError, null),
    'RUNTIME_ACTION_FAILED',
  );

  // A subsequent explicit action owns clearing its own failure.
  actionError = null;
  assert.equal(resolveProductControlWorkflowError(actionError, observerError, null), null);
});

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
    dataRootProposal: null,
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

function render(state: NimiProductControlState, override: Partial<NimiProductControlRecord> = {}): string {
  return renderToStaticMarkup(
    React.createElement(ProductControlWorkflow, {
      projection: projectionFor(state, override),
      onProjectionChange: () => {},
    }),
  );
}

function renderProjection(projection: NimiProductControlRecordProjection): string {
  return renderToStaticMarkup(
    React.createElement(ProductControlWorkflow, {
      projection,
      onProjectionChange: () => {},
    }),
  );
}

// --- Phase projection -----------------------------------------------------

test('phase projection maps the 12 product-control states onto 4 phases + 3 terminal screens', () => {
  // The fast system states fold into a sibling phase.
  assert.deepEqual(firstRunScreenForState('config_missing'), { kind: 'phase', phase: 'storage' });
  assert.deepEqual(firstRunScreenForState('data_root_missing'), { kind: 'phase', phase: 'storage' });
  assert.deepEqual(firstRunScreenForState('data_root_selected'), { kind: 'phase', phase: 'device-scan' });
  assert.deepEqual(firstRunScreenForState('ai_environment_unconfigured'), {
    kind: 'phase',
    phase: 'local-ai',
  });
  // The four progress states all fold into the single Setup phase.
  for (const state of [
    'local_ai_profile_selected_assets_missing',
    'local_ai_profile_selected_environment_not_ready',
    'local_ai_assets_downloaded_environment_not_ready',
    'local_ai_ready',
  ] as const) {
    assert.deepEqual(firstRunScreenForState(state), { kind: 'phase', phase: 'setup' });
  }
  // The off-happy-path states are terminal screens.
  assert.deepEqual(firstRunScreenForState('repair_required'), { kind: 'terminal', screen: 'repair' });
  assert.deepEqual(firstRunScreenForState('blocked'), { kind: 'terminal', screen: 'blocked' });
  assert.deepEqual(firstRunScreenForState('ready_for_use'), { kind: 'terminal', screen: 'ready' });
  // not_logged_in is owned by the auth gate; if observed here it routes back to login/re-auth.
  assert.deepEqual(firstRunScreenForState('not_logged_in'), { kind: 'terminal', screen: 'login' });
});

test('only config_missing is a phase transient; data_root_selected is device scan', () => {
  assert.equal(isTransientSystemState('config_missing'), true);
  // data_root_selected is not a transient loading shell; it is the explicit
  // device scan phase from the first-run state machine.
  assert.equal(isTransientSystemState('data_root_selected'), false);
  assert.equal(isTransientSystemState('data_root_missing'), false);
  assert.equal(isTransientSystemState('ai_environment_unconfigured'), false);
  assert.equal(isPhaseTransient('config_missing'), true);
  assert.equal(isPhaseTransient('data_root_selected'), false);
  assert.equal(isPhaseTransient('data_root_missing'), false);
});

// --- Step indicator -------------------------------------------------------

test('step indicator highlights the phase matching the current state', () => {
  assert.deepEqual([...NIMI_FIRST_RUN_PHASES], ['storage', 'device-scan', 'local-ai', 'setup']);

  const storage = render('data_root_missing');
  assert.match(storage, /data-testid="first-run-step-storage" data-active="true"/);
  assert.match(storage, /data-testid="first-run-step-device-scan" data-active="false"/);
  assert.match(storage, /data-testid="first-run-step-local-ai" data-active="false"/);

  const deviceScan = render('data_root_selected');
  assert.match(deviceScan, /data-testid="first-run-step-device-scan" data-active="true"/);
  assert.match(deviceScan, /data-testid="first-run-phase-device-scan"/);
  assert.doesNotMatch(deviceScan, /first-run-install-level-minimal/);

  const localAi = render('ai_environment_unconfigured');
  assert.match(localAi, /data-testid="first-run-step-local-ai" data-active="true"/);

  const setup = render('local_ai_profile_selected_assets_missing', {
    firstRun: {
      installLevel: 'minimal',
      aiProfileAlias: 'local-speech-ready',
      completed: false,
      builtInAiConfigRefs: [],
    },
  });
  assert.match(setup, /data-testid="first-run-step-setup" data-active="true"/);

  // Terminal screens are operational status surfaces, not inactive phases.
  const repair = render('repair_required');
  assert.doesNotMatch(repair, /data-testid="first-run-step-indicator"/);
  assert.doesNotMatch(repair, /data-testid="first-run-step-storage"/);
  assert.match(repair, /data-testid="first-run-screen-repair"/);
});

// --- Folder picker → selectProductDataRoot --------------------------------

test('the Storage phase wires the native folder picker to the selectProductDataRoot bridge call', () => {
  const workflowSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/first-run/product-control-workflow.tsx'),
    'utf8',
  );
  // The folder picker resolves a path; selectProductDataRoot records it.
  assert.match(workflowSource, /pickProductDataRootDirectory/);
  assert.match(workflowSource, /selectProductDataRoot/);
  // The picked path is passed to selectProductDataRoot, not a raw text field.
  const storageSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/first-run/phase-storage.tsx'),
    'utf8',
  );
  assert.match(storageSource, /onChooseFolder/);
  assert.match(storageSource, /onContinue/);
  assert.doesNotMatch(storageSource, /<input/);

  // The folder picker uses the standard Kit file dialog rather than an app-local Tauri command.
  const bridgeSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge/product-control.ts'),
    'utf8',
  );
  assert.match(bridgeSource, /openShellFileDialog/);
  assert.match(bridgeSource, /kind:\s*'directory'/);
  assert.doesNotMatch(bridgeSource, /invokeChecked\('product_control_pick_data_root_directory'/);
});

test('the Storage phase prefers the Runtime checkpoint proposal and keeps the OS default as production fallback', () => {
  // The workflow proposes the OS-conventional default so the field is never
  // empty, but it is only a candidate — the user still confirms it through
  // selectProductDataRoot. The renderer never records or fabricates a path.
  const workflowSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/first-run/product-control-workflow.tsx'),
    'utf8',
  );
  assert.match(workflowSource, /projection\?\.dataRootProposal\?\.path/);
  assert.match(workflowSource, /if \(runtimeDataRootProposal\) return/);
  assert.match(workflowSource, /defaultProductDataRootDirectory/);

  // The bridge call is read-only and fails closed: no Tauri runtime or a
  // non-string payload yields a null proposal, never a fabricated path.
  const bridgeSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge/product-control.ts'),
    'utf8',
  );
  assert.match(bridgeSource, /product_control_default_data_root_directory/);
  assert.match(bridgeSource, /defaultProductDataRootDirectory/);

  // The proposal command is a read-only path resolver: its name is not in the
  // `product_control_record_*` family, so it cannot mutate the record —
  // P-COLD-010 keeps recording with selectProductDataRoot after user confirm.
  assert.doesNotMatch(bridgeSource, /product_control_record_default_data_root/);
});

test('the Runtime data-root proposal replaces only the renderer fallback, never a user pick or record', () => {
  assert.deepEqual(resolveProjectedDataRootPick({
    currentPath: 'C:\\Users\\admin\\Nimi',
    currentAuthority: 'fallback',
    recordedPath: null,
    runtimeProposalPath: 'C:\\service-owned-trial\\Nimi',
  }), {
    path: 'C:\\service-owned-trial\\Nimi',
    authority: 'runtime',
  });
  assert.deepEqual(resolveProjectedDataRootPick({
    currentPath: 'D:\\UserPick',
    currentAuthority: 'user',
    recordedPath: null,
    runtimeProposalPath: 'C:\\service-owned-trial\\Nimi',
  }), {
    path: 'D:\\UserPick',
    authority: 'user',
  });
  assert.deepEqual(resolveProjectedDataRootPick({
    currentPath: 'D:\\UserPick',
    currentAuthority: 'user',
    recordedPath: 'E:\\Recorded',
    runtimeProposalPath: 'C:\\service-owned-trial\\Nimi',
  }), {
    path: 'E:\\Recorded',
    authority: 'record',
  });
});

// --- Install-level cards --------------------------------------------------

test('install-level cards are driven by the admitted install-level policy', () => {
  const minimalPlan = selectNimiAppFactoryAIProfileForFirstRun(NIMI_APP_AI_PROFILE_FACTORY_ROWS, 'minimal');
  const recommendedPlan = selectNimiAppFactoryAIProfileForFirstRun(
    NIMI_APP_AI_PROFILE_FACTORY_ROWS,
    'recommended',
  );
  assert.ok(minimalPlan, 'expected an admitted minimal plan');
  assert.ok(recommendedPlan, 'expected an admitted recommended plan');

  const minimalCard = projectInstallLevelCard('minimal', minimalPlan);
  assert.equal(minimalCard.installLevel, 'minimal');
  assert.equal(minimalCard.highlights.length, 3);
  assert.deepEqual([...minimalCard.highlights], ['fast-setup', 'lower-resource', 'everyday-chat']);

  const recommendedCard = projectInstallLevelCard('recommended', recommendedPlan);
  assert.equal(recommendedCard.highlights.length, 3);
  assert.equal(recommendedCard.highlights[0], 'smarter-answers');
  // The image-generation highlight is shown only when the resolved plan
  // actually carries the image.generate capability.
  const expectedSecond = recommendedPlan.capabilitySet.includes('image.generate')
    ? 'image-generation'
    : 'local-voice';
  assert.equal(recommendedCard.highlights[1], expectedSecond);

  // A null plan still yields exactly three highlight ids and renders an
  // unavailable card rather than fabricating capabilities.
  const nullCard = projectInstallLevelCard('minimal', null);
  assert.equal(nullCard.plan, null);
  assert.equal(nullCard.highlights.length, 3);
});

test('the Local AI phase renders both selectable install-level cards', () => {
  const markup = render('ai_environment_unconfigured');
  assert.match(markup, /data-testid="first-run-install-level-minimal"/);
  assert.match(markup, /data-testid="first-run-install-level-recommended"/);
  assert.match(markup, /first-run-local-ai-continue/);
});

// --- Setup checklist ------------------------------------------------------

function materializationFixture(
  status: NimiFirstRunMaterializationProjection['status'],
  overrides: Partial<NimiFirstRunMaterializationProjection> = {},
): NimiFirstRunMaterializationProjection {
  return {
    status,
    productState: 'local_ai_profile_selected_assets_missing',
    reason: `runtime_${status}`,
    missingDependencyFamilies: [],
    dependencies: [],
    ...overrides,
  };
}

test('the setup checklist projects the real materialization progression', () => {
  assert.deepEqual([...FIRST_RUN_SETUP_STEP_IDS], [
    'download',
    'verify',
    'environment',
    'finalize',
  ]);

  // In-progress: download is the active sub-step, the rest pending.
  const inProgress = projectSetupChecklist(
    'local_ai_profile_selected_assets_missing',
    materializationFixture('in_progress'),
  );
  assert.equal(inProgress.hasFailure, false);
  assert.equal(inProgress.steps.find((s) => s.id === 'download')?.status, 'active');
  assert.equal(inProgress.steps.find((s) => s.id === 'verify')?.status, 'pending');

  // local_ai_ready: the materialization phase is done; finalize is active.
  const ready = projectSetupChecklist('local_ai_ready', null);
  assert.equal(ready.steps.find((s) => s.id === 'download')?.status, 'done');
  assert.equal(ready.steps.find((s) => s.id === 'environment')?.status, 'done');
  assert.equal(ready.steps.find((s) => s.id === 'finalize')?.status, 'active');

  // A failure surfaces hasFailure and a failing sub-step.
  const failed = projectSetupChecklist(
    'repair_required',
    materializationFixture('failed', {
      dependencies: [
        {
          packId: 'local-text',
          dependency: {
            dependencyFamily: 'model.asset',
            dependencyId: 'model.asset:default',
            consumerScope: NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
            required: true,
            state: 'repair_required',
            sourceKind: 'runtime-managed',
            confirmationRequired: true,
            environmentKey: 'model.asset:default',
          },
          job: {
            jobId: 'job:model.asset:default',
            environmentKey: 'model.asset:default',
            dependencyFamily: 'model.asset',
            dependencyId: 'model.asset:default',
            consumerScope: NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
            state: 'failed',
            sourceKind: 'runtime-managed',
            retryable: true,
            createdAt: '2026-06-05T00:00:00.000Z',
            updatedAt: '2026-06-05T00:01:00.000Z',
            bytesReceived: 0,
            bytesTotal: 0,
            percent: 0,
            speedBytesPerSec: 0,
            etaSeconds: 0,
          },
        },
      ],
    }),
  );
  assert.equal(failed.hasFailure, true);
  const failingStep = failed.steps.find((s) => s.status === 'failed');
  assert.ok(failingStep, 'expected a failed sub-step');
  assert.ok(failingStep.failingDependency, 'the failed sub-step carries the failing dependency');
  assert.equal(failingStep.canRetry, true);
  assert.equal(failingStep.canRepair, false);
});

// --- Wave-5: materialization download-progress UX -------------------------

function downloadingDependency(
  bytesReceived: number,
  bytesTotal: number,
  speedBytesPerSec: number,
  etaSeconds: number,
) {
  return {
    packId: 'local-text',
    dependency: {
      dependencyFamily: 'model.asset',
      dependencyId: 'model.asset:default',
      consumerScope: NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
      required: true,
      state: 'downloading',
      sourceKind: 'runtime-managed',
      confirmationRequired: true,
      environmentKey: 'model.asset:default',
    },
    job: {
      jobId: 'job:model.asset:default',
      environmentKey: 'model.asset:default',
      dependencyFamily: 'model.asset',
      dependencyId: 'model.asset:default',
      consumerScope: NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
      state: 'downloading',
      sourceKind: 'runtime-managed',
      retryable: true,
      createdAt: '2026-06-05T00:00:00.000Z',
      updatedAt: '2026-06-05T00:01:00.000Z',
      bytesReceived,
      bytesTotal,
      percent: bytesTotal > 0 ? Math.round((bytesReceived / bytesTotal) * 100) : 0,
      speedBytesPerSec,
      etaSeconds,
    },
  };
}

test('an actively-downloading setup step renders progress and is not failed, with no Retry/Repair', () => {
  const checklist = projectSetupChecklist(
    'local_ai_profile_selected_assets_missing',
    materializationFixture('in_progress', {
      dependencies: [downloadingDependency(500, 1000, 250, 2)],
    }),
  );
  const downloadStep = checklist.steps.find((s) => s.id === 'download');
  assert.ok(downloadStep);
  // The downloading step is active (in progress) — never failed.
  assert.equal(downloadStep.status, 'active');
  assert.equal(checklist.hasFailure, false);
  // No failing affordances on an active step.
  assert.equal(downloadStep.canRetry, false);
  assert.equal(downloadStep.canRepair, false);
  assert.equal(downloadStep.failingDependency, null);
  // The step carries the concrete download-progress projection.
  assert.ok(downloadStep.downloadProgress);
  assert.equal(downloadStep.downloadProgress.percent, 50);
  assert.equal(downloadStep.downloadProgress.speedBytesPerSec, 250);

  const markup = renderToStaticMarkup(
    React.createElement(PhaseSetup, {
      checklist,
      busy: false,
      error: null,
      actions: { onRetry: () => {}, onRepair: () => {}, onCancel: () => {} },
    }),
  );
  // The in-progress step renders concrete progress.
  assert.match(markup, /data-testid="first-run-setup-step-download-progress"/);
  assert.match(markup, /data-testid="first-run-setup-step-download-percent"/);
  assert.match(markup, /50%/);
  // The actively-downloading step exposes neither Retry nor Repair.
  assert.doesNotMatch(markup, /data-testid="first-run-setup-retry"/);
  assert.doesNotMatch(markup, /data-testid="first-run-setup-repair"/);
  // download step is not the red failed status.
  assert.match(markup, /data-testid="first-run-setup-step-download"[^>]*data-step-status="active"/);
});

test('a genuinely failed setup step is red and offers Retry, with no progress', () => {
  const checklist = projectSetupChecklist(
    'repair_required',
    materializationFixture('failed', {
      dependencies: [
        {
          packId: 'local-text',
          dependency: {
            dependencyFamily: 'model.asset',
            dependencyId: 'model.asset:default',
            consumerScope: NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
            required: true,
            state: 'repair_required',
            sourceKind: 'runtime-managed',
            confirmationRequired: true,
            environmentKey: 'model.asset:default',
          },
          job: {
            jobId: 'job:model.asset:default',
            environmentKey: 'model.asset:default',
            dependencyFamily: 'model.asset',
            dependencyId: 'model.asset:default',
            consumerScope: NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
            state: 'failed',
            sourceKind: 'runtime-managed',
            retryable: true,
            createdAt: '2026-06-05T00:00:00.000Z',
            updatedAt: '2026-06-05T00:01:00.000Z',
            bytesReceived: 0,
            bytesTotal: 0,
            percent: 0,
            speedBytesPerSec: 0,
            etaSeconds: 0,
          },
        },
      ],
    }),
  );
  const markup = renderToStaticMarkup(
    React.createElement(PhaseSetup, {
      checklist,
      busy: false,
      error: null,
      actions: { onRetry: () => {}, onRepair: () => {}, onCancel: () => {} },
    }),
  );
  // The failed step is red and carries the typed Retry affordance.
  assert.match(markup, /data-step-status="failed"/);
  assert.match(markup, /data-testid="first-run-setup-retry"/);
  assert.doesNotMatch(markup, /data-testid="first-run-setup-repair"/);
  // A failed step shows no in-progress download-progress block.
  assert.doesNotMatch(markup, /data-testid="first-run-setup-step-download-progress"/);
});

test('a selected-source repair-required setup step offers Repair', () => {
  const checklist = projectSetupChecklist(
    'repair_required',
    materializationFixture('repair_required', {
      dependencies: [
        {
          packId: 'local-text',
          dependency: {
            dependencyFamily: 'model.asset',
            dependencyId: 'model.asset:default',
            consumerScope: NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
            selectedSourceRecordId: 'source:model.asset:default',
            required: true,
            state: 'repair_required',
            sourceKind: 'runtime-managed',
            confirmationRequired: false,
            environmentKey: 'model.asset:default',
          },
          job: null,
        },
      ],
    }),
  );
  const markup = renderToStaticMarkup(
    React.createElement(PhaseSetup, {
      checklist,
      busy: false,
      error: null,
      actions: { onRetry: () => {}, onRepair: () => {}, onCancel: () => {} },
    }),
  );
  assert.match(markup, /data-step-status="failed"/);
  assert.match(markup, /data-testid="first-run-setup-repair"/);
  assert.doesNotMatch(markup, /data-testid="first-run-setup-retry"/);
});

test('materialization failures stay in the retryable Setup phase', () => {
  for (const status of ['failed', 'repair_required', 'cancelled'] as const) {
    const productState = productStateForNimiFirstRunMaterializationStatus(status);
    assert.equal(productState, 'local_ai_profile_selected_environment_not_ready');
    assert.deepEqual(firstRunScreenForState(productState), { kind: 'phase', phase: 'setup' });
  }
});

test('the Setup phase renders the checklist for the four progress states', () => {
  for (const state of [
    'local_ai_profile_selected_assets_missing',
    'local_ai_profile_selected_environment_not_ready',
    'local_ai_assets_downloaded_environment_not_ready',
    'local_ai_ready',
  ] as const) {
    const markup = render(state, {
      firstRun: {
        installLevel: 'minimal',
        aiProfileAlias: 'local-speech-ready',
        completed: false,
        builtInAiConfigRefs: [],
      },
    });
    assert.match(markup, /data-testid="first-run-phase-setup"/);
    assert.match(markup, /data-testid="first-run-setup-checklist"/);
  }
});

test('ready-record reconciliation surfaces runtime read failures in setup instead of a blank wait screen', () => {
  const projection = projectionFor('local_ai_profile_selected_environment_not_ready', {
    state: 'ready_for_use',
    firstRun: {
      installLevel: 'minimal',
      aiProfileAlias: 'local-speech-ready',
      completed: true,
      builtInAiConfigRefs: ['aiconfig:chat'],
    },
  });
  const markup = renderProjection({
    ...projection,
    error: 'RUNTIME_GRPC_UNAVAILABLE: h2 protocol error',
  });

  assert.match(markup, /data-testid="first-run-phase-setup"/);
  assert.match(markup, /data-testid="first-run-setup-error"/);
  assert.match(markup, /RUNTIME_GRPC_UNAVAILABLE: h2 protocol error/);
  assert.doesNotMatch(markup, /data-testid="first-run-screen-reconciling"/);
});

test('the Setup phase exposes accountable status, details, and manual re-check', () => {
  const checklist = projectSetupChecklist(
    'local_ai_profile_selected_environment_not_ready',
    materializationFixture('in_progress', {
      productState: 'local_ai_profile_selected_environment_not_ready',
      reason: 'runtime_materialization_jobs_in_progress',
    }),
  );
  const markup = renderToStaticMarkup(
    React.createElement(PhaseSetup, {
      checklist,
      busy: false,
      error: null,
      statusDetails: {
        elapsedLabel: '2m 10s',
        lastCheckedLabel: 'just now',
        lastStateChangeLabel: '1m ago',
        productState: 'local_ai_profile_selected_environment_not_ready',
        productStateLabel: 'Nimi is preparing its managed local environment.',
        installLevel: 'minimal',
        dataRootPath: '/tmp/nimi-data-explicit',
        activeStepLabel: 'Preparing local environment',
        materializationStatus: 'in_progress',
        reason: 'runtime_materialization_jobs_in_progress',
        notice: {
          tone: 'warning',
          message: 'This may be stalled. Re-check setup to refresh the local record.',
        },
      },
      onRecheckSetup: () => {},
      actions: { onRetry: () => {}, onRepair: () => {}, onCancel: () => {} },
    }),
  );

  assert.match(markup, /data-testid="first-run-setup-recheck"/);
  assert.match(markup, /data-testid="first-run-setup-details"/);
  assert.match(markup, /data-testid="first-run-setup-notice"/);
  assert.match(markup, /2m 10s/);
  assert.match(markup, /just now/);
  assert.match(markup, /1m ago/);
  assert.match(markup, /data-product-state="local_ai_profile_selected_environment_not_ready"/);
  assert.match(markup, /Nimi is preparing its managed local environment/);
  assert.match(markup, /runtime_materialization_jobs_in_progress/);
  assert.match(markup, /\/tmp\/nimi-data-explicit/);
});

// --- Device summary -------------------------------------------------------

test('the device summary projects real evidence and fails closed when absent', () => {
  assert.equal(projectDeviceSummary(null), null);
  // Sparse evidence without os/arch fails closed.
  assert.equal(
    projectDeviceSummary({
      os: '',
      arch: '',
      totalRamBytes: 0,
      availableRamBytes: 0,
      gpu: {
        available: false,
        vendor: '',
        model: '',
        totalVramBytes: 0,
        availableVramBytes: 0,
      },
      python: { available: false, version: '' },
      npu: {
        available: false,
        ready: false,
        vendor: '',
        runtime: '',
        detail: '',
      },
      diskFreeBytes: 0,
      ports: [],
    }),
    null,
  );
  // Real evidence is summarized.
  const summary = projectDeviceSummary({
    os: 'macos',
    arch: 'arm64',
    totalRamBytes: 16 * 1024 * 1024 * 1024,
    availableRamBytes: 8 * 1024 * 1024 * 1024,
    gpu: {
      available: true,
      vendor: 'apple',
      model: 'M3',
      totalVramBytes: 8 * 1024 * 1024 * 1024,
      availableVramBytes: 4 * 1024 * 1024 * 1024,
      memoryModel: 'unified',
    },
    python: { available: true, version: '3.12' },
    npu: {
      available: false,
      ready: false,
      vendor: '',
      runtime: '',
      detail: '',
    },
    diskFreeBytes: 200 * 1024 * 1024 * 1024,
    ports: [],
  });
  assert.ok(summary && summary.includes('macos arm64'));
  assert.ok(summary && summary.includes('16 GB'));
  assert.ok(summary && summary.includes('M3'));
});

// --- Terminal screens -----------------------------------------------------

test('the repair and blocked terminal screens render in the wizard chrome', () => {
  const repair = render('repair_required');
  assert.match(repair, /data-testid="first-run-screen-repair"/);
  assert.match(repair, /first-run-repair-retry/);
  assert.match(repair, /first-run-repair-support/);

  const blocked = render('blocked');
  assert.match(blocked, /data-testid="first-run-screen-blocked"/);
  assert.match(blocked, /first-run-blocked-support/);

  const ready = render('ready_for_use');
  assert.match(ready, /data-testid="first-run-screen-ready"/);
});

// --- No mark-ready shortcut ----------------------------------------------

test('no wizard phase or screen exposes a mark-ready shortcut', () => {
  const firstRunDir = path.join(import.meta.dirname, '../src/shell/renderer/first-run');
  for (const file of fs.readdirSync(firstRunDir)) {
    if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
    const source = fs.readFileSync(path.join(firstRunDir, file), 'utf8');
    assert.doesNotMatch(source, /markProductReadyForUse/, `${file} must not mark ready`);
    assert.doesNotMatch(
      source,
      /product_control_record_mark_ready_for_use/,
      `${file} must not call a mark-ready command`,
    );
  }
  // Every state still renders — including ready_for_use, which is admitted by
  // the backend and only confirmed (never minted) by the renderer.
  const ready = render('ready_for_use');
  assert.match(ready, /data-product-state="ready_for_use"/);
  assert.doesNotMatch(ready, /markProductReadyForUse/);
});

test('factory rows used by the wizard remain local-only first-run baselines', () => {
  const rows: readonly NimiAppAIProfileFactoryRow[] = NIMI_APP_AI_PROFILE_FACTORY_ROWS.filter(
    (row) => (row.applicableScopes as readonly string[]).includes('first-run'),
  );
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.notEqual(row.computePosture, 'cloud-only');
    assert.notEqual(row.routingPolicy, 'cloud-first');
    assert.notEqual(row.routingPolicy, 'hybrid-explicit');
    assert.equal(row.capabilitySet.includes('video.generate'), false);
  }
});
