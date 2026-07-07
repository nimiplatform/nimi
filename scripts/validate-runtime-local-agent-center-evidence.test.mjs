import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const validator = path.join(repoRoot, 'scripts', 'validate-runtime-local-agent-center-evidence.mjs');

test('validates recursive live-runtime evidence with screenshots and Runtime projection state', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nimi-rla-evidence-live-'));
  const scenarioRoot = path.join(root, 'desktop', 'live-runtime');
  writeEvidence(scenarioRoot, liveEvidence());

  const result = runValidator(root);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /validated 1 evidence file/);
});

test('rejects no-runtime evidence that invents a Runtime Agent AI Config revision', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nimi-rla-evidence-no-runtime-'));
  writeEvidence(root, noRuntimeEvidence({
    agentAIConfig: { revision: 7 },
  }));

  const result = runValidator(root);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no-runtime.*revision/i);
});

test('accepts editable audio.synthesize intent evidence but rejects playable pseudo artifacts', () => {
  const editableRoot = mkdtempSync(path.join(tmpdir(), 'nimi-rla-evidence-editable-audio-'));
  writeEvidence(editableRoot, liveEvidence({
    agentAIConfig: {
      audioSynthesize: {
        state: 'ready',
        reason: null,
        editable: true,
        playable: false,
      },
    },
  }));

  const accepted = runValidator(editableRoot);
  assert.equal(accepted.status, 0, accepted.stderr);

  const playableRoot = mkdtempSync(path.join(tmpdir(), 'nimi-rla-evidence-playable-audio-'));
  writeEvidence(playableRoot, liveEvidence({
    agentAIConfig: {
      audioSynthesize: {
        state: 'playable',
        reason: null,
        editable: true,
        playable: true,
      },
    },
  }));

  const rejected = runValidator(playableRoot);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /playable artifact|state is not admitted/);
});

test('accepts no-runtime global fail-closed evidence without visible Agent Center tabs', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nimi-rla-evidence-no-runtime-global-'));
  writeEvidence(root, noRuntimeEvidence({
    dom: {
      ...baseDom(),
      agentCenter: {
        visible: false,
        activeSection: null,
        boundingBox: { x: 0, y: 0, width: 0, height: 0 },
        hasOverflow: false,
      },
      controls: {
        submitEnabled: false,
        modelSaveEnabled: false,
        autonomyToggleEnabled: false,
        disabledReason: 'electron-runtime-endpoint-unavailable',
      },
    },
    interaction: {
      tabsVisited: [],
      keyboardOperable: true,
      modelEditCommitted: false,
      staleRevisionConflictObserved: false,
    },
  }));

  const result = runValidator(root);

  assert.equal(result.status, 0, result.stderr);
});

test('rejects mock stale conflict evidence unless the RLA0b harness flag is supplied', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nimi-rla-evidence-mock-conflict-'));
  writeEvidence(root, liveEvidence({
    interaction: {
      ...baseInteraction(),
      staleRevisionConflictObserved: true,
      staleRevisionSource: 'mock-harness-only',
    },
  }));

  const rejected = runValidator(root);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /mock-harness-only/);

  const accepted = runValidator(root, ['--allow-mock-stale-conflict']);
  assert.equal(accepted.status, 0, accepted.stderr);
});

test('fails when referenced screenshots are missing', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nimi-rla-evidence-missing-screenshot-'));
  const evidence = liveEvidence();
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, 'desktop-live-evidence.json'), JSON.stringify(evidence, null, 2));

  const result = runValidator(root);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /screenshot.*not found/i);
});

test('allows explicit rollup-only directories without evidence JSON', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nimi-rla-evidence-rollup-'));
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, 'evidence-rollup.md'), '# RLA rollup\n', 'utf8');

  const result = runValidator(root);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /rollup-only/);
});

function runValidator(root, extraArgs = []) {
  return spawnSync(process.execPath, [validator, '--root', root, ...extraArgs], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function writeEvidence(root, evidence) {
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, evidence.screenshots.desktop), 'png', 'utf8');
  writeFileSync(path.join(root, evidence.screenshots.narrow), 'png', 'utf8');
  for (const panel of evidence.screenshots.panels || []) {
    writeFileSync(path.join(root, panel), 'png', 'utf8');
  }
  writeFileSync(path.join(root, `${evidence.app}-${evidence.stage}-evidence.json`), JSON.stringify(evidence, null, 2));
}

