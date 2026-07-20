import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildDesktopE2EEvidence,
  renderDesktopE2EEvidenceMarkdown,
} from '../scripts/lib/desktop-e2e-evidence.mjs';
import {
  isWdioScenarioEntry,
  scenarioRegistry,
} from '../e2e/helpers/registry.mjs';

function writeScenario(root: string, directory: string, manifest: Record<string, unknown>, scenario: Record<string, unknown>, extraFiles: string[] = []) {
  const scenarioDir = path.join(root, directory);
  fs.mkdirSync(scenarioDir, { recursive: true });
  fs.writeFileSync(path.join(scenarioDir, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(scenarioDir, 'scenario-manifest.json'), `${JSON.stringify(scenario, null, 2)}\n`);
  for (const file of extraFiles) {
    fs.writeFileSync(path.join(scenarioDir, file), file);
  }
}

type RegisteredScenario = [string, { bucket: string; spec: string }];

const registeredScenarios = Array.from(
  scenarioRegistry.entries() as IterableIterator<[string, unknown]>,
).filter(([, entry]) => isWdioScenarioEntry(entry)) as RegisteredScenario[];

function writeCompleteSuite(artifactRoot: string, excludedScenarioId = '') {
  registeredScenarios.forEach(([scenarioId, entry], index) => {
    if (scenarioId === excludedScenarioId) {
      return;
    }
    const parityCaptures = scenarioId === 'chat.open-thread'
      ? [{ surface_id: 'character-rail', diff_ratio: 0 }]
      : [];
    writeScenario(
      artifactRoot,
      `${String(index + 1).padStart(2, '0')}-${scenarioId}`,
      {
        scenario_id: scenarioId,
        suite_bucket: entry.bucket,
        spec_path: entry.spec,
        backend_log: `apps/desktop/reports/e2e/${scenarioId}/backend.log`,
        driver_log: `apps/desktop/reports/e2e/${scenarioId}/tauri-driver.log`,
        parity_captures: parityCaptures,
      },
      { scenarioId },
      scenarioId === 'boot.anonymous.login-screen'
        ? ['boot.png', 'boot.browser.log', 'boot.renderer-errors.json']
        : [],
    );
  });
}

test('desktop E2E evidence proves the complete registered scenario set', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-desktop-e2e-evidence-'));
  const desktopRoot = path.join(root, 'apps', 'desktop');
  const artifactRoot = path.join(desktopRoot, 'reports', 'e2e');
  fs.mkdirSync(artifactRoot, { recursive: true });

  writeCompleteSuite(artifactRoot);

  try {
    const evidence = buildDesktopE2EEvidence({
      desktopRoot,
      artifactRoot,
      platform: 'ubuntu-22.04',
      workflowRef: 'ci',
      workflowRunId: '12345',
      commit: 'deadbeef',
      suiteOutcome: 'success',
      nativeDriver: '/usr/bin/WebKitWebDriver',
      tauriDriver: 'tauri-driver',
    });

    assert.equal(evidence.ok, true);
    assert.equal(evidence.scenarioCounts.expected, registeredScenarios.length);
    assert.equal(evidence.scenarioCounts.observed, registeredScenarios.length);
    assert.equal(evidence.scenarioCounts.byBucket.smoke, 7);
    assert.equal(evidence.scenarioCounts.byBucket.journeys, 6);
    assert.equal(evidence.scenarioCounts.byBucket['desktop-open'], 1);
    assert.equal(evidence.residualRisks.length, 0);
    const chatEvidence = evidence.scenarios.find((scenario: { scenario_id: string }) => scenario.scenario_id === 'chat.open-thread');
    assert.equal(chatEvidence?.parity_capture_count, 1);
    assert.equal(chatEvidence?.parity_diff_failures, 0);
    assert.match(renderDesktopE2EEvidenceMarkdown(evidence), /Verdict: PASS/);
    assert.match(renderDesktopE2EEvidenceMarkdown(evidence), /Complete suite: success/);
    assert.match(renderDesktopE2EEvidenceMarkdown(evidence), /boot\.anonymous\.login-screen/);
    assert.match(renderDesktopE2EEvidenceMarkdown(evidence), /chat\.open-thread/);
    assert.match(renderDesktopE2EEvidenceMarkdown(evidence), /Parity captures: 1, parity diff failures: 0/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('desktop E2E evidence records a blocking residual risk when the complete suite fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-desktop-e2e-evidence-fail-'));
  const desktopRoot = path.join(root, 'apps', 'desktop');
  const artifactRoot = path.join(desktopRoot, 'reports', 'e2e');
  fs.mkdirSync(artifactRoot, { recursive: true });

  try {
    const evidence = buildDesktopE2EEvidence({
      desktopRoot,
      artifactRoot,
      platform: 'windows-latest',
      suiteOutcome: 'failure',
      nativeDriver: 'msedgedriver',
    });

    assert.equal(evidence.ok, false);
    assert.ok(evidence.residualRisks.some((risk: string) => risk.includes('complete desktop E2E suite outcome is failure')));
    assert.ok(evidence.residualRisks.some((risk: string) => risk.includes('no desktop E2E scenario artifacts')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('desktop E2E evidence fails closed when successful outcomes have no scenario artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-desktop-e2e-evidence-empty-'));
  const desktopRoot = path.join(root, 'apps', 'desktop');
  const artifactRoot = path.join(desktopRoot, 'reports', 'e2e');
  fs.mkdirSync(artifactRoot, { recursive: true });

  try {
    const evidence = buildDesktopE2EEvidence({
      desktopRoot,
      artifactRoot,
      platform: 'ubuntu-22.04',
      suiteOutcome: 'success',
      nativeDriver: '/usr/bin/WebKitWebDriver',
    });

    assert.equal(evidence.ok, false);
    assert.equal(evidence.scenarioCounts.observed, 0);
    assert.ok(evidence.residualRisks.some((risk: string) => risk.includes('no desktop E2E scenario artifacts')));
    assert.equal(evidence.coverage.missingScenarioIds.length, registeredScenarios.length);
    assert.match(renderDesktopE2EEvidenceMarkdown(evidence), /Verdict: FAIL/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('desktop E2E evidence fails closed when one registered scenario artifact is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-desktop-e2e-evidence-missing-'));
  const desktopRoot = path.join(root, 'apps', 'desktop');
  const artifactRoot = path.join(desktopRoot, 'reports', 'e2e');
  fs.mkdirSync(artifactRoot, { recursive: true });

  const missingScenarioId = registeredScenarios.at(-1)?.[0] || '';
  writeCompleteSuite(artifactRoot, missingScenarioId);

  try {
    const evidence = buildDesktopE2EEvidence({
      desktopRoot,
      artifactRoot,
      platform: 'ubuntu-22.04',
      suiteOutcome: 'success',
      nativeDriver: '/usr/bin/WebKitWebDriver',
    });

    assert.equal(evidence.ok, false);
    assert.deepEqual(evidence.coverage.missingScenarioIds, [missingScenarioId]);
    assert.ok(evidence.residualRisks.some((risk: string) => risk.includes(`missing registered desktop E2E scenario artifacts: ${missingScenarioId}`)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('desktop E2E evidence rejects unexpected scenario artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-desktop-e2e-evidence-unexpected-'));
  const desktopRoot = path.join(root, 'apps', 'desktop');
  const artifactRoot = path.join(desktopRoot, 'reports', 'e2e');
  fs.mkdirSync(artifactRoot, { recursive: true });

  writeCompleteSuite(artifactRoot);
  writeScenario(
    artifactRoot,
    '99-unregistered.scenario',
    {
      scenario_id: 'unregistered.scenario',
      suite_bucket: 'journeys',
      spec_path: 'apps/desktop/e2e/specs/unregistered.scenario.e2e.mjs',
    },
    { scenarioId: 'unregistered.scenario' },
  );

  try {
    const evidence = buildDesktopE2EEvidence({
      desktopRoot,
      artifactRoot,
      platform: 'ubuntu-22.04',
      suiteOutcome: 'success',
      nativeDriver: '/usr/bin/WebKitWebDriver',
    });

    assert.equal(evidence.ok, false);
    assert.deepEqual(evidence.coverage.unexpectedScenarioIds, ['unregistered.scenario']);
    assert.ok(evidence.residualRisks.some((risk: string) => risk.includes('unexpected desktop E2E scenario artifacts: unregistered.scenario')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
