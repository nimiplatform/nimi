import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildDesktopMacosSmokeEvidence,
  renderDesktopMacosSmokeEvidenceMarkdown,
  writeDesktopMacosSmokeEvidence,
} from '../scripts/lib/desktop-macos-smoke-evidence.mjs';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

test('desktop macos smoke evidence collects the latest scenario artifacts', () => {
  const desktopRoot = createTempDir('desktop-macos-smoke-desktop-root');
  const smokeRoot = path.join(createTempDir('desktop-macos-smoke-root'), 'desktop-macos-smoke');
  const runRoot = path.join(smokeRoot, '2026-04-14T12-00-00-000Z');
  const scenarioDir = path.join(runRoot, '01-boot.anonymous.login-screen');
  fs.mkdirSync(scenarioDir, { recursive: true });
  fs.writeFileSync(path.join(scenarioDir, 'artifact-manifest.json'), JSON.stringify({
    scenario_id: 'boot.anonymous.login-screen',
    suite_bucket: 'smoke',
    spec_path: 'apps/desktop/e2e/specs/boot.anonymous.login-screen.e2e.mjs',
    fixture_profile: 'apps/desktop/e2e/fixtures/profiles/boot.anonymous.login-screen.json',
    fixture_manifest: 'scenario-manifest.json',
    backend_log: 'backend.log',
  }, null, 2));
  fs.writeFileSync(path.join(scenarioDir, 'scenario-manifest.json'), JSON.stringify({
    scenarioId: 'boot.anonymous.login-screen',
  }, null, 2));
  fs.writeFileSync(path.join(scenarioDir, 'macos-smoke-report.json'), JSON.stringify({
    ok: true,
    steps: ['wait-login-screen', 'write-pass-report'],
    fixtureManifestPath: '/tmp/scenario-manifest.json',
    htmlSnapshotPath: '/tmp/boot.anonymous.login-screen.dom.html',
    failureSource: 'renderer',
    backendLogPresent: true,
  }, null, 2));

  const evidence = buildDesktopMacosSmokeEvidence({
    desktopRoot,
    smokeRoot,
  });

  assert.equal(evidence.ok, true);
  assert.equal(evidence.scenarioCount, 1);
  assert.equal(evidence.scenarios[0]?.scenario_id, 'boot.anonymous.login-screen');
  assert.equal(evidence.scenarios[0]?.step_count, 2);
  assert.equal(evidence.scenarios[0]?.failure_source, 'renderer');
  assert.equal(evidence.scenarios[0]?.backend_log_present, true);
  assert.match(
    renderDesktopMacosSmokeEvidenceMarkdown(evidence),
    /boot\.anonymous\.login-screen: PASS/,
  );
  assert.match(
    renderDesktopMacosSmokeEvidenceMarkdown(evidence),
    /Failure source: renderer, phase: -/,
  );
});

test('desktop macos smoke evidence writer emits json and markdown outputs', () => {
  const outputRoot = createTempDir('desktop-macos-smoke-evidence-output');
  const jsonPath = path.join(outputRoot, 'evidence.json');
  const markdownPath = path.join(outputRoot, 'evidence.md');
  const evidence = {
    generatedAt: '2026-04-14T12:00:00.000Z',
    platform: 'macos',
    ok: false,
    runRoot: '/tmp/run',
    smokeRoot: '/tmp/root',
    scenarioCount: 0,
    scenarios: [],
    residualRisks: ['no macOS smoke run directory was found'],
  };

  writeDesktopMacosSmokeEvidence(jsonPath, markdownPath, evidence);

  assert.equal(fs.existsSync(jsonPath), true);
  assert.equal(fs.existsSync(markdownPath), true);
  assert.match(fs.readFileSync(markdownPath, 'utf8'), /Residual Risks/);
});
