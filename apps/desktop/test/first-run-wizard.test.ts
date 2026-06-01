import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ProductControlWorkflow } from '../src/shell/renderer/first-run/product-control-workflow.js';
import {
  FIRST_RUN_PHASES,
  firstRunScreenForState,
  isPhaseTransient,
  isTransientSystemState,
} from '../src/shell/renderer/first-run/first-run-phase-projection.js';
import {
  FIRST_RUN_SETUP_STEP_IDS,
  projectSetupChecklist,
} from '../src/shell/renderer/first-run/first-run-setup-checklist.js';
import { PhaseSetup } from '../src/shell/renderer/first-run/phase-setup.js';
import { projectInstallLevelCard } from '../src/shell/renderer/first-run/first-run-install-level-cards.js';
import { projectDeviceSummary } from '../src/shell/renderer/first-run/first-run-device-summary.js';
import {
  PLATFORM_AI_PROFILE_FACTORY_ROWS,
  selectFactoryAIProfileForFirstRun,
  type PlatformAIProfileFactoryRow,
} from '@nimiplatform/sdk/platform-catalog';
import type {
  ProductControlRecord,
  ProductControlRecordProjection,
  ProductControlState,
} from '../src/shell/renderer/bridge/runtime-bridge/product-control.js';
import type { FirstRunMaterializationProjection } from '../src/shell/renderer/first-run/runtime-materialization.js';
import {
  productStateForMaterializationStatus,
} from '../src/shell/renderer/first-run/runtime-materialization.js';

// --- Fixtures -------------------------------------------------------------

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

function render(state: ProductControlState, override: Partial<ProductControlRecord> = {}): string {
  return renderToStaticMarkup(
    React.createElement(ProductControlWorkflow, {
      projection: projectionFor(state, override),
      onProjectionChange: () => {},
    }),
  );
}

// --- Phase projection -----------------------------------------------------

test('phase projection maps the 12 product-control states onto 3 phases + 3 terminal screens', () => {
  // The fast system states fold into a sibling phase.
  assert.deepEqual(firstRunScreenForState('config_missing'), { kind: 'phase', phase: 'storage' });
  assert.deepEqual(firstRunScreenForState('data_root_missing'), { kind: 'phase', phase: 'storage' });
  assert.deepEqual(firstRunScreenForState('data_root_selected'), { kind: 'phase', phase: 'local-ai' });
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

test('only config_missing is a phase transient; data_root_selected is interactive', () => {
  assert.equal(isTransientSystemState('config_missing'), true);
  // data_root_selected is NOT transient: the Local AI phase is interactive the
  // moment it opens and the device scan loads inline without blocking.
  assert.equal(isTransientSystemState('data_root_selected'), false);
  assert.equal(isTransientSystemState('data_root_missing'), false);
  assert.equal(isTransientSystemState('ai_environment_unconfigured'), false);
  assert.equal(isPhaseTransient('config_missing'), true);
  assert.equal(isPhaseTransient('data_root_selected'), false);
  assert.equal(isPhaseTransient('data_root_missing'), false);
});

// --- Step indicator -------------------------------------------------------

test('step indicator highlights the phase matching the current state', () => {
  assert.deepEqual([...FIRST_RUN_PHASES], ['storage', 'local-ai', 'setup']);

  const storage = render('data_root_missing');
  assert.match(storage, /data-testid="first-run-step-storage" data-active="true"/);
  assert.match(storage, /data-testid="first-run-step-local-ai" data-active="false"/);

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

  // Terminal screens carry no active step.
  const repair = render('repair_required');
  assert.match(repair, /data-testid="first-run-step-storage" data-active="false"/);
  assert.match(repair, /data-testid="first-run-step-setup" data-active="false"/);
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

  // The folder picker bridge call is fail-closed on a non-string payload.
  const bridgeSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge/product-control.ts'),
    'utf8',
  );
  assert.match(bridgeSource, /product_control_pick_data_root_directory/);
  assert.match(bridgeSource, /returned invalid payload/);
});

test('the Storage phase pre-fills the OS default nimi_data path as a confirmable proposal', () => {
  // The workflow proposes the OS-conventional default so the field is never
  // empty, but it is only a candidate — the user still confirms it through
  // selectProductDataRoot. The renderer never records or fabricates a path.
  const workflowSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/first-run/product-control-workflow.tsx'),
    'utf8',
  );
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

// --- Install-level cards --------------------------------------------------

test('install-level cards are driven by the admitted install-level policy', () => {
  const minimalPlan = selectFactoryAIProfileForFirstRun(PLATFORM_AI_PROFILE_FACTORY_ROWS, 'minimal');
  const recommendedPlan = selectFactoryAIProfileForFirstRun(
    PLATFORM_AI_PROFILE_FACTORY_ROWS,
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
  status: FirstRunMaterializationProjection['status'],
  overrides: Partial<FirstRunMaterializationProjection> = {},
): FirstRunMaterializationProjection {
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
            state: 'failed',
            sourceKind: 'runtime-managed',
            retryable: true,
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
  assert.equal(failingStep.canRepair, true);
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
      state: 'downloading',
      sourceKind: 'runtime-managed',
      retryable: true,
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

test('a genuinely failed setup step is red and offers Retry/Repair, with no progress', () => {
  const checklist = projectSetupChecklist(
    'repair_required',
    materializationFixture('failed', {
      dependencies: [
        {
          packId: 'local-text',
          dependency: {
            dependencyFamily: 'model.asset',
            dependencyId: 'model.asset:default',
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
            state: 'failed',
            sourceKind: 'runtime-managed',
            retryable: true,
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
  // The failed step is red and carries the typed Retry / Repair affordances.
  assert.match(markup, /data-step-status="failed"/);
  assert.match(markup, /data-testid="first-run-setup-retry"/);
  assert.match(markup, /data-testid="first-run-setup-repair"/);
  // A failed step shows no in-progress download-progress block.
  assert.doesNotMatch(markup, /data-testid="first-run-setup-step-download-progress"/);
});

test('materialization failures stay in the retryable Setup phase', () => {
  for (const status of ['failed', 'repair_required', 'cancelled'] as const) {
    const productState = productStateForMaterializationStatus(status);
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
      gpu: { available: false },
      python: { available: false },
      npu: { available: false, ready: false },
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
    gpu: { available: true, vendor: 'apple', model: 'M3' },
    python: { available: true, version: '3.12' },
    npu: { available: false, ready: false },
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
  const rows: readonly PlatformAIProfileFactoryRow[] = PLATFORM_AI_PROFILE_FACTORY_ROWS.filter(
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