function liveEvidence(overrides = {}) {
  return deepMerge({
    ...baseEvidence(),
    app: 'desktop',
    scenario: 'live-runtime',
    stage: 'model-configured',
    screenshots: {
      desktop: 'desktop-model-configured-desktop.png',
      narrow: 'desktop-model-configured-narrow.png',
      panels: ['desktop-model-configured-agent-center-panel.png'],
    },
    runtime: {
      available: true,
      endpoint: '127.0.0.1:46371',
      authState: 'bound',
      sdkState: 'ready',
      runtimeSourceRef: 'runtime-source:test',
      localAgentRef: 'local-agent:test',
    },
    agentAIConfig: {
      revision: 2,
      textGenerate: { state: 'ready', reason: null, modelId: 'local/default' },
      imageGenerate: { state: 'not_configured', reason: null },
      audioSynthesize: { state: 'not_configured', reason: null, editable: false, playable: false },
    },
    diagnostics: {
      source: 'runtime-accepted-projection',
      runtimeConfigRevision: 2,
      acceptedTurnRef: 'turn:test',
      route: 'runtime-projected-route',
      modelId: 'runtime-projected-model',
      provider: 'runtime-projected-provider',
    },
    interaction: {
      ...baseInteraction(),
      modelEditCommitted: true,
      staleRevisionConflictObserved: true,
      staleRevisionSource: 'runtime-sdk-upsert-conflict',
    },
  }, overrides);
}

function noRuntimeEvidence(overrides = {}) {
  return deepMerge({
    ...baseEvidence(),
    app: 'desktop',
    scenario: 'no-runtime',
    stage: 'disabled',
    screenshots: {
      desktop: 'desktop-disabled-desktop.png',
      narrow: 'desktop-disabled-narrow.png',
      panels: ['desktop-disabled-agent-center-panel.png'],
    },
    runtime: {
      available: false,
    },
    agentAIConfig: {
      revision: null,
    },
    dom: {
      ...baseDom(),
      controls: {
        submitEnabled: false,
        modelSaveEnabled: false,
        autonomyToggleEnabled: false,
        disabledReason: 'Runtime is unavailable.',
      },
    },
  }, overrides);
}

function baseEvidence() {
  return {
    planId: 'runtime-local-agent-center-2026-07-07',
    checkpoint: 'runtime-local-agent-center-rla0b',
    app: 'desktop',
    scenario: 'live-runtime',
    stage: 'model-configured',
    timestamp: '2026-07-07T00:00:00.000Z',
    screenshots: {
      desktop: 'desktop-desktop.png',
      narrow: 'desktop-narrow.png',
      panels: [],
    },
    runtime: { available: true },
    agentState: {
      executionState: 'idle',
      statusText: 'Ready',
      currentEmotion: 'neutral',
      autonomyMode: 'off',
      autonomyEnabled: false,
      pendingHooksCount: 0,
      recentCanonicalMemoryCount: 0,
    },
    localConfig: {
      modulesChecked: ['appearance', 'avatar_asset', 'local_history', 'voice', 'ui'],
      unadmittedModulesRejected: true,
      forbiddenTruthFieldsRejected: true,
    },
    dom: baseDom(),
    interaction: baseInteraction(),
    problems: {
      consoleErrors: [],
      pageErrors: [],
      accessibilityErrors: [],
    },
  };
}

function baseDom() {
  return {
    viewport: { width: 1280, height: 900 },
    agentCenter: {
      visible: true,
      activeSection: 'model',
      boundingBox: { x: 0, y: 0, width: 420, height: 900 },
      hasOverflow: false,
    },
    controls: {
      submitEnabled: true,
      modelSaveEnabled: true,
      autonomyToggleEnabled: false,
      disabledReason: 'Choose a non-off mode before enabling.',
    },
    textLayout: {
      longChineseFits: true,
      buttonTextFits: true,
      overlapCount: 0,
    },
  };
}

function baseInteraction() {
  return {
    tabsVisited: ['overview', 'model', 'behavior', 'cognition', 'appearance'],
    keyboardOperable: true,
    modelEditCommitted: false,
    staleRevisionConflictObserved: false,
  };
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return patch === undefined ? base : patch;
  }
  const output = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = output[key];
    output[key] = current && typeof current === 'object' && !Array.isArray(current)
      ? deepMerge(current, value)
      : value;
  }
  return output;
}
