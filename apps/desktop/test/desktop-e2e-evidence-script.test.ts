import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildDesktopE2EEvidence,
  renderDesktopE2EEvidenceMarkdown,
} from '../scripts/lib/desktop-e2e-evidence.mjs';

function writeScenario(root: string, directory: string, manifest: Record<string, unknown>, scenario: Record<string, unknown>, extraFiles: string[] = []) {
  const scenarioDir = path.join(root, directory);
  fs.mkdirSync(scenarioDir, { recursive: true });
  fs.writeFileSync(path.join(scenarioDir, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(scenarioDir, 'scenario-manifest.json'), `${JSON.stringify(scenario, null, 2)}\n`);
  for (const file of extraFiles) {
    fs.writeFileSync(path.join(scenarioDir, file), file);
  }
}

test('desktop E2E evidence summarizes smoke and journey scenario artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-desktop-e2e-evidence-'));
  const desktopRoot = path.join(root, 'apps', 'desktop');
  const artifactRoot = path.join(desktopRoot, 'reports', 'e2e');
  fs.mkdirSync(artifactRoot, { recursive: true });

  writeScenario(
    artifactRoot,
    '01-boot.anonymous.login-screen',
    {
      scenario_id: 'boot.anonymous.login-screen',
      suite_bucket: 'smoke',
      spec_path: 'apps/desktop/e2e/specs/boot.anonymous.login-screen.e2e.mjs',
      backend_log: 'apps/desktop/reports/e2e/01-boot.anonymous.login-screen/backend.log',
      driver_log: 'apps/desktop/reports/e2e/01-boot.anonymous.login-screen/tauri-driver.log',
    },
    { scenarioId: 'boot.anonymous.login-screen' },
    ['boot.png', 'boot.browser.log', 'boot.renderer-errors.json'],
  );
  writeScenario(
    artifactRoot,
    '08-chat.open-thread',
    {
      scenario_id: 'chat.open-thread',
      suite_bucket: 'journeys',
      spec_path: 'apps/desktop/e2e/specs/chat.open-thread.e2e.mjs',
      backend_log: 'apps/desktop/reports/e2e/08-chat.open-thread/backend.log',
      driver_log: 'apps/desktop/reports/e2e/08-chat.open-thread/tauri-driver.log',
      parity_captures: [
        {
          surface_id: 'character-rail',
          diff_ratio: 0,
        },
      ],
    },
    { scenarioId: 'chat.open-thread' },
    ['chat.browser.log', 'chat.html'],
  );

  try {
    const evidence = buildDesktopE2EEvidence({
      desktopRoot,
      artifactRoot,
      platform: 'ubuntu-22.04',
      workflowRef: 'ci',
      workflowRunId: '12345',
      commit: 'deadbeef',
      smokeOutcome: 'success',
      journeysOutcome: 'success',
      nativeDriver: '/usr/bin/WebKitWebDriver',
      tauriDriver: 'tauri-driver',
    });

    assert.equal(evidence.ok, true);
    assert.equal(evidence.scenarioCounts.total, 2);
    assert.equal(evidence.scenarioCounts.smoke, 1);
    assert.equal(evidence.scenarioCounts.journeys, 1);
    assert.equal(evidence.residualRisks.length, 0);
    assert.equal(evidence.scenarios[1]?.parity_capture_count, 1);
    assert.equal(evidence.scenarios[1]?.parity_diff_failures, 0);
    assert.match(renderDesktopE2EEvidenceMarkdown(evidence), /Verdict: PASS/);
    assert.match(renderDesktopE2EEvidenceMarkdown(evidence), /boot\.anonymous\.login-screen/);
    assert.match(renderDesktopE2EEvidenceMarkdown(evidence), /chat\.open-thread/);
    assert.match(renderDesktopE2EEvidenceMarkdown(evidence), /Parity captures: 1, parity diff failures: 0/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('desktop E2E evidence records blocking residual risks when journeys fail', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-desktop-e2e-evidence-fail-'));
  const desktopRoot = path.join(root, 'apps', 'desktop');
  const artifactRoot = path.join(desktopRoot, 'reports', 'e2e');
  fs.mkdirSync(artifactRoot, { recursive: true });

  try {
    const evidence = buildDesktopE2EEvidence({
      desktopRoot,
      artifactRoot,
      platform: 'windows-latest',
      smokeOutcome: 'success',
      journeysOutcome: 'failure',
      nativeDriver: 'msedgedriver',
    });

    assert.equal(evidence.ok, false);
    assert.ok(evidence.residualRisks.some((risk: string) => risk.includes('journeys outcome is failure')));
    assert.ok(evidence.residualRisks.some((risk: string) => risk.includes('no desktop E2E scenario artifacts')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
